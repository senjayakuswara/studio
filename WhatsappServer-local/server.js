const express = require('express');
const cors = require('cors'); // Impor middleware cors
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
const port = 3000; // Server lokal akan berjalan di port ini

// Gunakan middleware CORS untuk mengizinkan semua permintaan cross-origin
app.use(cors());

// Middleware untuk membaca JSON dari request body
app.use(express.json());

console.log("Mempersiapkan WhatsApp Client...");

// Inisialisasi WhatsApp Client dengan sesi lokal
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'abtrack-server'
    }),
    puppeteer: {
        headless: true, // Jalankan tanpa membuka jendela browser
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

// Event saat QR code perlu dipindai
client.on('qr', (qr) => {
    console.log('--------------------------------------------------');
    console.log('--- PINDAI QR CODE INI DENGAN WHATSAPP ANDA ---');
    qrcode.generate(qr, { small: true });
    console.log('--------------------------------------------------');
});

// Event saat client berhasil terautentikasi
client.on('authenticated', () => {
    console.log('Autentikasi berhasil.');
});

// Event saat client siap digunakan
client.on('ready', () => {
    console.log('✅ WhatsApp Client siap digunakan!');
});

// Event saat koneksi terputus
client.on('disconnected', (reason) => {
    console.log('Klien terputus, alasan:', reason);
    // Coba inisialisasi ulang jika terputus
    client.initialize();
});

// Mulai inisialisasi client
client.initialize().catch(err => {
    console.error('Gagal menginisialisasi client:', err);
});

// Endpoint untuk mengirim pesan
app.post('/send', async (req, res) => {
    const { recipient, message } = req.body;

    if (!recipient || !message) {
        return res.status(400).json({ success: false, error: 'Nomor penerima (recipient) dan pesan (message) diperlukan.' });
    }
    
    // Cek jika target adalah grup (berisi '@g.us') atau individu
    const isGroup = recipient.includes('@g.us');
    const target = isGroup ? recipient : `${recipient.replace(/\D/g, '')}@c.us`;

    try {
        console.log(`Mengirim pesan ke: ${target}`);
        await client.sendMessage(target, message);
        res.status(200).json({ success: true, message: `Pesan berhasil dikirim ke ${recipient}` });
    } catch (error) {
        console.error(`Gagal mengirim pesan ke ${target}:`, error);
        res.status(500).json({ success: false, error: 'Gagal mengirim pesan WhatsApp.' });
    }
});

// Jalankan server Express
app.listen(port, () => {
    console.log(`Server notifikasi lokal berjalan di http://localhost:${port}`);
});
