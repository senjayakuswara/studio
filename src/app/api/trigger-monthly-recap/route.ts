
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { year, month } = await request.json();

    // Basic validation
    if (typeof year !== 'number' || typeof month !== 'number' || month < 0 || month > 11) {
      return NextResponse.json({ message: 'Payload tidak valid: `year` dan `month` diperlukan.' }, { status: 400 });
    }

    // Forward the request to the local WhatsApp server using the explicit IP address
    const serverResponse = await fetch('http://127.0.0.1:8000/trigger-monthly-recap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, month }),
      // Adding a timeout for robustness, though the main issue is connectivity
      signal: AbortSignal.timeout(10000) // 10 seconds timeout
    });

    const result = await serverResponse.json();

    if (!serverResponse.ok) {
        // Forward the error from the WhatsApp server
        return NextResponse.json({ message: result.message || 'Server notifikasi mengembalikan error.' }, { status: serverResponse.status });
    }

    // Forward the success response
    return NextResponse.json(result, { status: 200 });

  } catch (error: any) {
    // This catch block handles network errors, e.g., if the WhatsApp server is not running or timeout
    console.error('[API-PROXY-ERROR] Failed to connect to WhatsApp server:', error);
    
    let errorMessage = 'Gagal terhubung ke server notifikasi. Pastikan server (start.bat) sedang berjalan.';
    if (error.name === 'TimeoutError') {
      errorMessage = 'Koneksi ke server notifikasi timeout. Server mungkin sedang sibuk atau tidak merespons.';
    }
    
    return NextResponse.json(
        { message: errorMessage }, 
        { status: 503 } // 503 Service Unavailable is appropriate
    );
  }
}
