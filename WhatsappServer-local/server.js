
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const qrcode = require('qrcode-terminal');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Serve the HTML file for the web UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve static files (CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));


let sock;
let qrCodeData;
let connectionStatus = 'Sedang Menghubungkan...';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // We will display it on the web UI
        browser: Browsers.macOS('Desktop'),
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrCodeData = qr;
            connectionStatus = 'Membutuhkan Scan QR Code';
            io.emit('qr', qr);
            io.emit('status', connectionStatus);
            console.log('QR code generated. Scan it with your phone or open http://localhost:3000 in your browser.');
            // qrcode.generate(qr, { small: true }); // This line is causing issues and is removed.
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) && lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = `Koneksi ditutup. ${shouldReconnect ? 'Mencoba menghubungkan kembali...' : 'Silakan hapus folder baileys_auth_info dan mulai ulang.'}`;
            io.emit('status', connectionStatus);
            console.log(connectionStatus);
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            qrCodeData = null;
            connectionStatus = 'WhatsApp Terhubung!';
            io.emit('status', connectionStatus);
            io.emit('qr', null); // Clear QR code on successful connection
            console.log(connectionStatus);
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Endpoint to send messages
app.post('/send', async (req, res) => {
    if (connectionStatus !== 'WhatsApp Terhubung!') {
        return res.status(400).json({ success: false, message: 'WhatsApp client is not ready.' });
    }

    const { recipient, message, isGroup = false } = req.body;
    if (!recipient || !message) {
        return res.status(400).json({ success: false, message: 'Recipient and message are required.' });
    }

    try {
        const formattedRecipient = isGroup ? recipient : `${recipient.replace(/\D/g, '')}@s.whatsapp.net`;
        
        // Check if recipient exists
        const [result] = await sock.onWhatsApp(formattedRecipient);
        if (!result?.exists) {
            throw new Error(`Nomor ${recipient} tidak terdaftar di WhatsApp.`);
        }

        await sock.sendMessage(formattedRecipient, { text: message });
        console.log(`Pesan terkirim ke ${recipient}`);
        res.json({ success: true, message: 'Pesan berhasil dikirim.' });
    } catch (error) {
        console.error('Error sending message:', error.message);
        res.status(500).json({ success: false, message: `Gagal mengirim pesan: ${error.message}` });
    }
});

// Socket.IO connection handling for the web UI
io.on('connection', (socket) => {
  console.log('Pengguna terhubung ke antarmuka web.');
  socket.emit('status', connectionStatus);
  if (qrCodeData) {
    socket.emit('qr', qrCodeData);
  }
  socket.on('disconnect', () => {
    console.log('Pengguna terputus dari antarmuka web.');
  });
});

server.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
    console.log('Silakan buka alamat di atas di browser Anda untuk memindai QR code.');
    connectToWhatsApp();
});
