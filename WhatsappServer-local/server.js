
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
const MAX_RETRIES = 1;
const STALE_JOB_TIMEOUT_MINUTES = 2; 
const SEND_MESSAGE_TIMEOUT_MS = 45000; // Timeout pengiriman pesan dinaikkan menjadi 45 detik

let db;
let client;
let googleSheetsClient;
let isWhatsAppReady = false;
let readyTimeout = null; // Watchdog timer

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
        authStrategy: new LocalAuth({ clientId: "abtrack-server" }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote'
            ],
        },
    });

    client.on('qr', qr => {
        log("Pindai QR Code di bawah ini:", 'warn');
        qrcode.generate(qr, { small: true });
        io.emit('status', 'Membutuhkan Scan QR');
        io.emit('qr_code', qr);
    });

    client.on('loading_screen', (percent, message) => {
        log(`Memuat Layar: ${percent}% "${message}"`, 'info');
    });

    client.on('authenticated', () => {
        log('Autentikasi berhasil!', 'success');
        io.emit('status', 'Autentikasi berhasil, memuat chat...');

        // Start a watchdog timer in case 'ready' event never fires
        clearTimeout(readyTimeout);
        log('[WATCHDOG] Memulai timer 90 detik untuk memantau status "ready"...');
        readyTimeout = setTimeout(() => {
            log('[WATCHDOG] Waktu habis! Client gagal siap dalam 90 detik. Mencoba restart paksa...', 'error');
            io.emit('status', 'Koneksi macet, mencoba restart...');
            if (client) {
                // Destroy the client and re-initialize
                client.destroy().catch(e => log(`Gagal menghancurkan client: ${e.message}`, 'error'));
                setTimeout(initializeWhatsApp, 5000); 
            }
        }, 90000); // 90-second timeout
    });
    
    client.on('remote_session_saved', () => {
        log('Sesi remote berhasil disimpan.', 'info');
    });

    client.on('ready', () => {
        clearTimeout(readyTimeout); // Success! Cancel the watchdog timer.
        log('[WATCHDOG] Timer dibatalkan, client sudah siap.', 'info');
        isWhatsAppReady = true;
        log('WhatsApp Terhubung! Siap memproses notifikasi.', 'success');
        io.emit('status', 'WhatsApp Terhubung!');
        processQueue();
    });

    client.on('auth_failure', msg => {
        log(`Autentikasi gagal: ${msg}. Hapus folder .wwebjs_auth dan mulai ulang.`, 'error');
        io.emit('status', 'Autentikasi Gagal');
        isWhatsAppReady = false;
        clearTimeout(readyTimeout);
    });

    client.on('disconnected', reason => {
        log(`Koneksi WhatsApp terputus: ${reason}. Coba menghubungkan kembali...`, 'error');
        io.emit('status', 'Koneksi Terputus');
        isWhatsAppReady = false;
        clearTimeout(readyTimeout);
        
        // Destroy the client and re-initialize for a clean start
        if (client) {
            client.destroy().catch(e => log(`Error saat destroy client: ${e.message}`, 'error'));
        }
        setTimeout(initializeWhatsApp, 15000);
    });

    log('Menjalankan client.initialize()...');
    client.initialize().catch(err => {
        log(`Gagal inisialisasi client awal: ${err.message}`, 'error');
        // Retry initialization after a delay if it fails at the start
        setTimeout(initializeWhatsApp, 30000);
    });
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

