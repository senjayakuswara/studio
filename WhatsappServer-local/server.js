
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const { google } = require('googleapis');
const config = require('./config.json');

// =================================================================================
// --- KONFIGURASI & STATE GLOBAL ---
// =================================================================================

const PORT = process.env.PORT || 8000;
const BATCH_LIMIT = 1;
const MAX_RETRIES = 1;
const STALE_JOB_TIMEOUT_MINUTES = 2; 
const SEND_MESSAGE_TIMEOUT_MS = 30000; // 30 detik timeout untuk pengiriman

let db;
let client;
let googleSheetsClient;
let isWhatsAppReady = false;
let isProcessingQueue = false;

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// =================================================================================
// --- UTILITIES ---
// =================================================================================

const log = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString('id-ID');
    const typeMap = { info: 'INFO', success: 'SUCCESS', error: 'ERROR', warn: 'WARN' };
    const logMessage = `[${timestamp}][${typeMap[type] || 'INFO'}] ${message}`;
    console.log(logMessage);
    io.emit('log', { timestamp, message, type });
};

function getRandomDelay() {
    // Jeda antara 5 hingga 15 detik
    return Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
}

// =================================================================================
// --- INISIALISASI MODUL ---
// =================================================================================

function initializeFirebase() {
    try {
        const serviceAccountPath = path.join(__dirname, 'credentials.json');
        if (!fs.existsSync(serviceAccountPath)) throw new Error("File credentials.json tidak ditemukan.");
        const serviceAccount = require(serviceAccountPath);
        if (!serviceAccount.project_id) throw new Error("File credentials.json tidak valid.");
        
        initializeApp({ credential: cert(serviceAccount) });
        db = getFirestore();
        log(`Berhasil terhubung ke project Firestore: ${serviceAccount.project_id}`, 'success');
    } catch (error) {
        log(`Gagal inisialisasi Firebase: ${error.message}`, 'error');
        process.exit(1);
    }
}

async function initializeGoogleSheets() {
    try {
        const credentialsPath = path.join(__dirname, 'sheets-credentials.json');
        if (!fs.existsSync(credentialsPath)) {
            log("File sheets-credentials.json tidak ditemukan. Fitur logging ke Google Sheets dinonaktifkan.", "warn");
            return;
        }
        const auth = new google.auth.GoogleAuth({
            keyFile: credentialsPath,
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
        googleSheetsClient = await auth.getClient();
        log("Berhasil terhubung ke Google Sheets API.", "success");
    } catch (error) {
        log(`Gagal inisialisasi Google Sheets: ${error.message}`, 'error');
    }
}

function initializeWhatsApp() {
    log('Menginisialisasi WhatsApp Client...');
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            // Konfigurasi Puppeteer yang stabil
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process', // <-- Coba dalam mode single process
                '--disable-gpu'
            ],
        },
    });

    client.on('qr', qr => {
        log("Pindai QR Code di bawah ini:", 'warn');
        qrcode.generate(qr, { small: true });
        io.emit('status', 'Membutuhkan Scan QR');
        io.emit('qr_code', qr);
    });

    client.on('ready', () => {
        isWhatsAppReady = true;
        log('WhatsApp Terhubung! Siap memproses notifikasi.', 'success');
        io.emit('status', 'WhatsApp Terhubung!');
        // Hanya mulai mendengarkan antrean setelah WhatsApp benar-benar siap
        listenForNotificationJobs();
    });

    client.on('auth_failure', msg => {
        log(`Autentikasi gagal: ${msg}. Hapus folder .wwebjs_auth dan mulai ulang.`, 'error');
        io.emit('status', 'Autentikasi Gagal');
        isWhatsAppReady = false;
    });

    client.on('disconnected', reason => {
        log(`Koneksi WhatsApp terputus: ${reason}. Coba menghubungkan kembali...`, 'error');
        io.emit('status', 'Koneksi Terputus');
        isWhatsAppReady = false;
        // Coba inisialisasi ulang jika terputus
        client.initialize().catch(err => log(`Gagal restart otomatis: ${err.message}`, 'error'));
    });

    client.initialize().catch(err => log(`Gagal inisialisasi client: ${err.message}`, 'error'));
}

