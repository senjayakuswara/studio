"use client"

import { Bot, ChevronsRight } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function NotifikasiPage() {
    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Pengaturan Notifikasi</h1>
                    <p className="text-muted-foreground">Informasi mengenai cara kerja notifikasi WhatsApp.</p>
                </div>
            </div>
            
             <Alert variant="default">
                <Bot className="h-4 w-4" />
                <AlertTitle>Penting: Metode Notifikasi Eksternal</AlertTitle>
                <AlertDescription>
                 Sistem ini sekarang menggunakan "Webhook" untuk mengirim notifikasi. Anda perlu menjalankan server notifikasi WhatsApp di komputer lokal Anda menggunakan file `start_server.bat` dan `start_ngrok.bat`.
                 <Button asChild variant="link" className="px-1 h-auto py-0 text-left">
                    <Link href="/dashboard/pengaturan/aplikasi">
                        Buka Pengaturan Aplikasi untuk mengatur URL Webhook dan melakukan uji coba. <ChevronsRight className="h-4 w-4" />
                    </Link>
                 </Button>
                </AlertDescription>
            </Alert>
            
            <Card>
                <CardHeader>
                    <CardTitle>Alur Kerja Harian</CardTitle>
                    <CardDescription>Langkah-langkah yang perlu Anda lakukan setiap hari untuk mengaktifkan notifikasi.</CardDescription>
                </CardHeader>
                <CardContent>
                    <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                        <li>Jalankan file `start_server.bat` di komputer lokal Anda. Jika ini pertama kali, pindai QR Code yang muncul dengan WhatsApp Anda.</li>
                        <li>Jalankan file `start_ngrok.bat`. Ini akan membuat jendela baru dan memberikan Anda alamat URL yang unik untuk hari itu.</li>
                        <li>Salin alamat URL `https://...ngrok-free.app`.</li>
                        <li>Buka halaman <Link href="/dashboard/pengaturan/aplikasi" className="font-medium text-primary hover:underline">Pengaturan Aplikasi</Link>.</li>
                        <li>Tempel URL baru ke dalam kolom "URL Webhook Notifikasi" dan simpan.</li>
                        <li>Lakukan uji coba pengiriman pesan di halaman yang sama untuk memastikan semuanya berfungsi.</li>
                    </ol>
                </CardContent>
            </Card>
        </div>
    )
}
