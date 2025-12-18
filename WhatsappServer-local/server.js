const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('baileys');
const express = require('express');
const http = require('http');
const qrcode = require('qrcode-terminal');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

console.log("Menjalankan server...");

app.use(express.json());

let sock;
let connectionStatus = 'Menunggu koneksi...';

function updateStatus(status) {
    connectionStatus = status;
    console.log(`Status berubah: ${status}`);
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // This will be handled manually but kept for some versions
        browser: ['AbTrack', 'Chrome', '1.0.0']
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
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode === DisconnectReason.connectionLost;
            let reason = `Koneksi ditutup.`;
            if (statusCode) {
                reason += ` Alasan: ${statusCode}.`;
            }

            if (shouldReconnect) {
                updateStatus(`${reason} Mencoba menghubungkan kembali dalam 5 detik...`);
                setTimeout(connectToWhatsApp, 5000);
            } else {
                let instruction = "Koneksi terputus secara permanen.";
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

app.post('/send', async (req, res) => {
    const { recipient, message } = req.body;

    if (!recipient || !message) {
        return res.status(400).json({ success: false, error: 'Recipient dan message diperlukan.' });
    }

    if (sock && connectionStatus === 'WhatsApp Terhubung!') {
        try {
            const fullRecipientId = `${recipient.replace(/\D/g, '')}@s.whatsapp.net`;
            const [result] = await sock.onWhatsApp(fullRecipientId);

            if (result?.exists) {
                await sock.sendMessage(fullRecipientId, { text: message });
                res.status(200).json({ success: true, message: 'Pesan berhasil dikirim.' });
            } else {
                res.status(404).json({ success: false, error: `Penerima ${recipient} tidak terdaftar di WhatsApp.` });
            }
        } catch (error) {
            console.error('Gagal mengirim pesan:', error);
            res.status(500).json({ success: false, error: 'Gagal mengirim pesan.' });
        }
    } else {
        res.status(503).json({ success: false, error: 'WhatsApp tidak terhubung.' });
    }
});

server.listen(PORT, () => {
    console.log(`Server HTTP berjalan di http://localhost:${PORT}`);
    connectToWhatsApp();
});
