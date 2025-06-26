import { processTelegramWebhook } from "@/ai/flows/telegram-flow";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
    try {
        const payload = await request.json();
        // Await the function to ensure it completes before the server responds.
        await processTelegramWebhook(payload);
        return NextResponse.json({ status: "ok" });
    } catch (error) {
        console.error("Error in Telegram webhook:", error);
        // It's better to still return a 200 OK to Telegram to avoid retry loops
        // unless the request is truly malformed.
        return NextResponse.json({ status: "error", message: "Invalid request payload" }, { status: 200 });
    }
}
