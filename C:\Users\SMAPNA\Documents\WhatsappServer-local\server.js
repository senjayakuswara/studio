
const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

console.log("Mempersiapkan WhatsApp Client...");

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
    }
});

client.on('qr', (qr) => {
    console.log('--------------------------------------------------');
    console.log('--- PINDAI QR CODE INI DENGAN WHATSAPP ANDA ---');
    qrcode.generate(qr, { small: true });
    console.log('--------------------------------------------------');
});

client.on('authenticated', () => {
    console.log('Autentikasi berhasil.');
});

client.on('ready', () => {
    console.log('✅ WhatsApp Client siap digunakan!');
});

client.on('disconnected', (reason) => {
    console.log('Klien terputus, alasan:', reason);
    client.initialize();
});

client.initialize().catch(err => {
    console.error('Gagal menginisialisasi client:', err);
});

// Endpoint untuk mengirim pesan
app.post('/send', async (req, res) => {
    const { recipient, message, isGroup = false } = req.body;

    if (!recipient || !message) {
        return res.status(400).json({ success: false, error: 'Nomor penerima (recipient) dan pesan (message) diperlukan.' });
    }
        
    const final_number = isGroup ? recipient : `${recipient.replace(/\D/g, '')}@c.us`;

    try {
        console.log(`Mencoba mengirim pesan ke: ${final_number}`);
            
        await client.sendMessage(final_number, message);
        console.log(`Pesan teks berhasil dikirim ke ${final_number}`);

        res.status(200).json({ success: true, message: `Pesan berhasil dikirim ke ${recipient}` });

    } catch (error) {
        let errorMessage = 'Gagal mengirim pesan WhatsApp. Lihat log server untuk detail.';
            
        if (error.message && error.message.includes('message is not a valid')) {
            errorMessage = `Nomor ${recipient} tidak terdaftar di WhatsApp.`;
        } else if (error.message && error.message.includes('Evaluation failed')) {
            errorMessage = `Nomor ${recipient} tidak valid atau tidak terdaftar di WhatsApp.`
        } else if (error.message) {
            errorMessage = error.message;
        }

        console.error(`Gagal mengirim pesan ke ${final_number}:`, errorMessage);
        console.error("Full Error Object:", error);
        res.status(500).json({ success: false, error: errorMessage });
    }
});

app.listen(port, () => {
    console.log(`Server notifikasi lokal berjalan di http://localhost:${port}`);
});
