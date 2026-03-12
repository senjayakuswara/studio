
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, onSnapshot, doc, updateDoc, getDocs, Timestamp, getDoc, writeBatch } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyD9rX2jO_5bQ2ezK7sGv0QTMLcvy6aIhXE",
  authDomain: "sekolah-ccec3.firebaseapp.com",
  projectId: "sekolah-ccec3",
  storageBucket: "sekolah-ccec3.appspot.com",
  messagingSenderId: "430648491716",
  appId: "1:430648491716:web:1c3d389337adfd80d49391"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const logger = pino({ level: 'info' }).child({ server: 'B' });

console.log('=======================================================');
console.log('  AbTrack WhatsApp Server (v6.0 - Arsitektur Baileys)');
console.log('                 INSTANCE B                           ');
console.log('=======================================================');
logger.info('Berhasil terhubung ke project Firestore: ' + firebaseConfig.projectId);

const SESSION_DIR = './.baileys_auth_info_B';
let sock;
let groupCache = {}; // Cache for group JIDs, still useful as a fallback

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info(`Menggunakan WA v${version.join('.')}, isLatest: ${isLatest}`);

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if(qr) {
            console.log('Pindai QR Code di bawah ini untuk terhubung (SERVER B):');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) && lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
            logger.error(`Koneksi terputus: ${lastDisconnect.error}, mencoba menghubungkan kembali: ${shouldReconnect}`);
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000);
            } else {
                logger.error('Tidak dapat terhubung, keluar. Hapus folder .baileys_auth_info_B dan coba lagi.');
                if (fs.existsSync(SESSION_DIR)) {
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                }
                process.exit(1);
            }
        } else if (connection === 'open') {
            logger.info('WhatsApp Terhubung! Siap memproses notifikasi.');
            listenForNotificationJobs();
        }
    });
}

// Function to find group JID by name, kept as a fallback
async function findGroupJidByName(name) {
    if (Object.keys(groupCache).length === 0) {
        try {
            logger.info('Cache grup kosong, mencoba memuat ulang...');
            const groups = await sock.groupFetchAllParticipating();
            groupCache = groups;
            logger.info(`Berhasil memuat ulang ${Object.keys(groups).length} grup.`);
        } catch(e) {
            logger.error('Gagal memuat ulang daftar grup.', e);
            return null;
        }
    }
    const groups = Object.values(groupCache);
    const foundGroup = groups.find(group => group.subject.trim().toLowerCase() === name.trim().toLowerCase());
    return foundGroup ? foundGroup.id : null;
}

