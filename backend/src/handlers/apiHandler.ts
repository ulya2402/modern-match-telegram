import { Env } from "../index";
import { sendMessageWithMiniApp } from "../telegram";
import { t } from "../i18n";

export function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
}

// 1. API Onboarding (Menyimpan data pengguna baru)
export async function handleOnboardingAPI(request: Request, env: Env, ctx: ExecutionContext) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders() });

    try {
        const data = (await request.json()) as any;
        console.log(`[API] Menerima data onboarding untuk User: ${data.telegram_id}`);

        // Pastikan is_onboarding_complete diset ke 1
await env.DB.prepare(`
    INSERT INTO users (telegram_id, username, name, gender, location_city, preference, bio, photo_url, is_onboarding_complete)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(telegram_id) DO UPDATE SET
        name = excluded.name,
        gender = excluded.gender,
        location_city = excluded.location_city,
        preference = excluded.preference,
        bio = excluded.bio,
        photo_url = excluded.photo_url,
        is_onboarding_complete = 1
`).bind(data.telegram_id, data.username, data.name, data.gender, data.location, data.preference, data.bio, data.photo_url).run();

        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } });
    } catch (error: any) {
        console.error(`[API ERROR] Onboarding gagal: ${error.message}`);
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders() } });
    }
}

// 2. API Cek User (Bypass Onboarding jika sudah daftar)

// 2. API Cek User (Bypass Onboarding jika sudah daftar)
export async function handleCheckUserAPI(request: Request, env: Env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    
    const url = new URL(request.url);
    const tgId = url.searchParams.get("tg_id");

    if (!tgId) return new Response("Missing tg_id", { status: 400, headers: corsHeaders() });

    try {
        const user = await env.DB.prepare("SELECT is_onboarding_complete FROM users WHERE telegram_id = ?").bind(tgId).first();
        
        return new Response(JSON.stringify({ 
            success: true, 
            exists: !!user,  // <--- INI KUNCI YANG HILANG! SEKARANG SUDAH ADA
            is_onboarding_complete: user ? (user.is_onboarding_complete === 1 || user.is_onboarding_complete === true) : false 
        }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } });
        
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: corsHeaders() });
    }
}
// 3. API Discovery Feed (Mengambil daftar profil untuk di-swipe)
export async function handleDiscoveryAPI(request: Request, env: Env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    
    const url = new URL(request.url);
    const tgId = url.searchParams.get("tg_id");

    try {
        const currentUser = await env.DB.prepare("SELECT preference FROM users WHERE telegram_id = ?").bind(tgId).first();
        if (!currentUser) throw new Error("User tidak ditemukan");

        const pref = currentUser.preference;
        
        // Ambil profil selain dirinya sendiri, yang belum di swipe, dan sesuai preferensi
        let query = `
            SELECT telegram_id, name, bio, photo_url, location_city 
            FROM users 
            WHERE telegram_id != ? AND is_onboarding_complete = 1
            AND telegram_id NOT IN (SELECT liked_telegram_id FROM likes WHERE liker_telegram_id = ?)
        `;
        let params: any[] = [tgId, tgId];

        if (pref !== 'EVERYONE') {
            query += ` AND gender = ?`;
            params.push(pref);
        }

        query += ` LIMIT 15`; // Maksimal 15 profil per request agar ringan

        const { results } = await env.DB.prepare(query).bind(...params).all();

        return new Response(JSON.stringify({ success: true, profiles: results }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } });
    } catch (error: any) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: corsHeaders() });
    }
}

// 4. API Swipe Action (Menangani tombol Suka / Lewati)
export async function handleSwipeAPI(request: Request, env: Env, ctx: ExecutionContext) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders() });

    try {
        const data = await request.json() as any;
        const { liker_id, liked_id, action } = data; // action = 'LIKE' atau 'PASS'
        
        let status = action === 'LIKE' ? 'PENDING' : 'REJECTED';
        let isMatch = false;

        // Jika user melakukan 'LIKE', kita cek apakah target sudah pernah me-LIKE balik
        if (action === 'LIKE') {
            const reverseLike = await env.DB.prepare(
                "SELECT id FROM likes WHERE liker_telegram_id = ? AND liked_telegram_id = ? AND status = 'PENDING'"
            ).bind(liked_id, liker_id).first();

            if (reverseLike) {
                status = 'MATCHED';
                isMatch = true;
                // Ubah status target menjadi MATCHED juga
                await env.DB.prepare("UPDATE likes SET status = 'MATCHED' WHERE id = ?").bind(reverseLike.id).run();
            }
        }

        // Simpan aksi swipe ke tabel D1 'likes'
        await env.DB.prepare(`
            INSERT INTO likes (liker_telegram_id, liked_telegram_id, status) 
            VALUES (?, ?, ?)
            ON CONFLICT(liker_telegram_id, liked_telegram_id) DO UPDATE SET status = ?
        `).bind(liker_id, liked_id, status, status).run();

        // ----------------------------------------------------
        // FITUR OTOMATIS: PENGIRIMAN NOTIFIKASI BOT TELEGRAM
        // Dijalankan di background dengan ctx.waitUntil agar API tetap responsif (fast UI)
        // ----------------------------------------------------
        if (action === 'LIKE' && !isMatch) {
            ctx.waitUntil((async () => {
                try {
                    const likedUser = await env.DB.prepare("SELECT language FROM users WHERE telegram_id = ?").bind(liked_id).first();
                    const lang = likedUser ? (likedUser.language as string) : "id";
                    const text = t("like_notification", lang);
                    const btn = t("btn_open_app", lang);
                    const MINI_APP_URL = "https://bauhaus-match-app.pages.dev";
                    
                    await sendMessageWithMiniApp(env.TELEGRAM_BOT_TOKEN, liked_id, text, btn, MINI_APP_URL);
                } catch (e) { console.error("[NOTIF ERROR]", e); }
            })());
        } else if (isMatch) {
            ctx.waitUntil((async () => {
                try {
                    const MINI_APP_URL = "https://bauhaus-match-app.pages.dev";
                    const notifText = "🎉 IT'S A MATCH! Seseorang baru saja membalas LIKE kamu. Buka app untuk mengobrol!";
                    const btnText = "LIHAT MATCHES ↗️";
                    // Kirim ke keduanya
                    await sendMessageWithMiniApp(env.TELEGRAM_BOT_TOKEN, liker_id, notifText, btnText, MINI_APP_URL);
                    await sendMessageWithMiniApp(env.TELEGRAM_BOT_TOKEN, liked_id, notifText, btnText, MINI_APP_URL);
                } catch (e) { console.error("[NOTIF ERROR]", e); }
            })());
        }

        return new Response(JSON.stringify({ success: true, isMatch }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } });

    } catch (error: any) {
        console.error(`[SWIPE API ERROR] ${error.message}`);
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders() } });
    }
}

