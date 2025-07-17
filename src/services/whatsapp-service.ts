// IMPORTANT: This file uses a library that automates a user WhatsApp account.
// This is against WhatsApp's Terms of Service and can lead to your number being permanently banned.
// Use a dedicated, disposable number for this service. Do NOT use your personal or official school number.

'use server';

import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import {-next-line:no-console} from 'node:console';

// --- Singleton Pattern for WhatsApp Client ---
// This ensures we only have one instance of the client running.
let clientInstance: Client | null = null;
let isInitializing = false;
let isReady = false;

// Helper function for random delay
const randomDelay = (min: number, max: number) => {
    return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

export const getWhatsappClient = (): Promise<Client> => {
    return new Promise((resolve, reject) => {
        if (clientInstance && isReady) {
            console.log("WhatsApp client already initialized and ready.");
            return resolve(clientInstance);
        }

        if (isInitializing) {
            // If initialization is already in progress, wait for it to complete.
            const interval = setInterval(() => {
                if (isReady) {
                    clearInterval(interval);
                    if (clientInstance) {
                        resolve(clientInstance);
                    } else {
                        reject(new Error("Initialization finished, but client is null."));
                    }
                }
                 if (!isInitializing) {
                    clearInterval(interval);
                    reject(new Error("Initialization was aborted."));
                }
            }, 1000);
            return;
        }

        console.log("Initializing WhatsApp client...");
        isInitializing = true;
        
        const client = new Client({
            authStrategy: new LocalAuth({
                // This will create a .wwebjs_auth folder to store session data.
                // You should add this folder to your .gitignore file.
                clientId: 'school-attendance-bot'
            }),
            puppeteer: {
                // These args are often necessary for running in server environments
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
            console.log("Scan the QR code below with your phone to log in.");
            qrcode.generate(qr, { small: true });
            console.log("-----------------------------");
        });

        client.on('ready', () => {
            console.log('✅ WhatsApp client is ready!');
            clientInstance = client;
            isInitializing = false;
            isReady = true;
            resolve(client);
        });
        
        client.on('authenticated', () => {
            console.log('WhatsApp client authenticated successfully.');
        });

        client.on('auth_failure', (msg) => {
            console.error('--- WHATSAPP AUTHENTICATION FAILURE ---');
            console.error(msg);
            console.error('Please delete the .wwebjs_auth folder and restart the server to generate a new QR code.');
            isInitializing = false;
            isReady = false;
            clientInstance = null;
            reject(new Error(msg));
        });
        
        client.on('disconnected', (reason) => {
            console.warn('WhatsApp client was disconnected.', reason);
            isReady = false;
            clientInstance = null;
            isInitializing = false; // Allow re-initialization
        });

        client.initialize().catch(err => {
            console.error('Failed to initialize WhatsApp client:', err);
            isInitializing = false;
            reject(err);
        });
    });
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