async function sendWhatsAppMessageToGroup(groupName, message) {
    log(`Mencari grup: "${groupName}"...`);
    const chats = await client.getChats();
    const groupChat = chats.find(chat => chat.isGroup && chat.name === groupName);

    if (!groupChat) {
        throw new Error(`Grup "${groupName}" tidak ditemukan. Pastikan nama grup di pengaturan kelas sudah benar.`);
    }

    log(`Mengirim pesan ke grup ${groupName} (ID: ${groupChat.id._serialized})...`);
    const sendMessagePromise = groupChat.sendMessage(message);
    
    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Waktu pengiriman habis (${SEND_MESSAGE_TIMEOUT_MS / 1000} detik).`)), SEND_MESSAGE_TIMEOUT_MS)
    );

    await Promise.race([sendMessagePromise, timeoutPromise]);
}


async function processJob(job) {
    if (!job || !job.id) return;
    const jobRef = db.collection('notification_queue').doc(job.id);
    
    const groupName = job.payload?.recipient;
    const messageContent = job.payload?.message;

    if (!groupName || !messageContent) {
        const errorMsg = "Tugas notifikasi tidak memiliki format yang benar (tidak ada nama grup atau pesan).";
        log(`Gagal memproses tugas ${job.id}: ${errorMsg}`, 'error');
        await jobRef.update({ status: 'failed', error: errorMsg, processedAt: Timestamp.now(), lockedAt: null });
        return;
    }

    try {
        log(`Mengunci tugas ${job.id} sebagai 'processing'.`);
        await jobRef.update({ status: 'processing', lockedAt: Timestamp.now() });
        
        await sendWhatsAppMessageToGroup(groupName, messageContent);
        
        log(`Pesan ke grup ${groupName} berhasil dikirim.`, 'success');
        await jobRef.update({ status: 'sent', processedAt: Timestamp.now(), error: null, lockedAt: null });

        await appendToSheet([new Date().toISOString(), groupName, job.metadata?.studentName || '', 'sent', messageContent]);

    } catch (error) {
        const errorMessage = error.message || 'Terjadi error tidak diketahui.';
        log(`Gagal memproses tugas ${job.id} untuk grup ${groupName}: ${errorMessage}`, 'error');

        const newRetryCount = (job.retryCount || 0) + 1;
        if (newRetryCount <= MAX_RETRIES) {
            log(`Tugas ${job.id} akan dicoba kembali (percobaan ke-${newRetryCount}).`);
            await jobRef.update({ status: 'pending', retryCount: newRetryCount, error: `Percobaan gagal: ${errorMessage}`, lockedAt: null });
        } else {
            log(`Tugas ${job.id} ditandai gagal permanen.`);
            await jobRef.update({ status: 'failed', error: `Gagal permanen: ${errorMessage}`, lockedAt: null });
        }
        await appendToSheet([new Date().toISOString(), groupName, job.metadata?.studentName || '', 'failed', errorMessage]);
    }
}

async function processQueue() {
    if (!isWhatsAppReady) {
        log("Koneksi WhatsApp terputus, pemrosesan antrean dihentikan sementara.", "warn");
        setTimeout(processQueue, 15000); 
        return;
    }

    const q = db.collection('notification_queue').where('status', '==', 'pending').orderBy('createdAt', 'asc').limit(1);
    
    try {
        const snapshot = await q.get();

        if (snapshot.empty) {
            setTimeout(processQueue, 5000); 
            return;
        }

        const jobDoc = snapshot.docs[0];
        const jobData = { id: jobDoc.id, ...jobDoc.data() };
        
        log(`Memproses tugas: ${jobData.id}`);
        await processJob(jobData);

        const delay = getRandomDelay();
        log(`Menunggu jeda ${delay / 1000} detik sebelum tugas berikutnya...`);
        setTimeout(processQueue, delay);

    } catch (error) {
        log(`Terjadi error pada loop pemrosesan antrean: ${error.message}`, 'error');
        setTimeout(processQueue, 30000);
    }
}


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
            
            if (newRetryCount <= MAX_RETRIES) {
                batch.update(doc.ref, { status: 'pending', retryCount: newRetryCount, error: errorMsg, lockedAt: null });
            } else {
                batch.update(doc.ref, { status: 'failed', error: `Gagal permanen: ${errorMsg}`, lockedAt: null });
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

    // Jalankan pembersihan tugas macet setiap 1 menit
    setInterval(cleanupStaleJobs, 60 * 1000);
}

main();