// 5. API Ambil Data "Likes You" (Siapa yang menyukai user ini)
export async function handleGetLikesAPI(request: Request, env: Env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    
    const url = new URL(request.url);
    const tgId = url.searchParams.get("tg_id");

    try {
        console.log(`[API] Mengambil daftar Likes You untuk user: ${tgId}`);
        // Ambil profil orang yang me-LIKE target (tgId) tapi statusnya masih PENDING
        const query = `
            SELECT u.telegram_id, u.name, u.photo_url, u.location_city, u.bio
            FROM likes l
            JOIN users u ON l.liker_telegram_id = u.telegram_id
            WHERE l.liked_telegram_id = ? AND l.status = 'PENDING'
        `;
        const { results } = await env.DB.prepare(query).bind(tgId).all();

        return new Response(JSON.stringify({ success: true, likes: results }), { 
            status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } 
        });
    } catch (error: any) {
        console.error(`[API LIKES ERROR] ${error.message}`);
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: corsHeaders() });
    }
}

// 6. API Ambil Data "Matches" (Siapa yang sudah saling suka)
// 6. API Ambil Data "Matches" (Siapa yang sudah saling suka) - DIPERBARUI
export async function handleGetMatchesAPI(request: Request, env: Env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    
    const url = new URL(request.url);
    const tgId = url.searchParams.get("tg_id");

    if (!tgId) return new Response("Missing tg_id", { status: 400, headers: corsHeaders() });

    try {
        console.log(`[API] Mengambil daftar Matches untuk user: ${tgId}`);
        
        // Perbaikan: Tambahkan GROUP BY u.telegram_id agar tidak ada data ganda!
        const query = `
            SELECT 
                u.telegram_id, u.name, u.photo_url, u.username, u.location_city
            FROM likes l
            JOIN users u ON u.telegram_id = (
                CASE 
                    WHEN l.liker_telegram_id = ? THEN l.liked_telegram_id 
                    ELSE l.liker_telegram_id 
                END
            )
            WHERE (l.liker_telegram_id = ? OR l.liked_telegram_id = ?)
              AND l.status = 'MATCHED'
            GROUP BY u.telegram_id
        `;
        const { results } = await env.DB.prepare(query).bind(tgId, tgId, tgId).all();

        return new Response(JSON.stringify({ success: true, matches: results }), { 
            status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } 
        });
    } catch (error: any) {
        console.error(`[API MATCHES ERROR] ${error.message}`);
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: corsHeaders() });
    }
}

// 7. API Profil (Mengambil & Menyimpan Data Profil Sendiri)
// 7. API Profil (Mengambil & Menyimpan Data Profil Sendiri)
// 7. API Profil (Mengambil & Menyimpan Data Profil Sendiri)
export async function handleProfileAPI(request: Request, env: Env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    
    try {
        if (request.method === "GET") {
            const url = new URL(request.url);
            const tgId = url.searchParams.get("tg_id");
            
            // Gunakan .all() lalu ambil index [0] agar lebih aman di D1 Cloudflare
            const { results } = await env.DB.prepare("SELECT name, gender, location_city, preference, bio, photo_url FROM users WHERE telegram_id = ?").bind(tgId).all();
            const user = results.length > 0 ? results[0] : null;

            return new Response(JSON.stringify({ success: true, user: user }), { 
                status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } 
            });
        } 
        
        if (request.method === "POST") {
            const data = await request.json() as any;
            await env.DB.prepare(`
                UPDATE users SET name = ?, location_city = ?, preference = ?, bio = ?, photo_url = ? WHERE telegram_id = ?
            `).bind(data.name, data.location, data.preference, data.bio, data.photo_url, data.telegram_id).run();
            
            return new Response(JSON.stringify({ success: true }), { 
                status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } 
            });
        }
        
        return new Response("Method Not Allowed", { status: 405, headers: corsHeaders() });

    } catch (error: any) {
        console.error("[API PROFILE ERROR]", error.message);
        return new Response(JSON.stringify({ success: false, error: error.message }), { 
            status: 500, headers: corsHeaders() 
        });
    }
}