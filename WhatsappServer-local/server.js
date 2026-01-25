
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

// =================================================================================
// --- KONFIGURASI & STATE GLOBAL ---
// =================================================================================

let db;
let client;
let isWhatsAppReady = false;
let isProcessingQueue = false;
const BATCH_LIMIT = 1; // Proses satu per satu untuk stabilitas maksimal
const MAX_RETRIES = 1;
const STALE_JOB_TIMEOUT_MINUTES = 2;

// =================================================================================
// --- UTILITIES ---
// =================================================================================

const log = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString('id-ID');
    console.log(`[${timestamp}] ${message}`);
};

function getRandomDelay() {
    // Jeda acak antara 5 sampai 8 detik
    return Math.floor(Math.random() * (8000 - 5000 + 1)) + 5000;
}

// =================================================================================
// --- INISIALISASI FIREBASE ADMIN SDK ---
// =================================================================================

function initializeFirebase() {
    try {
        const serviceAccountPath = path.join(__dirname, 'credentials.json');
        if (!fs.existsSync(serviceAccountPath)) {
            throw new Error("File credentials.json tidak ditemukan. Pastikan Anda telah menempatkan file kunci dari Firebase Console di folder ini.");
        }
        const serviceAccount = require(serviceAccountPath);

        if (!serviceAccount || !serviceAccount.project_id || serviceAccount.project_id.includes("YOUR_PROJECT_ID")) {
            throw new Error("File credentials.json tidak valid atau masih placeholder. Ganti dengan file asli dari Firebase Console.");
        }

        initializeApp({
            credential: cert(serviceAccount)
        });
        db = getFirestore();
        const projectId = process.env.GCLOUD_PROJECT || serviceAccount.project_id;
        log(`[FIREBASE] Berhasil terhubung ke project Firestore: ${projectId}`, 'success');
    } catch (error) {
        log(`[CRITICAL] Gagal inisialisasi Firebase Admin: ${error.message}`, 'error');
        process.exit(1);
    }
}

// =================================================================================
// --- MODUL WHATSAPP ---
// =================================================================================

async function sendWhatsAppMessage(recipientNumber, message) {
    const sanitizedNumber = recipientNumber.replace(/\D/g, '');
    const finalNumber = sanitizedNumber.startsWith('0') ? '62' + sanitizedNumber.substring(1) : sanitizedNumber;
    const chatId = `${finalNumber}@c.us`;

    // 1. Validasi nomor terdaftar di WhatsApp
    const isRegistered = await client.isRegisteredUser(chatId);
    if (!isRegistered) {
        throw new Error(`Nomor ${finalNumber} tidak terdaftar di WhatsApp.`);
    }

    // 2. Kirim pesan
    await client.sendMessage(chatId, message);
}

function initializeWhatsApp() {
    log('Menginisialisasi WhatsApp Client...');
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process', // Dihindari di Windows
                '--disable-gpu'
            ].filter(arg => process.platform !== 'win32' || arg !== '--single-process')
        }
    });

    client.on('qr', qr => {
        log("Pindai QR Code di bawah ini dengan WhatsApp Anda:", 'qr');
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
        isWhatsAppReady = true;
        log('WhatsApp Terhubung! Siap memproses notifikasi.', 'success');
        // PENTING: Mulai mendengarkan antrean HANYA setelah WhatsApp siap.
        listenForNotificationJobs();
    });

    client.on('auth_failure', msg => {
        log(`Autentikasi gagal: ${msg}. Hapus folder .wwebjs_auth dan mulai ulang.`, 'error');
        isWhatsAppReady = false;
    });

    client.on('disconnected', (reason) => {
        log(`Koneksi WhatsApp terputus: ${reason}. Harap restart server.`, 'error');
        isWhatsAppReady = false;
    });

    client.initialize().catch(err => {
        log(`Gagal menginisialisasi client WhatsApp: ${err}`, 'error');
    });
}

// =================================================================================
// --- PROSESOR ANTRIAN (QUEUE PROCESSOR) ---
// =================================================================================

