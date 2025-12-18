
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('baileys');
const { Server } = require('socket.io');
const express = require('express');
const http = require('http');
const pino = require('pino');
const path = require('path');
const qrcode = require('qrcode-terminal');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

console.log("Menjalankan server...");

// --- Sistem Antrian Notifikasi ---
const messageQueue = [];
let isProcessingQueue = false;
// ---------------------------------

// Middleware untuk parse JSON body
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let sock;
let connectionStatus = 'Menunggu koneksi...';

function updateStatus(status) {
    connectionStatus = status;
    io.emit('statusUpdate', { status: connectionStatus });
    console.log(`Status berubah: ${status}`);
}

// --- Fungsi untuk memproses antrian ---
async function processQueue() {
    if (isProcessingQueue || messageQueue.length === 0) {
        return;
    }

    isProcessingQueue = true;
    const job = messageQueue.shift(); // Ambil tugas pertama dari antrian

    try {
        if (sock && connectionStatus === 'WhatsApp Terhubung!') {
            const { recipient, message, isGroup } = job;
            const fullRecipientId = isGroup ? recipient : `${recipient.replace(/\D/g, '')}@s.whatsapp.net`;
            
            const [result] = await sock.onWhatsApp(fullRecipientId);

            if (result?.exists) {
                await sock.sendMessage(fullRecipientId, { text: message });
                console.log(`Pesan berhasil dikirim ke ${recipient}`);
            } else {
                console.warn(`Penerima ${recipient} tidak terdaftar di WhatsApp. Pesan dilewati.`);
            }
        } else {
            console.warn("WhatsApp tidak terhubung. Mengembalikan pesan ke antrian.");
            messageQueue.unshift(job); // Kembalikan ke depan antrian jika koneksi putus
        }
    } catch (error) {
        console.error('Gagal mengirim pesan dari antrian:', error);
        // messageQueue.unshift(job); 
    } finally {
        // Jeda acak antara 3 sampai 8 detik
        const randomDelay = Math.floor(Math.random() * (8000 - 3000 + 1) + 3000);
        console.log(`Menunggu ${randomDelay / 1000} detik sebelum pesan berikutnya...`);
        setTimeout(() => {
            isProcessingQueue = false;
            processQueue(); // Panggil lagi untuk memproses tugas selanjutnya
        }, randomDelay);
    }
}


async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: Browsers.macOS('Desktop'),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("------------------------------------------------");
            console.log("Pindai QR Code di bawah ini dengan WhatsApp Anda:");
            qrcode.generate(qr, { small: true });
            console.log("------------------------------------------------");
            updateStatus('Membutuhkan Scan QR dari Terminal');
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = statusCode === DisconnectReason.connectionLost;

            let reason = `Koneksi ditutup.`;
             if (statusCode) {
                reason += ` Alasan: ${statusCode}.`;
            }
            
            updateStatus(`${reason} ${shouldReconnect ? 'Mencoba menghubungkan kembali dalam 5 detik...' : 'Koneksi terputus secara permanen.'}`);
            
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000);
            } else {
                 let instruction = "Tidak bisa menyambung kembali secara otomatis.";
                 if (statusCode === DisconnectReason.badSession) {
                    instruction = "Koneksi gagal (Sesi Buruk). Silakan HAPUS folder 'baileys_auth_info' dan mulai ulang server.";
                 } else if (statusCode === DisconnectReason.loggedOut) {
                    instruction = "Anda telah keluar dari perangkat. Hapus folder 'baileys_auth_info' dan pindai ulang QR code.";
                 } else if (statusCode === DisconnectReason.connectionReplaced) {
                    instruction = "Koneksi digantikan, sesi baru dibuka di tempat lain. Tutup server ini.";
                 }
                 console.log(`\n!!! PERINGATAN: ${instruction} !!!\n`);
                 updateStatus(instruction);
            }
        } else if (connection === 'open') {
            updateStatus('WhatsApp Terhubung!');
            console.log("WhatsApp Terhubung!");
        }
    });
}

// Endpoint untuk MENAMBAHKAN pesan ke antrian
app.post('/send', async (req, res) => {
    const { recipient, message, isGroup = false } = req.body;

    if (!recipient || !message) {
        return res.status(400).json({ success: false, error: 'Recipient dan message diperlukan.' });
    }
    
    // Tambahkan pesan ke antrian
    messageQueue.push({ recipient, message, isGroup });
    console.log(`Pesan untuk ${recipient} ditambahkan ke antrian. Total antrian: ${messageQueue.length}`);
    
    // Mulai proses antrian jika belum berjalan
    if (!isProcessingQueue) {
        processQueue();
    }

    // Langsung berikan respons sukses karena pesan sudah berhasil masuk antrian
    res.status(202).json({ success: true, message: 'Pesan berhasil ditambahkan ke antrian pengiriman.' });
});


io.on('connection', (socket) => {
    console.log('Client terhubung ke status server');
    socket.emit('statusUpdate', { status: connectionStatus });
});

server.listen(PORT, () => {
    console.log(`Server HTTP berjalan di http://localhost:${PORT}`);
    connectToWhatsApp();
});
