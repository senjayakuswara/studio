// This cron job is currently not used with the external webhook method.
// The logic for sending monthly recaps should be triggered manually from the Rekapitulasi page
// or by setting up a separate cron job system on the local server.

import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  return NextResponse.json({ success: true, message: 'This cron job is disabled. Please trigger recaps manually or from your local server.' });
}
