import { NextResponse } from "next/server";
import { processTelegramWebhook } from "@/ai/flows/telegram-flow";

export async function POST(request: Request) {
    try {
        const payload = await request.json();
        // Fire and forget: We don't need to wait for the processing to finish
        // to send a response to Telegram. This prevents timeouts.
        processTelegramWebhook(payload).catch(console.error);
        return new NextResponse(null, { status: 200 });
    } catch (error) {
        console.error("Error in Telegram webhook:", error);
        // Still return 200 to prevent Telegram from resending the update
        return new NextResponse(null, { status: 200 });
    }
}
