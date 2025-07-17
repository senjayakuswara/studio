// This file is no longer used as Telegram notifications are replaced.
// It can be safely deleted or kept for future reference.

import { NextResponse } from "next/server";

export async function POST(request: Request) {
    console.log("Received a request to the old Telegram webhook endpoint. It's no longer active.");
    return new NextResponse(null, { status: 200 });
}