// =================================================================================
// --- LOGIKA UTAMA (QUEUE, WHATSAPP & SHEETS) ---
// =================================================================================

async function appendToSheet(data) {
    if (!googleSheetsClient || !config.spreadsheetId || config.spreadsheetId === "YOUR_SPREADSHEET_ID_HERE") return;
    const sheets = google.sheets({ version: 'v4', auth: googleSheetsClient });
    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: config.spreadsheetId,
            range: `${config.sheetName}!A1`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [data],
            },
        });
    } catch (error) {
        log(`Gagal menulis ke Google Sheet: ${error.message}`, 'error');
    }
}

/**
 * [DIRUBAH] Fungsi pengiriman pesan yang disederhanakan secara radikal.
 * Menghapus semua pre-check (isRegisteredUser, getChatById) dan langsung mencoba mengirim.
 * Ini untuk menghindari bug state internal di whatsapp-web.js.
 */
async function sendWhatsAppMessage(recipientNumber, message) {
    const sanitizedNumber = recipientNumber.replace(/\D/g, '');
    const finalNumber = sanitizedNumber.startsWith('0') ? '62' + sanitizedNumber.substring(1) : sanitizedNumber;
    const recipientId = `${finalNumber}@c.us`;

    log(`Mengirim pesan ke ${recipientId}...`);
    
    // Langsung panggil sendMessage, dibungkus dengan timeout.
    const sendMessagePromise = client.sendMessage(recipientId, message);
    
    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Waktu pengiriman habis (30 detik).')), SEND_MESSAGE_TIMEOUT_MS)
    );

    // Promise.race akan menyelesaikan promise mana yang lebih dulu selesai (kirim atau timeout)
    await Promise.race([sendMessagePromise, timeoutPromise]);
}

async function processJob(job) {
    if (!job || !job.id) return;
    const jobRef = db.collection('notification_queue').doc(job.id);
    
    try {
        log(`Mengunci tugas ${job.id} sebagai 'processing'.`);
        await jobRef.update({ status: 'processing', lockedAt: Timestamp.now() });
        
        // Coba kirim pesan
        await sendWhatsAppMessage(job.phone, job.message);
        
        // Jika berhasil
        log(`Pesan ke ${job.phone} berhasil dikirim.`, 'success');
        await jobRef.update({ status: 'sent', processedAt: Timestamp.now(), error: null });

        // Update status nomor WA siswa menjadi valid
        if (job.metadata?.studentId) {
            await db.collection('students').doc(job.metadata.studentId).update({ parentWaStatus: 'valid' });
        }
        await appendToSheet([new Date().toISOString(), job.phone, job.metadata?.studentName || '', 'sent', job.message]);

    } catch (error) {
        const errorMessage = error.message || 'Terjadi error tidak diketahui.';
        log(`Gagal memproses tugas ${job.id} untuk ${job.phone}: ${errorMessage}`, 'error');

        const newRetryCount = (job.retryCount || 0) + 1;
        if (newRetryCount <= MAX_RETRIES) {
            log(`Tugas ${job.id} akan dicoba kembali (percobaan ke-${newRetryCount}).`);
            await jobRef.update({ status: 'pending', retryCount: newRetryCount, error: `Percobaan gagal: ${errorMessage}` });
        } else {
            log(`Tugas ${job.id} ditandai gagal permanen.`);
            await jobRef.update({ status: 'failed', error: `Gagal permanen: ${errorMessage}` });
            // Jika error karena nomor tidak ada, tandai sebagai tidak valid
            if (job.metadata?.studentId && (errorMessage.includes("is not a user") || errorMessage.includes("not a valid WhatsApp user"))) {
                 await db.collection('students').doc(job.metadata.studentId).update({ parentWaStatus: 'invalid' });
            }
        }
        await appendToSheet([new Date().toISOString(), job.phone, job.metadata?.studentName || '', 'failed', errorMessage]);
    }
}

