const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
    }
});

const port = 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

console.log("Mempersiapkan WhatsApp Client...");
io.emit('log', 'Mempersiapkan WhatsApp Client...');

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'abtrack-server'
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    }
});

io.on('connection', (socket) => {
    console.log('Browser client terhubung via socket.io');
    socket.emit('log', 'Menunggu status koneksi WhatsApp...');

    client.on('qr', (qr) => {
        console.log('QR Diterima, kirim ke client');
        qrcode.toDataURL(qr, (err, url) => {
            if (err) {
                console.error('Gagal membuat QR code data URL');
                socket.emit('log', 'Gagal membuat QR code.');
                return;
            }
            socket.emit('qr', url);
            socket.emit('log', 'QR Code diterima. Silakan pindai.');
        });
    });

    client.on('auth_failure', (msg) => {
        console.error('Autentikasi Gagal:', msg);
        socket.emit('log', `Autentikasi Gagal: ${msg}`);
    });

    client.on('authenticated', () => {
        console.log('Autentikasi berhasil.');
        socket.emit('log', 'Autentikasi berhasil.');
    });

    client.on('ready', () => {
        console.log('✅ WhatsApp Client siap digunakan!');
        socket.emit('ready', 'WhatsApp Client siap digunakan!');
        socket.emit('log', 'WhatsApp Client siap digunakan!');
    });

    client.on('disconnected', (reason) => {
        console.log('Klien terputus, alasan:', reason);
        socket.emit('disconnected', 'Koneksi WhatsApp terputus. Mencoba menghubungkan kembali...');
        socket.emit('log', `Koneksi WhatsApp terputus: ${reason}. Inisialisasi ulang...`);
        // Hapus sesi lama untuk memaksa pemindaian QR baru jika terjadi masalah
        // Ini adalah tindakan drastis, mungkin perlu penanganan yang lebih halus
        // client.destroy(); 
        // client.initialize();
    });
});

client.initialize().catch(err => {
    console.error('Gagal menginisialisasi client:', err);
    io.emit('log', `Error Inisialisasi Kritis: ${err.message}`);
});

// Endpoint untuk mengirim pesan
app.post('/send', async (req, res) => {
    // Periksa status client sebelum mengirim
    const clientState = await client.getState();
    if (clientState !== 'CONNECTED') {
         return res.status(503).json({ success: false, error: 'WhatsApp client belum siap atau tidak terhubung.' });
    }

    const { recipient, message, isGroup = false } = req.body;

    if (!recipient || !message) {
        return res.status(400).json({ success: false, error: 'Nomor penerima (recipient) dan pesan (message) diperlukan.' });
    }
        
    const final_number = isGroup ? recipient : `${recipient.replace(/\D/g, '')}@c.us`;

    try {
        if (!isGroup) {
            const isRegistered = await client.isRegisteredUser(final_number);
            if (!isRegistered) {
                console.error(`Nomor ${final_number} tidak terdaftar di WhatsApp.`);
                return res.status(400).json({ success: false, error: `Nomor ${recipient} tidak terdaftar di WhatsApp.` });
            }
        }
        
        console.log(`Mencoba mengirim pesan ke: ${final_number}`);
        await client.sendMessage(final_number, message);
        console.log(`Pesan teks berhasil dikirim ke ${final_number}`);
        res.status(200).json({ success: true, message: `Pesan berhasil dikirim ke ${recipient}` });

    } catch (error) {
        console.error(`Gagal mengirim pesan ke ${final_number}:`, error);
        res.status(500).json({ success: false, error: 'Gagal mengirim pesan WhatsApp. Lihat log server untuk detail.' });
    }
});

server.listen(port, () => {
    console.log(`Server notifikasi lokal berjalan di http://localhost:${port}`);
    console.log(`Buka browser dan kunjungi alamat di atas untuk melihat status dan QR code.`);
});
