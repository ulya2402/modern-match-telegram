// Fungsi murni untuk memanggil API Telegram
export async function callTelegramAPI(token: string, method: string, payload: any) {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        
        if (!response.ok) {
            console.error(`[TELEGRAM ERROR] Method: ${method} | Response:`, JSON.stringify(data));
        }

        return data;
    } catch (error) {
        console.error(`[TELEGRAM FETCH ERROR] Method: ${method} | Error:`, error);
        throw error;
    }
}

// Fungsi spesifik untuk mengirim pesan teks dengan tombol Mini App
export async function sendMessageWithMiniApp(
    token: string, 
    chatId: number, 
    text: string, 
    buttonText: string, 
    miniAppUrl: string
) {
    return callTelegramAPI(token, "sendMessage", {
        chat_id: chatId,
        text: text,
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: buttonText,
                        web_app: { url: miniAppUrl }
                    }
                ]
            ]
        }
    });
}