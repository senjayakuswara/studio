
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
let isProcessingQueue = false; // Flag untuk mencegah double-processing
const BATCH_LIMIT = 1; // Proses satu per satu untuk stabilitas maksimal
const MAX_RETRIES = 1; // Coba ulang otomatis 1 kali sebelum ditandai gagal
const STALE_JOB_TIMEOUT_MINUTES = 2; // Batas waktu tugas dianggap macet
const SEND_MESSAGE_TIMEOUT_MS = 30000; // Batas waktu 30 detik untuk setiap pengiriman

// =================================================================================
// --- UTILITIES ---
// =================================================================================

const log = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString('id-ID');
    const typeMap = { info: 'INFO', success: 'SUCCESS', error: 'ERROR', warn: 'WARN' };
    console.log(`[${timestamp}][${typeMap[type] || 'INFO'}] ${message}`);
};

function getRandomDelay() {
    // Jeda acak antara 5 sampai 15 detik untuk menghindari rate limiting
    return Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
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

        initializeApp({ credential: cert(serviceAccount) });
        db = getFirestore();
        const projectId = process.env.GCLOUD_PROJECT || serviceAccount.project_id;
        log(`Berhasil terhubung ke project Firestore: ${projectId}`, 'success');
    } catch (error) {
        log(`Gagal inisialisasi Firebase Admin: ${error.message}`, 'error');
        process.exit(1);
    }
}

// =================================================================================
// --- MODUL WHATSAPP (LOGIKA PENGIRIMAN) ---
// =================================================================================

/**
 * Mengirim pesan WhatsApp dengan mekanisme "pemanasan" chat dan timeout.
 * @param {string} recipientNumber - Nomor tujuan (misal: '628123...')
 * @param {string} message - Isi pesan
 * @returns {Promise<void>}
 */
async function sendWhatsAppMessage(recipientNumber, message) {
    // 1. Normalisasi nomor dan buat ID chat
    const sanitizedNumber = recipientNumber.replace(/\D/g, '');
    const finalNumber = sanitizedNumber.startsWith('0') ? '62' + sanitizedNumber.substring(1) : sanitizedNumber;
    const recipientId = `${finalNumber}@c.us`;

    // 2. "Pemanasan" Chat (Sangat Penting untuk Mencegah 'markedUnread' Error)
    //    Memaksa whatsapp-web.js untuk memuat data chat sebelum mengirim.
    log(`Memanaskan chat untuk ${recipientId}...`);
    await client.getChatById(recipientId);
    
    // 3. Kirim pesan dengan batas waktu (Timeout)
    log(`Mengirim pesan ke ${recipientId}...`);
    const sendMessagePromise = client.sendMessage(recipientId, message);
    
    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Waktu pengiriman habis (30 detik).')), SEND_MESSAGE_TIMEOUT_MS)
    );

    // Promise.race akan menyelesaikan promise mana yang lebih dulu selesai (kirim pesan atau timeout)
    await Promise.race([sendMessagePromise, timeoutPromise]);
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
                '--single-process',
                '--disable-gpu'
            ],
        },
    });

    client.on('qr', qr => {
        log("Pindai QR Code di bawah ini dengan WhatsApp Anda:", 'warn');
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
        log(`Koneksi WhatsApp terputus: ${reason}. Akan mencoba menghubungkan kembali.`, 'error');
        isWhatsAppReady = false;
    });

    client.initialize().catch(err => {
        log(`Gagal menginisialisasi client WhatsApp: ${err}`, 'error');
    });
}

// =================================================================================
// --- PROSESOR ANTRIAN (QUEUE PROCESSOR) ---
// =================================================================================

/**
 * Memproses satu tugas notifikasi dari pengambilan hingga selesai/gagal.
 * @param {object} job - Objek tugas dari Firestore, termasuk ID.
 */
