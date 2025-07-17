import { NextResponse } from "next/server";

// This endpoint is no longer used with the whatsapp-web.js implementation.
// It is kept here to prevent 404 errors if Telegram tries to call it.
// In a real-world scenario with whatsapp-web.js, incoming messages would be handled
// by the 'message' event listener in the whatsapp-service.
export async function POST(request: Request) {
    try {
        const payload = await request.json();
        console.log("Received a request on the old Telegram webhook endpoint. Ignoring.", payload);
        return new NextResponse(null, { status: 200 });
    } catch (error) {
        console.error("Error in deprecated Telegram webhook:", error);
        return new NextResponse(null, { status: 200 });
    }
}
