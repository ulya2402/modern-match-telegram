import { Env } from "../index";
import { t } from "../i18n";
import { callTelegramAPI, sendMessageWithMiniApp } from "../telegram";

export async function handleBotUpdate(update: any, env: Env) {
    // Kita hanya memproses pesan teks untuk saat ini
    if (!update.message || !update.message.text) {
        return; 
    }

    const message = update.message;
    const chatId = message.chat.id;
    const text = message.text;
    const from = message.from;

    // TODO: Ganti URL ini nanti dengan URL Cloudflare Pages tempat Mini App di-deploy
    const MINI_APP_URL = "https://bauhaus-match-app.pages.dev"; 

    try {
        // 1. Cek apakah user sudah ada di database D1
        const userQuery = await env.DB.prepare("SELECT * FROM users WHERE telegram_id = ?").bind(from.id).first();
        let userLang = userQuery ? (userQuery.language as string) : "id"; // Default ke 'id'

        // 2. Handle Command: /start
        if (text.startsWith("/start")) {
            if (!userQuery) {
                // Jika user belum ada, daftarkan ke database D1
                await env.DB.prepare(
                    "INSERT INTO users (telegram_id, username, name, language) VALUES (?, ?, ?, ?)"
                ).bind(from.id, from.username || null, from.first_name || "User", "id").run();
                
                userLang = "id";
                console.log(`[BOT] User baru terdaftar di database: ${from.id} (${from.first_name})`);
            } else {
                console.log(`[BOT] User lama mengakses /start: ${from.id}`);
            }

            // Ambil teks dari i18n
            const welcomeText = t("welcome", userLang);
            const buttonText = t("btn_open_app", userLang);

            // Kirim pesan dengan tombol untuk membuka Mini App
            await sendMessageWithMiniApp(env.TELEGRAM_BOT_TOKEN, chatId, welcomeText, buttonText, MINI_APP_URL);
            return;
        }

        // 3. Handle Command: /lang (Mengubah Bahasa)
        if (text.startsWith("/lang")) {
            // Memisahkan teks. Contoh: "/lang en" -> ["/lang", "en"]
            const args = text.split(" ");
            const newLang = args[1];

            if (newLang === "id" || newLang === "en") {
                // Update bahasa di database
                await env.DB.prepare("UPDATE users SET language = ? WHERE telegram_id = ?").bind(newLang, from.id).run();
                
                const successText = t("lang_changed", newLang);
                console.log(`[BOT] User ${from.id} mengubah bahasa ke: ${newLang}`);
                
                // Kirim pesan balasan biasa (tanpa tombol mini app)
                await callTelegramAPI(env.TELEGRAM_BOT_TOKEN, "sendMessage", {
                    chat_id: chatId,
                    text: successText
                });
            } else {
                // Jika format salah
                await callTelegramAPI(env.TELEGRAM_BOT_TOKEN, "sendMessage", {
                    chat_id: chatId,
                    text: "Format salah. Gunakan: /lang id atau /lang en"
                });
            }
            return;
        }
        if (text.startsWith("/dummy")) {
            const fakeUsers = [
                { id: 101, name: "Anya", gender: "FEMALE", city: "Jakarta", bio: "Suka kopi, seni, dan ngobrol santai.", photo: "https://i.pravatar.cc/400?img=5" },
                { id: 102, name: "Reza", gender: "MALE", city: "Jakarta", bio: "Programmer yang lelah coding, butuh healing.", photo: "https://i.pravatar.cc/400?img=11" },
                { id: 103, name: "Citra", gender: "FEMALE", city: "Bandung", bio: "Pecinta kucing dan desain Brutalist.", photo: "https://i.pravatar.cc/400?img=9" },
                { id: 104, name: "Bima", gender: "MALE", city: "Jakarta", bio: "Anak basket, suka jalan-jalan ke gunung.", photo: "https://i.pravatar.cc/400?img=12" },
                { id: 105, name: "Siska", gender: "FEMALE", city: "Surabaya", bio: "Looking for someone fun!", photo: "https://i.pravatar.cc/400?img=1" }
            ];

            let added = 0;
            for (const u of fakeUsers) {
                try {
                    // Gunakan INSERT OR IGNORE agar tidak error jika id sudah ada
                    await env.DB.prepare(`
                        INSERT OR IGNORE INTO users (telegram_id, name, gender, location_city, preference, bio, photo_url, is_onboarding_complete)
                        VALUES (?, ?, ?, ?, 'EVERYONE', ?, ?, 1)
                    `).bind(u.id, u.name, u.gender, u.city, u.bio, u.photo).run();
                    added++;
                } catch(e) { console.error("Gagal insert dummy", e); }
            }
            
            await callTelegramAPI(env.TELEGRAM_BOT_TOKEN, "sendMessage", {
                chat_id: chatId,
                text: `✅ *Mode Developer Aktif*\nBerhasil menambahkan profil dummy ke databasemu! Buka Mini App sekarang untuk mulai Swipe.`,
                parse_mode: "Markdown"
            });
            return;
        }

    } catch (error: any) {
        console.error(`[BOT HANDLER ERROR] Terjadi kesalahan saat memproses chat ${chatId}:`, error.message);
    }
}