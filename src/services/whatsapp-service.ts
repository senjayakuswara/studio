// IMPORTANT: This file uses a library that automates a user WhatsApp account.
// This is against WhatsApp's Terms of Service and can lead to your number being permanently banned.
// Use a dedicated, disposable number for this service. Do NOT use your personal or official school number.

'use server';

import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

// --- Singleton Pattern for WhatsApp Client ---
// This ensures we only have one instance of the client running.
let clientInstance: Client | null = null;
let clientPromise: Promise<Client> | null = null;

// Helper function for random delay
const randomDelay = (min: number, max: number) => {
    return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

async function initializeClient(): Promise<Client> {
    console.log("Initializing WhatsApp client...");
    
    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: 'school-attendance-bot'
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
        console.log("--- SCAN WHATSAPP QR CODE ---");
        qrcode.generate(qr, { small: true });
        console.log("-----------------------------");
    });

    client.on('ready', () => {
        console.log('✅ WhatsApp client is ready!');
        clientInstance = client;
    });
    
    client.on('authenticated', () => {
        console.log('WhatsApp client authenticated successfully.');
    });

    client.on('auth_failure', (msg) => {
        console.error('--- WHATSAPP AUTHENTICATION FAILURE ---', msg);
        clientInstance = null;
        clientPromise = null; // Reset promise on failure
    });
    
    client.on('disconnected', (reason) => {
        console.warn('WhatsApp client was disconnected.', reason);
        clientInstance = null;
        clientPromise = null; // Reset promise on disconnect
    });

    await client.initialize();
    return client;
}

export async function getWhatsappClient(): Promise<Client> {
    if (clientInstance) {
        console.log("WhatsApp client already initialized and ready.");
        return clientInstance;
    }
    
    if (!clientPromise) {
        clientPromise = initializeClient();
    }

    return clientPromise;
};

/**
 * Sends a message to a specific WhatsApp number with a random delay.
 * @param number The phone number in international format (e.g., '6281234567890').
 * @param message The text message to send.
 */
export async function sendWhatsappMessage(number: string, message: string): Promise<{success: boolean; message: string}> {
    if (!number) {
        return { success: false, message: 'Phone number is empty, cannot send message.'};
    }

    try {
        const client = await getWhatsappClient();
        
        // ** ADDED RANDOM DELAY **
        // Wait for a random time between 1 to 5 seconds before sending
        await randomDelay(1000, 5000); 

        // WhatsApp IDs are in the format `[number]@c.us` or `[number]@g.us` for groups
        const chatId = number.includes('@g.us') ? number : `${number}@c.us`;
        await client.sendMessage(chatId, message);
        console.log(`Message sent successfully to ${number}`);
        return { success: true, message: `Message sent to ${number}` };
    } catch (error: any) {
        console.error(`Failed to send message to ${number}:`, error);
        return { success: false, message: error.message };
    }
}
