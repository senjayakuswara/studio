const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const qrcode = require('qrcode');
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
app.use(express.static(path.join(__dirname, 'public')));

let sock;
let qrCodeData;
let connectionStatus = 'Sedang Menghubungkan...';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: Browsers.macOS('Desktop'),
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrCodeData = qr;
            connectionStatus = 'Membutuhkan Scan QR Code';
            io.emit('qr', qr);
            io.emit('status', connectionStatus);
            console.log('QR code generated. Scan it with your phone.');
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
        console.log(`Message sent to ${recipient}`);
        res.json({ success: true, message: 'Message sent successfully.' });
    } catch (error) {
        console.error('Error sending message:', error.message);
        res.status(500).json({ success: false, message: `Failed to send message: ${error.message}` });
    }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('A user connected to the web UI.');
  socket.emit('status', connectionStatus);
  if (qrCodeData) {
    socket.emit('qr', qrCodeData);
  }
  socket.on('disconnect', () => {
    console.log('User disconnected from the web UI.');
  });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    connectToWhatsApp();
});
