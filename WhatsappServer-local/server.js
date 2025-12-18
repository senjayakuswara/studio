const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for simplicity
    }
});

const PORT = process.env.PORT || 3000;
console.log("Menjalankan server...");

app.use(express.json());

let sock;
let connectionStatus = 'Menunggu koneksi...';
let lastQR = null;

function updateStatus(status, qr = null) {
    connectionStatus = status;
    lastQR = qr;
    console.log(`Status berubah: ${status}`);
    io.emit('statusUpdate', { status, qr });
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Menggunakan Baileys v${version.join('.')}, Latest: ${isLatest}`);

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // We will handle QR manually
        auth: state,
        browser: ['AbTrack', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            lastQR = qr;
            console.log("------------------------------------------------");
            console.log("Pindai QR Code di bawah ini dengan WhatsApp Anda:");
            qrcode.generate(qr, { small: true });
            console.log("------------------------------------------------");
            updateStatus('Membutuhkan Scan QR dari Terminal', qr);
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode === DisconnectReason.connectionLost;
            let reason = `Koneksi ditutup.`;
            if(statusCode) {
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

io.on('connection', (socket) => {
    console.log('Client terhubung ke status server');
    socket.emit('statusUpdate', { status: connectionStatus, qr: lastQR });
});


app.post('/send', async (req, res) => {
    const { recipient, message, isGroup = false } = req.body;

    if (!recipient || !message) {
        return res.status(400).json({ success: false, error: 'Recipient dan message diperlukan.' });
    }

    if (sock && connectionStatus === 'WhatsApp Terhubung!') {
        try {
            const fullRecipientId = isGroup ? recipient : `${recipient.replace(/\D/g, '')}@s.whatsapp.net`;
            
            // For groups, we assume the ID is correct. For individuals, we check.
            if (!isGroup) {
                const [result] = await sock.onWhatsApp(fullRecipientId);
                if (!result?.exists) {
                    return res.status(404).json({ success: false, error: `Penerima ${recipient} tidak terdaftar di WhatsApp.` });
                }
            }

            await sock.sendMessage(fullRecipientId, { text: message });
            res.status(200).json({ success: true, message: 'Pesan berhasil dikirim.' });

        } catch (error) {
            console.error('Gagal mengirim pesan:', error);
            res.status(500).json({ success: false, error: 'Gagal mengirim pesan di server.' });
        }
    } else {
        res.status(503).json({ success: false, error: 'WhatsApp tidak terhubung.' });
    }
});

server.listen(PORT, () => {
    console.log(`Server HTTP berjalan di http://localhost:${PORT}`);
    connectToWhatsApp();
});
