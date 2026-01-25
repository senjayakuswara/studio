
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

// --- SETUP ---
const PORT = process.env.PORT || 3000;

// --- Firebase Admin SDK ---
let db;
try {
    const serviceAccountPath = path.join(__dirname, 'credentials.json');
    if (!fs.existsSync(serviceAccountPath)) {
        throw new Error("File credentials.json tidak ditemukan. Pastikan Anda telah menempatkan file kunci service account dari Firebase Console di folder ini.");
    }
    const serviceAccount = require(serviceAccountPath);

    // Validasi isi file credentials.json
    if (!serviceAccount || !serviceAccount.project_id || serviceAccount.project_id.includes("YOUR_PROJECT_ID")) {
        throw new Error("File credentials.json tidak valid atau masih berupa placeholder. Pastikan Anda telah menggantinya dengan file kredensial asli yang diunduh dari Firebase Console.");
    }

    initializeApp({
        credential: cert(serviceAccount)
    });
    db = getFirestore();
    const projectId = process.env.GCLOUD_PROJECT || serviceAccount.project_id;
    console.log(`[FIREBASE] Mencoba terhubung ke project Firestore: ${projectId}`);
} catch (error) {
    console.error("[CRITICAL] Gagal terhubung ke Firebase Admin:", error.message);
    process.exit(1);
}

// --- STATE MANAGEMENT ---
let client;
let qrCodeValue = null;
let connectionStatus = 'Server Dimulai...';
let processingQueue = false;
const jobQueue = [];

// --- UTILITY FUNCTIONS ---
const log = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString('id-ID');
    console.log(`[${timestamp}] ${message}`);
};

const updateStatus = (status, qr = null) => {
    connectionStatus = status;
    qrCodeValue = qr;
    log(`Status berubah: ${status}`, 'status');
};

function getRandomDelay() {
    // 5 to 15 seconds
    return Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
}

async function sendMessageWithTimeout(recipientId, message, timeout = 30000) {
    return new Promise(async (resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Waktu pengiriman habis setelah ${timeout / 1000} detik.`));
        }, timeout);

        try {
            const result = await client.sendMessage(recipientId, message);
            clearTimeout(timer);
            resolve(result);
        } catch (error) {
            clearTimeout(timer);
            reject(error);
        }
    });
}

// --- CORE LOGIC ---
async function processQueue() {
    if (processingQueue || jobQueue.length === 0) {
        return;
    }

    if (connectionStatus !== 'WhatsApp Terhubung!') {
        log('WhatsApp tidak terhubung, pemrosesan ditunda.', 'warning');
        return;
    }

    processingQueue = true;
    const job = jobQueue.shift();
    const jobRef = db.collection('notification_queue').doc(job.id);
    const studentRef = job.metadata?.studentId ? db.collection('students').doc(job.metadata.studentId) : null;

    log(`Memproses tugas untuk: ${job.payload.recipient}...`);

    try {
        const recipientId = `${String(job.payload.recipient).replace(/\D/g, '')}@c.us`;
        
        // Pengecekan isRegisteredUser() dihapus karena tidak andal dan bisa menyebabkan server hang.
        // Langsung coba kirim, dan biarkan blok catch menangani jika nomor tidak terdaftar.

        await sendMessageWithTimeout(recipientId, job.payload.message);
        
        await jobRef.update({ status: 'success', updatedAt: new Date(), errorMessage: '' });
        log(`Pesan berhasil dikirim ke ${job.payload.recipient}.`, 'success');
        
        // If the number was previously invalid, mark it as valid now
        if (studentRef) {
            await studentRef.update({ parentWaStatus: 'valid' });
        }

    } catch (error) {
        log(`Gagal mengirim pesan ke ${job.payload.recipient}: ${error.message}`, 'error');
        await jobRef.update({ status: 'failed', errorMessage: error.message, updatedAt: new Date() });
        
        // Mark student's WA number as invalid if the error indicates a registration issue
        const isInvalidNumberError = /tidak terdaftar|not registered|not a valid/i.test(error.message);
        if (studentRef && isInvalidNumberError) {
            await studentRef.update({ parentWaStatus: 'invalid' });
            log(`Nomor ${job.payload.recipient} ditandai sebagai tidak valid untuk siswa ID: ${job.metadata.studentId}`);
        }
    }

    const delay = getRandomDelay();
    log(`Menunggu jeda ${delay / 1000} detik sebelum tugas berikutnya...`);

    setTimeout(() => {
        processingQueue = false;
        processQueue(); // Process next item
    }, delay);
}


function listenForJobs() {
    const q = db.collection('notification_queue').where('status', '==', 'pending').orderBy('createdAt', 'asc');

    q.onSnapshot(snapshot => {
        if (!processingQueue) { // Initial connection confirmation
            log('[FIREBASE] Berhasil terhubung dan mendengarkan antrean notifikasi.');
        }
        if (snapshot.empty) {
            log('Tidak ada tugas notifikasi baru.');
            return;
        }

        const newJobs = [];
        snapshot.docChanges().forEach(change => {
            if (change.type === 'added') {
                const jobData = { id: change.doc.id, ...change.doc.data() };
                // Prevent adding duplicates if listener fires multiple times
                if (!jobQueue.some(j => j.id === jobData.id) && !processingQueue) {
                    newJobs.push(jobData);
                }
            }
        });

        if (newJobs.length > 0) {
            jobQueue.push(...newJobs);
            log(`${newJobs.length} tugas baru ditambahkan ke antrean. Total antrean: ${jobQueue.length}`);
            processQueue(); // Start processing if not already
        }
    }, err => {
        const errorMessage = String(err);
        if (errorMessage.includes("requires an index")) {
            log("================================= ERROR DATABASE =================================", 'error');
            log("Query Firestore memerlukan Index. Ini adalah setup satu kali yang wajib.", 'error');
            log("Silakan salin dan buka URL di bawah ini di browser Anda untuk membuatnya:", 'error');
            
            const urlMatch = errorMessage.match(/(https?:\/\/[^\s]+)/);
            if (urlMatch) {
                log(urlMatch[0], 'qr');
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

function initializeWhatsApp() {
    log('Menginisialisasi WhatsApp Client...');
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--unhandled-rejections=strict']
        }
    });

    client.on('qr', qr => {
        log("Pindai QR Code di bawah ini dengan WhatsApp Anda:", 'qr');
        qrcode.generate(qr, { small: true });
        updateStatus('Membutuhkan Scan QR dari Terminal', qr);
    });

    client.on('ready', () => {
        updateStatus('WhatsApp Terhubung!');
        log('Mendengarkan tugas notifikasi dari Firestore...');
        listenForJobs(); // Start listening for jobs once ready
    });

    client.on('auth_failure', msg => {
        const reason = `Autentikasi gagal: ${msg}. Hapus folder .wwebjs_auth dan mulai ulang.`;
        log(reason, 'error');
        updateStatus(reason);
    });

    client.on('disconnected', (reason) => {
        const message = `Koneksi WhatsApp terputus: ${reason}.`;
        log(message, 'error');
        updateStatus(message);
    });

    client.initialize().catch(err => {
        log(`Gagal menginisialisasi client WhatsApp: ${err}`, 'error');
        updateStatus("Inisialisasi Gagal. Periksa log.");
    });
}

// --- SERVER START ---
console.log(`====================================================`);
console.log(`  AbTrack WhatsApp Server (Firestore Mode)`);
console.log(`  Server ini akan secara otomatis memproses notifikasi`);
console.log(`  dari antrean di database Firestore.`);
console.log(`====================================================`);
initializeWhatsApp();
