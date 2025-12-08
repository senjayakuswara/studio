const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('baileys');
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

console.log("Memulai server WhatsApp...");

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

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Menggunakan Baileys versi: ${version.join('.')}, Terbaru: ${isLatest}`);

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ['AbTrack', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("QR Code diterima. Pindai dari browser atau dari terminal di bawah ini:");
            // Menampilkan di terminal
            qrcode_terminal.generate(qr, { small: true });
            // Mengirim ke web
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

// Endpoint untuk mengirim pesan
app.post('/send', async (req, res) => {
    const { recipient, message, isGroup = false } = req.body;

    if (!recipient || !message) {
        return res.status(400).json({ success: false, error: 'Recipient dan message diperlukan.' });
    }

    if (!sock || connectionStatus !== 'WhatsApp Terhubung!') {
         return res.status(503).json({ success: false, error: 'WhatsApp belum terhubung.' });
    }

    try {
        const fullRecipientId = isGroup ? recipient : `${recipient.replace(/\D/g, '')}@s.whatsapp.net`;
        
        // Cek apakah nomor/grup terdaftar di WhatsApp
        const [result] = await sock.onWhatsApp(fullRecipientId);

        if (result?.exists) {
            await sock.sendMessage(fullRecipientId, { text: message });
            console.log(`Pesan berhasil dikirim ke ${recipient}`);
            res.status(200).json({ success: true, message: 'Pesan berhasil dikirim.' });
        } else {
            console.warn(`Nomor atau Grup ${recipient} tidak terdaftar di WhatsApp.`);
            res.status(404).json({ success: false, error: `Nomor atau Grup ${recipient} tidak terdaftar di WhatsApp.` });
        }
    } catch (error) {
        console.error('Gagal mengirim pesan:', error);
        res.status(500).json({ success: false, error: 'Gagal mengirim pesan.' });
    }
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
