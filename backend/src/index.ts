import { handleBotUpdate } from "./handlers/botHandler";
import { 
    handleOnboardingAPI, handleCheckUserAPI, handleDiscoveryAPI, 
    handleSwipeAPI, handleGetLikesAPI, handleGetMatchesAPI, 
    handleProfileAPI, corsHeaders 
} from "./handlers/apiHandler";

export interface Env {
    TELEGRAM_BOT_TOKEN: string;
    WEBHOOK_SECRET: string;
    DB: D1Database;
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        // Global CORS Preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders() });
        }

        console.log(`[ROUTER] Menerima request: ${request.method} ${url.pathname}`);

        if (url.pathname === "/webhook/telegram") {
            if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
            const secretToken = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
            if (env.WEBHOOK_SECRET && secretToken !== env.WEBHOOK_SECRET) {
                return new Response("Unauthorized", { status: 401 });
            }
            try {
                const update = (await request.json()) as any;
                ctx.waitUntil(handleBotUpdate(update, env));
                return new Response("OK", { status: 200 });
            } catch (error: any) {
                return new Response("Bad Request", { status: 400 });
            }
        }

        // --- JALUR API UNTUK MINI APP PAGES ---
        if (url.pathname === "/api/onboarding") return handleOnboardingAPI(request, env, ctx);
        if (url.pathname === "/api/user") return handleCheckUserAPI(request, env);
        if (url.pathname === "/api/discovery") return handleDiscoveryAPI(request, env);
        if (url.pathname === "/api/swipe") return handleSwipeAPI(request, env, ctx);
        if (url.pathname === "/api/likes") return handleGetLikesAPI(request, env);
        if (url.pathname === "/api/matches") return handleGetMatchesAPI(request, env);
        if (url.pathname === "/api/profile") return handleProfileAPI(request, env);

        // Fallback dengan CORS agar browser tidak melempar pesan "failed to fetch"
        return new Response("Bauhaus Match API is running.", { 
            status: 200, headers: corsHeaders() 
        });
    },
};