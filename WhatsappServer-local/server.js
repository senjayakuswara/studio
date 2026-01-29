
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const express = require('express');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, onSnapshot, doc, updateDoc, getDocs, Timestamp } = require('firebase/firestore');

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

const logger = pino({ level: 'info' });

console.log('====================================================');
console.log('  AbTrack WhatsApp Server (v6.0 - Arsitektur Baileys)');
console.log('====================================================');
logger.info('Berhasil terhubung ke project Firestore: ' + firebaseConfig.projectId);

const SESSION_DIR = './.baileys_auth_info';
let sock;
let groupCache = {}; // Cache untuk menyimpan daftar grup

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info(`Menggunakan WA v${version.join('.')}, isLatest: ${isLatest}`);

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            logger.warn('Pindai QR Code di bawah ini untuk terhubung:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) && lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
            logger.error(`Koneksi terputus: ${lastDisconnect.error}, mencoba menghubungkan kembali: ${shouldReconnect}`);
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000);
            } else {
                logger.error('Tidak dapat terhubung, keluar. Hapus folder .baileys_auth_info dan coba lagi.');
                if (fs.existsSync(SESSION_DIR)) {
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                }
                process.exit(1);
            }
        } else if (connection === 'open') {
            logger.info('WhatsApp Terhubung! Siap memproses notifikasi.');
            
            // Muat daftar grup saat pertama kali terhubung
            try {
                logger.info('Memuat daftar grup...');
                const groups = await sock.groupFetchAllParticipating();
                groupCache = groups;
                logger.info(`Berhasil memuat ${Object.keys(groups).length} grup.`);
            } catch(e) {
                logger.error('Gagal memuat daftar grup saat startup.', e);
            }

            listenForNotificationJobs();
        }
    });
}

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

    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            return;
        }

        snapshot.docs.forEach(async (jobDoc) => {
            const jobData = jobDoc.data();
            const jobId = jobDoc.id;
            const jobRef = doc(db, "notification_queue", jobId);

            logger.info(`[JOB] Mengambil tugas baru: ${jobId}`);

            try {
                await updateDoc(jobRef, { status: "processing", updatedAt: Timestamp.now() });

                const { recipient, message } = jobData.payload;
                if (!recipient || !message) {
                    throw new Error('Payload tidak valid: recipient atau message kosong.');
                }
                
                let jid;
                // Cek apakah recipient adalah nama grup atau nomor telepon
                if (recipient.match(/^\d+$/)) { // Jika hanya angka, anggap nomor telepon
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
                } else { // Anggap sebagai nama grup
                    jid = await findGroupJidByName(recipient);
                    if (!jid) {
                         throw new Error(`Nomor atau Grup ${recipient} tidak ditemukan di WhatsApp.`);
                    }
                }
                
                logger.info(`[JOB] Mengirim pesan ke ${jid}`);
                await sock.sendMessage(jid, { text: message });

                await updateDoc(jobRef, { status: "sent", updatedAt: Timestamp.now() });
                logger.info(`[JOB] Tugas ${jobId} berhasil dikirim.`);

            } catch (error) {
                logger.error(`[JOB] Gagal memproses tugas ${jobId}: ${error.message}`);
                await updateDoc(jobRef, {
                    status: "failed",
                    errorMessage: error.message,
                    updatedAt: Timestamp.now()
                });
            }
        });
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
        const batch = [];
        stuckJobs.forEach(doc => {
            batch.push(updateDoc(doc.ref, { status: 'pending', errorMessage: 'Direset oleh fail-safe' }));
        });
        await Promise.all(batch);

    } catch (error) {
        logger.error(`[FAIL-SAFE] Error saat membersihkan tugas macet: ${error.message}`);
    }
}, 5 * 60 * 1000);

const expressApp = express();
const PORT = 8000;
expressApp.get('/', (req, res) => {
    res.send('WhatsApp Server (Baileys) is running.');
});
expressApp.listen(PORT, () => {
    logger.info(`Server Express berjalan di port ${PORT}`);
});

connectToWhatsApp();

process.on('SIGINT', async () => {
    logger.info("Menutup koneksi...");
    if(sock) {
        await sock.logout();
    }
    process.exit(0);
});
