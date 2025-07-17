"use client"

import { useState } from "react"
import { Loader2, Info, Bot, TestTube, ChevronsRight } from "lucide-react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import Link from "next/link"

import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { doc, getDoc } from "firebase/firestore"
import { db } from "@/lib/firebase"

const testSchema = z.object({
  recipient: z.string().refine(val => /^\d{10,15}$/.test(val), {
    message: "Nomor WhatsApp harus berupa angka 10-15 digit (contoh: 6281234567890)."
  }),
  message: z.string().min(1, "Pesan tidak boleh kosong."),
});

type TestFormValues = z.infer<typeof testSchema>;

function TestNotificationForm() {
  const [isTesting, setIsTesting] = useState(false);
  const { toast } = useToast();
  const form = useForm<TestFormValues>({
    resolver: zodResolver(testSchema),
    defaultValues: {
      recipient: "",
      message: "Ini adalah pesan tes dari aplikasi E-Absensi Anda. Konfigurasi berhasil!",
    }
  });

  async function onTestSubmit(values: TestFormValues) {
    setIsTesting(true);
    let webhookUrl = "";
    try {
        const docRef = doc(db, "settings", "appConfig");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && docSnap.data().notificationWebhookUrl) {
            webhookUrl = docSnap.data().notificationWebhookUrl;
        } else {
             toast({
                variant: "destructive",
                title: "URL Webhook Belum Diatur",
                description: "Harap simpan URL webhook di tab Pengaturan Aplikasi terlebih dahulu.",
            });
            setIsTesting(false);
            return;
        }

      // Kita akan mengirim payload ini ke server lokal kita
      const payload = {
        recipient: values.recipient, // server.js akan menambahkan @c.us
        message: values.message,
      };
      
      const response = await fetch(`${webhookUrl}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        toast({ title: "Sukses", description: "Perintah kirim pesan berhasil dikirim ke server lokal Anda." });
      } else {
        const errorText = await response.text();
        toast({ variant: "destructive", title: "Gagal Mengirim", description: `Server lokal merespons dengan kesalahan: ${errorText}` });
      }

    } catch (error) {
      console.error("Error testing webhook:", error);
      toast({ variant: "destructive", title: "Gagal Terhubung", description: "Tidak dapat terhubung ke URL webhook. Pastikan server lokal dan Ngrok berjalan dengan benar." });
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><TestTube />Uji Coba Notifikasi</CardTitle>
        <CardDescription>
          Kirim pesan tes ke nomor WhatsApp mana pun untuk memastikan server lokal dan webhook Anda berfungsi dengan benar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onTestSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="recipient"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nomor WhatsApp Tujuan</FormLabel>
                  <FormControl>
                    <Input placeholder="cth: 6281234567890" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Isi Pesan</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={isTesting}>
                {isTesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Kirim Pesan Tes
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

export default function NotifikasiPage() {
    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Pengaturan Notifikasi</h1>
                    <p className="text-muted-foreground">Konfigurasi dan uji coba webhook untuk notifikasi WhatsApp.</p>
                </div>
            </div>
            
            <Alert variant="default">
                <Bot className="h-4 w-4" />
                <AlertTitle>Penting: Metode Notifikasi Eksternal</AlertTitle>
                <AlertDescription>
                 Sistem ini sekarang menggunakan "Webhook" untuk mengirim notifikasi. Anda perlu menjalankan server notifikasi WhatsApp di komputer lokal Anda menggunakan file `start_server.bat` dan `start_ngrok.bat`.
                 <Button asChild variant="link" className="px-1 h-auto py-0">
                    <Link href="/dashboard/pengaturan/aplikasi">
                        Buka Pengaturan Aplikasi untuk mengatur URL Webhook <ChevronsRight className="h-4 w-4" />
                    </Link>
                 </Button>
                </AlertDescription>
            </Alert>
            
            <TestNotificationForm />
        </div>
    )
}