async function processJob(job) {
    if (!job || !job.id) return;

    const jobRef = db.collection('notification_queue').doc(job.id);
    
    try {
        // --- Langkah 2: Kunci tugas dengan mengubah status ke "processing" ---
        log(`Mengunci tugas ${job.id} sebagai 'processing'.`);
        await jobRef.update({ 
            status: 'processing',
            lockedAt: Timestamp.now() // Tandai waktu mulai proses
        });
        
        // --- Langkah 3: Kirim pesan WhatsApp ---
        await sendWhatsAppMessage(job.phone, job.message);
        
        // --- Langkah 4 (Sukses): Ubah status ke "sent" ---
        log(`Pesan ke ${job.phone} berhasil dikirim.`, 'success');
        await jobRef.update({ 
            status: 'sent',
            processedAt: Timestamp.now(),
            error: null 
        });

        // Tandai nomor WA valid di data siswa (jika ada metadata)
        if (job.metadata?.studentId) {
            const studentRef = db.collection('students').doc(job.metadata.studentId);
            await studentRef.update({ parentWaStatus: 'valid' }).catch(e => log(`Gagal update status WA siswa ${job.metadata.studentId}: ${e.message}`, 'warn'));
        }

    } catch (error) {
        const errorMessage = error.message || 'Terjadi error tidak diketahui.';
        log(`Gagal memproses tugas ${job.id} untuk ${job.phone}: ${errorMessage}`, 'error');

        // --- Langkah 4 (Gagal): Coba lagi atau tandai gagal ---
        const newRetryCount = (job.retryCount || 0) + 1;
        if (newRetryCount <= MAX_RETRIES) {
            log(`Tugas ${job.id} akan dicoba kembali (percobaan ke-${newRetryCount}).`);
            await jobRef.update({
                status: 'pending', // Kembalikan ke antrean
                retryCount: newRetryCount,
                error: `Percobaan ke-${newRetryCount} gagal: ${errorMessage}`
            });
        } else {
            log(`Tugas ${job.id} ditandai gagal permanen.`);
            await jobRef.update({
                status: 'failed',
                error: `Gagal setelah ${newRetryCount} percobaan: ${errorMessage}`
            });
        }

        // Tandai nomor WA tidak valid jika errornya spesifik
        if (errorMessage.includes("tidak terdaftar") || errorMessage.includes("not a user")) {
            if (job.metadata?.studentId) {
                const studentRef = db.collection('students').doc(job.metadata.studentId);
                await studentRef.update({ parentWaStatus: 'invalid' }).catch(e => log(`Gagal update status WA siswa ${job.metadata.studentId}: ${e.message}`, 'warn'));
            }
        }
    }
}

/**
 * Mendengarkan tugas baru di koleksi notification_queue.
 */
function listenForNotificationJobs() {
    log(`Mendengarkan tugas notifikasi dari Firestore...`);
    
    const q = db.collection('notification_queue')
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'asc')
        .limit(BATCH_LIMIT); // Ambil satu per satu

    q.onSnapshot(snapshot => {
        if (isProcessingQueue || !isWhatsAppReady) {
            return; // Jangan proses jika sedang ada proses lain atau WA belum siap
        }

        // Hanya bereaksi pada dokumen BARU yang ditambahkan ke hasil query
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
                isProcessingQueue = true; // Kunci proses
                const jobData = { id: change.doc.id, ...change.doc.data() };
                
                log(`Tugas baru ditemukan: ${jobData.id}`);

                try {
                    await processJob(jobData);
                } finally {
                    // Beri jeda sebelum mengambil tugas berikutnya, lalu buka kunci
                    const delay = getRandomDelay();
                    log(`Menunggu jeda ${delay / 1000} detik sebelum tugas berikutnya...`);
                    setTimeout(() => {
                        isProcessingQueue = false; // Buka kunci setelah jeda
                    }, delay);
                }
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

/**
 * Mencari dan mereset tugas yang terjebak di status "processing" terlalu lama.
 */
async function cleanupStaleJobs() {
    log('[FAIL-SAFE] Menjalankan pembersihan tugas macet...');
    const staleTime = Timestamp.fromMillis(Date.now() - STALE_JOB_TIMEOUT_MINUTES * 60 * 1000);
    
    const staleJobsQuery = db.collection('notification_queue')
        .where('status', '==', 'processing')
        .where('lockedAt', '<=', staleTime);

    try {
        const snapshot = await staleJobsQuery.get();
        if (snapshot.empty) {
            log('[FAIL-SAFE] Tidak ada tugas macet ditemukan.');
            return;
        }

        log(`[FAIL-SAFE] Ditemukan ${snapshot.size} tugas macet. Mereset...`, 'warn');
        const batch = db.batch();
        snapshot.forEach(doc => {
            const jobData = doc.data();
            const jobRef = db.collection('notification_queue').doc(doc.id);
            const newRetryCount = (jobData.retryCount || 0) + 1;

            if (newRetryCount <= MAX_RETRIES) {
                batch.update(jobRef, {
                    status: 'pending',
                    retryCount: newRetryCount,
                    error: `[FAIL-SAFE] Direset dari status macet.`
                });
            } else {
                batch.update(jobRef, {
                    status: 'failed',
                    error: `[FAIL-SAFE] Gagal permanen setelah macet dan direset.`
                });
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

function main() {
    console.log(`\n====================================================`);
    console.log(`  AbTrack WhatsApp Server (v4.0 - Arsitektur Stabil)`);
    console.log(`====================================================\n`);

    initializeFirebase();
    initializeWhatsApp();

    // Jalankan pembersih tugas macet setiap 2 menit
    setInterval(cleanupStaleJobs, STALE_JOB_TIMEOUT_MINUTES * 60 * 1000);
}

main();
