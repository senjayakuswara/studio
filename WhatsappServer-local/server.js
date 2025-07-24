
const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

console.log("Mempersiapkan WhatsApp Client...");

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'abtrack-server'
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
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

// Endpoint untuk mengirim pesan (METODE BARU YANG LEBIH STABIL)
app.post('/send', async (req, res) => {
    const { recipient, message, isGroup = false } = req.body;

    if (!recipient || !message) {
        return res.status(400).json({ success: false, error: 'Nomor penerima (recipient) dan pesan (message) diperlukan.' });
    }
    
    // Format nomor untuk individual, atau gunakan ID grup langsung
    const final_number = isGroup ? recipient : `${recipient.replace(/\D/g, '')}@c.us`;

    try {
        console.log(`Mencoba mengirim pesan ke: ${final_number}`);
        
        await client.sendMessage(final_number, message);

        console.log(`Pesan berhasil dikirim ke ${final_number}`);
        res.status(200).json({ success: true, message: `Pesan berhasil dikirim ke ${recipient}` });

    } catch (error) {
        let errorMessage = 'Gagal mengirim pesan WhatsApp. Lihat log server untuk detail.';
        if (error.message && error.message.includes('cannot be null')) {
            errorMessage = `Nomor ${recipient} tidak terdaftar di WhatsApp.`;
        } else if (error.message) {
            errorMessage = error.message;
        }

        console.error(`Gagal mengirim pesan ke ${final_number}:`, errorMessage);
        res.status(500).json({ success: false, error: errorMessage });
    }
});

app.listen(port, () => {
    console.log(`Server notifikasi lokal berjalan di http://localhost:${port}`);
});

    