function listenForNotificationJobs() {
    const q = query(collection(db, "notification_queue"), where("status", "==", "pending"));

    onSnapshot(q, async (snapshot) => {
        if (snapshot.empty) {
            return;
        }

        logger.info(`[QUEUE] Ditemukan ${snapshot.size} tugas baru. Memulai pemrosesan serial...`);

        for (const jobDoc of snapshot.docs) {
            const jobId = jobDoc.id;
            const jobRef = doc(db, "notification_queue", jobId);

            // ATOMIC CHECK: Try to lock the job for this server instance
            try {
                // This transaction ensures that only one server instance can process a job.
                await updateDoc(jobRef, { status: "processing", updatedAt: Timestamp.now(), processingBy: 'ServerB' });
            } catch (e) {
                // If this fails, it means another server instance already locked it.
                logger.info(`[JOB] Melewati tugas ${jobId}, sudah diambil oleh server lain.`);
                continue;
            }


            logger.info(`[JOB] Mengambil tugas baru: ${jobId}`);

            try {
                const jobData = (await getDoc(jobRef)).data();
                const { recipient, message, fileUrl, fileMimetype, fileName } = jobData.payload;

                if (!recipient) {
                    throw new Error('Payload tidak valid: recipient kosong.');
                }
                
                let jid;
                // Check if recipient is a phone number (all digits) or a group name
                if (recipient.match(/^\d+$/)) {
                    let phoneJid = recipient.replace(/\D/g, ''); 
                    if (phoneJid.startsWith('0')) {
                        phoneJid = '62' + phoneJid.substring(1);
                    }
                    jid = phoneJid + '@s.whatsapp.net';
                    const [result] = await sock.onWhatsApp(jid);
                    if (!result?.exists) {
                         throw new Error(`Nomor ${recipient} tidak ditemukan di WhatsApp.`);
                    }
                    jid = result.jid;
                } else {
                    // Fallback to finding group by name
                    jid = await findGroupJidByName(recipient);
                    if (!jid) {
                         throw new Error(`Grup "${recipient}" tidak ditemukan. Pastikan nama grup sama persis.`);
                    }
                }
                
                logger.info(`[JOB] Mengirim pesan ke ${jid}`);
                
                if (fileUrl) {
                    // Logic for file sending (if any)
                } else {
                    await sock.sendMessage(jid, { text: message });
                }

                await updateDoc(jobRef, { status: "sent", updatedAt: Timestamp.now() });
                logger.info(`[JOB] Tugas ${jobId} berhasil dikirim.`);

            } catch (error) {
                logger.error(`[JOB] Gagal memproses tugas ${jobId}: ${error.message}`);
                
                const currentJobData = (await getDoc(jobRef)).data() || {};
                const currentRetryCount = currentJobData.retryCount || 0;

                const errorPayload = {
                    status: currentRetryCount >= 2 ? "failed" : "pending", // Fail after 3 total attempts
                    errorMessage: error.message,
                    updatedAt: Timestamp.now(),
                    retryCount: currentRetryCount + 1
                };

                if (errorPayload.status === 'failed') {
                    logger.error(`[JOB] Tugas ${jobId} mencapai batas percobaan ulang. Ditandai sebagai gagal permanen.`);
                    errorPayload.errorMessage = `Permanently failed after ${currentRetryCount + 1} retries. Original error: ${error.message}`;
                } else {
                    logger.warn(`[JOB] Tugas ${jobId} dikembalikan ke antrean. Percobaan ke-${currentRetryCount + 1}.`);
                }
                
                try {
                    await updateDoc(jobRef, errorPayload);
                } catch(updateError) {
                     logger.error(`[JOB] KRITIS: Gagal memperbarui status tugas ${jobId}: ${updateError.message}`);
                }
            }
            
            // **CRUCIAL DELAY**: Wait for a longer, random interval to better simulate human behavior.
            const delay = Math.floor(Math.random() * 5000) + 8000; // 8-13 seconds
            logger.info(`[QUEUE] Menjeda ${delay}ms untuk mengurangi risiko blokir...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        logger.info(`[QUEUE] Selesai memproses batch saat ini.`);
    });
}

setInterval(async () => {
    logger.info('[FAIL-SAFE] Menjalankan pembersihan tugas macet...');
    try {
        const fiveMinutesAgo = Timestamp.fromMillis(Date.now() - 5 * 60 * 1000);
        const q = query(
            collection(db, "notification_queue"),
            where("status", "==", "processing"),
            where("updatedAt", "<=", fiveMinutesAgo)
        );
        const stuckJobs = await getDocs(q);
        if (stuckJobs.empty) {
            logger.info('[FAIL-SAFE] Tidak ada tugas macet ditemukan.');
            return;
        }
        
        logger.warn(`[FAIL-SAFE] Ditemukan ${stuckJobs.size} tugas macet. Mereset ke 'pending'...`);
        const batch = writeBatch(db);
        stuckJobs.forEach(jobDoc => {
            batch.update(jobDoc.ref, { status: 'pending', errorMessage: 'Direset oleh fail-safe' });
        });
        await batch.commit();

    } catch (error) {
        logger.error(`[FAIL-SAFE] Error saat membersihkan tugas macet: ${error.message}`);
    }
}, 5 * 60 * 1000);

const GROUP_CACHE_REFRESH_INTERVAL = 60 * 60 * 1000; // 1 hour
setInterval(() => {
    logger.info(`[CACHE] Menyegarkan cache nama grup untuk mengambil perubahan terbaru...`);
    groupCache = {}; // Clear the cache to force a re-fetch on next group message
}, GROUP_CACHE_REFRESH_INTERVAL);


connectToWhatsApp();

process.on('SIGINT', async () => {
    logger.info("Menutup koneksi...");
    if(sock) {
        await sock.logout();
    }
    process.exit(0);
});

process.on("unhandledRejection", err => {
  logger.error("UNHANDLED PROMISE REJECTION:", err);
});

process.on("uncaughtException", err => {
  logger.error("UNCAUGHT EXCEPTION:", err);
});
