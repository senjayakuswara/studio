
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
const messageQueue = [];
let isProcessingQueue = false;

function updateStatus(status, qr = null) {
    connectionStatus = status;
    lastQR = qr;
    console.log(`Status berubah: ${status}`);
    io.emit('statusUpdate', { status, qr });
}

// Function to get a random delay
function getRandomDelay(min = 8000, max = 20000) { // 8 to 20 seconds
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function processQueue() {
    if (isProcessingQueue || messageQueue.length === 0 || connectionStatus !== 'WhatsApp Terhubung!') {
        isProcessingQueue = false;
        return;
    }
    isProcessingQueue = true;

    const { recipient, message, isGroup, res } = messageQueue.shift();
    
    try {
        console.log(`Mengirim pesan ke: ${recipient}`);
        const fullRecipientId = isGroup ? recipient : `${recipient.replace(/\D/g, '')}@s.whatsapp.net`;

        if (!isGroup) {
            const [result] = await sock.onWhatsApp(fullRecipientId);
            if (!result?.exists) {
                console.warn(`Penerima ${recipient} tidak terdaftar di WhatsApp. Melewati...`);
                // Do not respond to the original request, as it was already accepted.
            } else {
                 await sock.sendMessage(fullRecipientId, { text: message });
                 console.log(`Pesan berhasil dikirim ke ${recipient}.`);
            }
        } else {
             await sock.sendMessage(fullRecipientId, { text: message });
             console.log(`Pesan grup berhasil dikirim.`);
        }
        
    } catch (error) {
        console.error(`Gagal mengirim pesan ke ${recipient}:`, error);
    } finally {
        const delay = getRandomDelay();
        console.log(`Menunggu ${delay / 1000} detik sebelum pesan berikutnya...`);
        setTimeout(() => {
            isProcessingQueue = false;
            processQueue();
        }, delay);
    }
}


async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Menggunakan Baileys v${version.join('.')}, Latest: ${isLatest}`);

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
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
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            let reason = `Koneksi ditutup.`;
            if (statusCode) {
                reason += ` Alasan: ${statusCode}.`;
            }

            if (shouldReconnect) {
                reason += " Mencoba menghubungkan kembali...";
                console.log("Mencoba menghubungkan kembali...");
                connectToWhatsApp();
            } else {
                 let instruction = "Koneksi terputus secara permanen karena Anda keluar dari perangkat.";
                if (statusCode === DisconnectReason.badSession) {
                    instruction = "Koneksi gagal (Sesi Buruk). Silakan HAPUS folder 'baileys_auth_info' dan mulai ulang server.";
                }
                console.log(`\n!!! PERINGATAN: ${instruction} !!!\n`);
                reason = instruction;
            }
            updateStatus(reason);
            
        } else if (connection === 'open') {
            updateStatus('WhatsApp Terhubung!');
            console.log("WhatsApp Terhubung!");
            if(!isProcessingQueue) {
                processQueue();
            }
        }
    });
}

io.on('connection', (socket) => {
    console.log('Client terhubung ke status server');
    socket.emit('statusUpdate', { status: connectionStatus, qr: lastQR });
});


app.post('/send', (req, res) => {
    const { recipient, message, isGroup = false } = req.body;

    if (!recipient || !message) {
        return res.status(400).json({ success: false, error: 'Recipient dan message diperlukan.' });
    }

    // Add to queue
    messageQueue.push({ recipient, message, isGroup, res });
    console.log(`Pesan untuk ${recipient} ditambahkan ke antrean. Total antrean: ${messageQueue.length}`);
    
    // Immediately respond to the client that the message is queued
    res.status(202).json({ success: true, message: 'Pesan telah diterima dan dimasukkan ke dalam antrean.' });

    // Start processing the queue if it's not already running
    if (!isProcessingQueue) {
        processQueue();
    }
});

server.listen(PORT, () => {
    console.log(`Server HTTP berjalan di http://localhost:${PORT}`);
    connectToWhatsApp();
});
