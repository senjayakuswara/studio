import { NextResponse } from 'next/server';
import { runMonthlyRecapAutomation } from '@/ai/flows/telegram-flow';

// Fungsi ini akan dipicu oleh Vercel Cron Job
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', {
      status: 401,
    });
  }

  try {
    console.log("Starting monthly recap cron job...");
    await runMonthlyRecapAutomation();
    console.log("Monthly recap cron job finished successfully.");
    return NextResponse.json({ success: true, message: 'Monthly recaps sent successfully.' });
  } catch (error) {
    console.error("Cron job failed:", error);
    return NextResponse.json({ success: false, message: 'An error occurred during the cron job.' }, { status: 500 });
  }
}
