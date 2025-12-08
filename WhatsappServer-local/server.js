
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('baileys');
const { Server } = require('socket.io');
const express = require('express');
const http = require('http');
const qrcode = require('qrcode');
const qrcode_terminal = require('qrcode-terminal');
const pino = require('pino');
const path = require('path');

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
let qrCodeData;
let connectionStatus = 'Menunggu koneksi...';

function updateStatus(status, qr = null) {
    connectionStatus = status;
    qrCodeData = qr;
    io.emit('statusUpdate', { status: connectionStatus, qr: qrCodeData });
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
        // Pertimbangkan untuk mengembalikan job ke antrian jika terjadi error sementara
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
        browser: ['AbTrack', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("QR Code diterima. Pindai dari browser atau dari terminal di bawah ini:");
            // 1. Menampilkan di terminal
            qrcode_terminal.generate(qr, { small: true });
            // 2. Mengirim ke web
            const qrForWeb = await qrcode.toDataURL(qr);
            updateStatus('Membutuhkan Scan QR', qrForWeb);
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            let reason = `Koneksi ditutup.`;
            if(statusCode) {
                reason += ` Alasan: ${statusCode}.`;
            }

            updateStatus(`${reason} ${shouldReconnect ? 'Mencoba menghubungkan kembali...' : ''}`);
            
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000);
            } else {
                 console.log("Tidak bisa menghubungkan kembali. Jika ini terjadi berulang kali, hapus folder 'baileys_auth_info' dan restart.");
                 updateStatus('Gagal terhubung secara permanen. Silakan hapus folder baileys_auth_info dan mulai ulang server.');
            }
        } else if (connection === 'open') {
            updateStatus('WhatsApp Terhubung!');
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
    processQueue();

    // Langsung berikan respons sukses karena pesan sudah berhasil masuk antrian
    res.status(202).json({ success: true, message: 'Pesan berhasil ditambahkan ke antrian pengiriman.' });
});


io.on('connection', (socket) => {
    console.log('Client terhubung ke status server');
    socket.emit('statusUpdate', { status: connectionStatus, qr: qrCodeData });
});

server.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
    console.log("Silakan buka alamat di atas di browser Anda untuk memindai QR code.");
    connectToWhatsApp();
});
