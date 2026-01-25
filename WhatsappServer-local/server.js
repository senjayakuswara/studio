
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

// --- KONFIGURASI & STATE ---
let db;
let client;
let isWhatsAppReady = false;
let isProcessingQueue = false;
const jobQueue = [];

// --- INISIALISASI FIREBASE ---
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
    console.log(`[FIREBASE] Berhasil terhubung ke project Firestore: ${projectId}`);
} catch (error) {
    console.error("[CRITICAL] Gagal inisialisasi Firebase Admin:", error.message);
    process.exit(1);
}

// --- FUNGSI BANTU (UTILITIES) ---
const log = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString('id-ID');
    console.log(`[${timestamp}] ${message}`);
};

function getRandomDelay() {
    // Jeda acak antara 5 sampai 15 detik
    return Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
}

// --- LOGIKA UTAMA PEMROSESAN ANTRIAN ---

/**
 * Memproses satu per satu tugas notifikasi dari antrean.
 * Didesain agar tidak pernah macet.
 */
async function processQueue() {
    if (isProcessingQueue || jobQueue.length === 0 || !isWhatsAppReady) {
        return;
    }

    isProcessingQueue = true;
    const job = jobQueue.shift();
    const jobRef = db.collection('notification_queue').doc(job.id);
    const studentRef = job.metadata?.studentId ? db.collection('students').doc(job.metadata.studentId) : null;
    
    let recipientNumber = String(job.payload.recipient).replace(/\D/g, '');
    log(`Memproses tugas untuk: ${recipientNumber}...`);

    try {
        // 1. Normalisasi nomor telepon
        if (recipientNumber.startsWith('0')) {
            recipientNumber = '62' + recipientNumber.substring(1);
        }
        const recipientId = `${recipientNumber}@c.us`;

        // 2. "Pemanasan" Chat untuk mencegah error 'markedUnread'
        await client.getChatById(recipientId);

        // 3. Kirim pesan dengan timeout "peluru ajaib" 30 detik
        const sendMessagePromise = client.sendMessage(recipientId, job.payload.message);
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Pengiriman pesan timeout setelah 30 detik')), 30000)
        );
        
        await Promise.race([sendMessagePromise, timeoutPromise]);
        
        // 4. Jika berhasil, update status di Firestore
        await jobRef.update({ status: 'success', updatedAt: new Date(), errorMessage: '' });
        log(`Pesan berhasil dikirim ke ${recipientNumber}.`, 'success');
        
        // Tandai nomor WA siswa sebagai valid
        if (studentRef) {
            await studentRef.update({ parentWaStatus: 'valid' });
        }

    } catch (error) {
        // 5. Jika gagal, catat error dan update status di Firestore
        const errorMessage = error.message || 'Terjadi error tidak diketahui saat mengirim.';
        log(`Gagal mengirim pesan ke ${recipientNumber}: ${errorMessage}`, 'error');
        await jobRef.update({ status: 'failed', errorMessage: errorMessage, updatedAt: new Date() });
        
        // Tandai nomor WA siswa sebagai tidak valid jika error-nya relevan
        const isInvalidNumberError = /tidak terdaftar|not registered|not a valid|recipient is not on whatsapp/i.test(errorMessage);
        if (studentRef && isInvalidNumberError) {
            await studentRef.update({ parentWaStatus: 'invalid' });
            log(`Nomor ${recipientNumber} ditandai tidak valid untuk siswa ID: ${job.metadata.studentId}`);
        }
    } finally {
        // 6. Blok 'finally' memastikan server SELALU lanjut ke tugas berikutnya
        const delay = getRandomDelay();
        log(`Menunggu jeda ${delay / 1000} detik sebelum tugas berikutnya...`);

        setTimeout(() => {
            isProcessingQueue = false;
            process.nextTick(processQueue); // Proses item berikutnya
        }, delay);
    }
}

/**
 * Mendengarkan tugas baru dari koleksi 'notification_queue' di Firestore.
 */
function listenForNotificationJobs() {
    const q = db.collection('notification_queue').where('status', '==', 'pending').orderBy('createdAt', 'asc');

    q.onSnapshot(snapshot => {
        const newJobs = [];
        snapshot.docChanges().forEach(change => {
            if (change.type === 'added') {
                const jobData = { id: change.doc.id, ...change.doc.data() };
                // Cegah duplikasi jika listener terpanggil beberapa kali
                if (!jobQueue.some(j => j.id === jobData.id) && !isProcessingQueue) {
                    newJobs.push(jobData);
                }
            }
        });

        if (newJobs.length > 0) {
            jobQueue.push(...newJobs);
            log(`${newJobs.length} tugas baru ditambahkan ke antrean. Total antrean: ${jobQueue.length}`);
            process.nextTick(processQueue); // Mulai proses jika belum berjalan
        }
    }, err => {
        // Error handling jika Firestore memerlukan index
        const errorMessage = String(err);
        if (errorMessage.includes("requires an index")) {
            log("================================= ERROR DATABASE =================================", 'error');
            log("Query Firestore memerlukan Index. Ini adalah setup satu kali yang wajib.", 'error');
            log("Silakan salin dan buka URL di bawah ini di browser Anda untuk membuatnya:", 'error');
            
            const urlMatch = errorMessage.match(/(https?:\/\/[^\s]+)/);
            if (urlMatch) {
                log(urlMatch[0]);
            } else {
                log("Tidak dapat mengekstrak URL. Silakan cek log error lengkap di atas.", 'error');
            }
            log("Setelah halaman terbuka, cukup klik tombol 'Buat Indeks' atau 'Create Index'.", 'info');
            log("Setelah indeks selesai dibuat (perlu beberapa menit), restart server ini.", 'info');
            log("================================================================================", 'error');
        } else {
             log(`Error mendengarkan Firestore: ${err}`, 'error');
        }
    });
}

// --- INISIALISASI WHATSAPP CLIENT ---

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
        log("Status berubah: Membutuhkan Scan QR dari Terminal", "status");
    });

    client.on('ready', () => {
        isWhatsAppReady = true;
        log('WhatsApp Terhubung!', 'success');
        log('Mendengarkan tugas notifikasi dari Firestore...');
        listenForNotificationJobs(); // Mulai mendengarkan HANYA setelah siap
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

// --- TITIK MASUK APLIKASI ---
console.log(`====================================================`);
console.log(`  AbTrack WhatsApp Server (Firestore Mode)`);
console.log(`  Versi Stabil - Dirancang untuk Keandalan.`);
console.log(`====================================================`);
initializeWhatsApp();
