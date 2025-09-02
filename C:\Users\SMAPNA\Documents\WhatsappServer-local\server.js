const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const pino = require('pino');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

let sock;
let qrCodeData = null;
let connectionStatus = 'connecting';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'baileys_auth_info'));

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // We will also print QR in terminal for easy scanning
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log("QR Code diterima, silahkan pindai di terminal atau buka http://localhost:3000/status di browser.");
            qrCodeData = await qrcode.toDataURL(qr);
            connectionStatus = 'qr';
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) && lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus karena: ', lastDisconnect.error, ', mencoba menghubungkan kembali: ', shouldReconnect);
            connectionStatus = 'disconnected';
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log('Tidak dapat terhubung kembali, koneksi ditutup secara permanen. Anda mungkin perlu memindai ulang QR code.');
            }
        } else if (connection === 'open') {
            console.log('✅ Koneksi WhatsApp berhasil!');
            connectionStatus = 'connected';
            qrCodeData = null;
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Endpoint untuk mendapatkan status koneksi dan QR code (jika ada)
app.get('/status', (req, res) => {
    res.json({
        status: connectionStatus,
        qrCodeUrl: qrCodeData
    });
});

// Endpoint untuk mengirim pesan
app.post('/send', async (req, res) => {
    if (connectionStatus !== 'connected') {
        return res.status(503).json({ success: false, error: 'WhatsApp client belum siap. Silakan pindai QR code terlebih dahulu.' });
    }

    const { recipient, message, isGroup = false } = req.body;
    if (!recipient || !message) {
        return res.status(400).json({ success: false, error: 'Nomor penerima (recipient) dan pesan (message) diperlukan.' });
    }

    try {
        const final_number = isGroup ? recipient : `${recipient.replace(/\D/g, '')}@s.whatsapp.net`;
        
        // Cek apakah nomor atau grup ada
        const [result] = await sock.onWhatsApp(final_number);

        if (!result || !result.exists) {
            console.error(`Nomor atau Grup ${final_number} tidak terdaftar di WhatsApp.`);
            return res.status(400).json({ success: false, error: `Nomor atau Grup ${recipient} tidak terdaftar di WhatsApp.` });
        }
        
        console.log(`Mencoba mengirim pesan ke: ${final_number}`);
        await sock.sendMessage(final_number, { text: message });
        console.log(`Pesan berhasil dikirim ke ${final_number}`);
        res.status(200).json({ success: true, message: `Pesan berhasil dikirim ke ${recipient}` });

    } catch (error) {
        console.error('Gagal mengirim pesan:', error);
        res.status(500).json({ success: false, error: 'Gagal mengirim pesan WhatsApp. Lihat log server untuk detail.' });
    }
});

// Jalankan koneksi dan server
connectToWhatsApp().catch(err => console.log("Gagal menginisialisasi koneksi WhatsApp: ", err));
app.listen(port, () => {
    console.log(`Server notifikasi lokal (Baileys) berjalan di http://localhost:${port}`);
    console.log(`Jika QR code dibutuhkan, pindai yang muncul di terminal ini.`);
});