function listenForNotificationJobs() {
    log(`Mendengarkan tugas notifikasi dari Firestore...`);
    // Query hanya untuk tugas yang 'pending', ambil 1 per 1, urutkan dari yang paling lama.
    const q = db.collection('notification_queue').where('status', '==', 'pending').orderBy('createdAt', 'asc').limit(BATCH_LIMIT);

    q.onSnapshot(snapshot => {
        // Cek flag global, jika sedang memproses atau WA belum siap, jangan lakukan apa-apa.
        if (isProcessingQueue || !isWhatsAppReady) return;

        snapshot.docChanges().forEach(async (change) => {
            // Hanya bereaksi pada dokumen BARU yang ditambahkan ke hasil query
            if (change.type === 'added') {
                isProcessingQueue = true; // Kunci proses
                const jobData = { id: change.doc.id, ...change.doc.data() };
                log(`Tugas baru ditemukan: ${jobData.id}`);
                try {
                    await processJob(jobData);
                } finally {
                    // Setelah selesai (sukses atau gagal), tunggu jeda acak lalu buka kunci
                    const delay = getRandomDelay();
                    log(`Menunggu jeda ${delay / 1000} detik...`);
                    setTimeout(() => { isProcessingQueue = false; }, delay);
                }
            }
        });
    }, err => {
        log(`Error mendengarkan Firestore: ${err.message}`, 'error');
    });
}

// Fungsi Fail-Safe untuk membersihkan tugas yang macet
async function cleanupStaleJobs() {
    log('[FAIL-SAFE] Menjalankan pembersihan tugas macet...');
    const staleTime = Timestamp.fromMillis(Date.now() - STALE_JOB_TIMEOUT_MINUTES * 60 * 1000);
    const staleJobsQuery = db.collection('notification_queue').where('status', '==', 'processing').where('lockedAt', '<=', staleTime);

    try {
        const snapshot = await staleJobsQuery.get();
        if (snapshot.empty) {
            log('[FAIL-SAFE] Tidak ada tugas macet ditemukan.');
            return;
        }

        log(`[FAIL-SAFE] Ditemukan ${snapshot.size} tugas macet. Mereset...`, 'warn');
        const batch = db.batch();
        snapshot.forEach(doc => {
            const job = doc.data();
            const newRetryCount = (job.retryCount || 0) + 1;
            const errorMsg = '[FAIL-SAFE] Direset dari status macet (timeout).';
            
            // Jika masih bisa di-retry, kembalikan ke pending. Jika tidak, tandai failed.
            if (newRetryCount <= MAX_RETRIES) {
                batch.update(doc.ref, { status: 'pending', retryCount: newRetryCount, error: errorMsg });
            } else {
                batch.update(doc.ref, { status: 'failed', error: `Gagal permanen: ${errorMsg}` });
            }
        });
        await batch.commit();
        log(`[FAIL-SAFE] ${snapshot.size} tugas macet berhasil direset.`, 'success');
    } catch (error) {
        log(`[FAIL-SAFE] Error saat membersihkan tugas macet: ${error.message}`, 'error');
    }
}

// =================================================================================
// --- TITIK MASUK APLIKASI ---
// =================================================================================

async function main() {
    console.log(`\n====================================================`);
    console.log(`  AbTrack WhatsApp Server (v5.0 - Arsitektur Express)`);
    console.log(`====================================================\n`);

    initializeFirebase();
    await initializeGoogleSheets();
    initializeWhatsApp();
    
    io.on('connection', (socket) => {
        log('Client terhubung via Socket.IO');
        socket.emit('status', isWhatsAppReady ? 'WhatsApp Terhubung!' : 'Menginisialisasi...');
    });

    server.listen(PORT, () => {
        log(`Server Express berjalan di port ${PORT}`, 'success');
    });

    // Jalankan pembersihan tugas macet setiap 2 menit
    setInterval(cleanupStaleJobs, STALE_JOB_TIMEOUT_MINUTES * 60 * 1000);
}

main();

    