async function processJob(job) {
    if (!job || !job.id) return;

    const jobRef = db.collection('notification_queue').doc(job.id);
    
    try {
        // --- Langkah 2: Ubah status ke "processing" ---
        // Ini adalah langkah atomik untuk "mengunci" pekerjaan.
        log(`Mengunci tugas ${job.id} sebagai 'processing'.`);
        await jobRef.update({ 
            status: 'processing',
            processedAt: Timestamp.now()
        });
        
        // --- Langkah 3: Kirim pesan WhatsApp ---
        log(`Mengirim pesan ke ${job.phone}...`);
        await sendWhatsAppMessage(job.phone, job.message);
        
        // --- Langkah 4 (Sukses): Ubah status ke "sent" ---
        log(`Pesan ke ${job.phone} berhasil dikirim.`);
        await jobRef.update({ status: 'sent' });

    } catch (error) {
        const errorMessage = error.message || 'Terjadi error tidak diketahui.';
        log(`Gagal memproses tugas ${job.id} untuk ${job.phone}: ${errorMessage}`, 'error');

        // --- Langkah 4 (Gagal): Coba lagi atau tandai gagal ---
        if (job.retryCount < MAX_RETRIES) {
            await jobRef.update({
                status: 'pending', // Kembalikan ke antrean untuk dicoba lagi
                retryCount: (job.retryCount || 0) + 1,
                error: `Percobaan ke-${(job.retryCount || 0) + 1} gagal: ${errorMessage}`
            });
            log(`Tugas ${job.id} akan dicoba kembali.`);
        } else {
            await jobRef.update({
                status: 'failed',
                error: `Gagal setelah ${MAX_RETRIES + 1} percobaan: ${errorMessage}`
            });
            log(`Tugas ${job.id} ditandai gagal permanen.`);
        }
    }
}


function listenForNotificationJobs() {
    log(`Mendengarkan tugas notifikasi dari Firestore...`);
    
    const q = db.collection('notification_queue')
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'asc')
        .limit(BATCH_LIMIT); // Ambil satu per satu

    q.onSnapshot(snapshot => {
        // PENTING: Hanya proses jika tidak ada tugas lain yang sedang berjalan
        if (isProcessingQueue || !isWhatsAppReady) {
            return;
        }

        // Hanya bereaksi pada dokumen BARU yang ditambahkan ke hasil query
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
                isProcessingQueue = true; // Kunci proses
                const jobData = { id: change.doc.id, ...change.doc.data() };
                
                log(`Tugas baru ditemukan: ${jobData.id}`);

                await processJob(jobData);
                
                // Beri jeda sebelum mengambil tugas berikutnya
                const delay = getRandomDelay();
                log(`Menunggu jeda ${delay / 1000} detik sebelum tugas berikutnya...`);
                setTimeout(() => {
                    isProcessingQueue = false; // Buka kunci setelah jeda
                }, delay);
            }
        });
    }, err => {
        log(`Error mendengarkan Firestore: ${err}`, 'error');
        // Handle jika perlu membuat index
        const errorMessage = String(err);
        if (errorMessage.includes("requires an index")) {
            log("================================= ERROR DATABASE =================================", 'error');
            const urlMatch = errorMessage.match(/(https?:\/\/[^\s]+)/);
            if (urlMatch) {
                log("Firestore memerlukan Index. Buka URL ini untuk membuatnya:", 'error');
                log(urlMatch[0]);
            }
            log("================================================================================", 'error');
        }
    });
}

// =================================================================================
// --- FAIL-SAFE: PEMBERSIH TUGAS MACET ---
// =================================================================================

async function cleanupStaleJobs() {
    log('[FAIL-SAFE] Menjalankan pembersihan tugas macet...');
    const twoMinutesAgo = Timestamp.fromMillis(Date.now() - STALE_JOB_TIMEOUT_MINUTES * 60 * 1000);
    
    const staleJobsQuery = db.collection('notification_queue')
        .where('status', '==', 'processing')
        .where('processedAt', '<=', twoMinutesAgo);

    try {
        const snapshot = await staleJobsQuery.get();
        if (snapshot.empty) {
            log('[FAIL-SAFE] Tidak ada tugas macet ditemukan.');
            return;
        }

        log(`[FAIL-SAFE] Ditemukan ${snapshot.size} tugas macet. Mereset...`, 'warning');
        const batch = db.batch();
        snapshot.forEach(doc => {
            const jobData = doc.data();
            const jobRef = db.collection('notification_queue').doc(doc.id);
            if (jobData.retryCount < MAX_RETRIES) {
                batch.update(jobRef, {
                    status: 'pending',
                    retryCount: (jobData.retryCount || 0) + 1,
                    error: `[FAIL-SAFE] Direset dari status macet.`
                });
            } else {
                batch.update(jobRef, {
                    status: 'failed',
                    error: `[FAIL-SAFE] Gagal permanen setelah macet.`
                });
            }
        });
        await batch.commit();
        log(`[FAIL-SAFE] ${snapshot.size} tugas macet berhasil direset.`);

    } catch (error) {
        log(`[FAIL-SAFE] Error saat membersihkan tugas macet: ${error.message}`, 'error');
    }
}


// =================================================================================
// --- TITIK MASUK APLIKASI ---
// =================================================================================

console.log(`====================================================`);
console.log(`  AbTrack WhatsApp Server (Firestore Mode - v4.0)`);
console.log(`  Arsitektur Stabil untuk Notifikasi Handal.`);
console.log(`====================================================`);

initializeFirebase();
initializeWhatsApp();

// Jalankan pembersih tugas macet setiap 2 menit
setInterval(cleanupStaleJobs, STALE_JOB_TIMEOUT_MINUTES * 60 * 1000);
