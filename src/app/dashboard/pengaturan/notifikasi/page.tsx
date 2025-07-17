"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { doc, getDoc, setDoc } from "firebase/firestore"
import { Loader2, Info } from "lucide-react"

import { db } from "@/lib/firebase"
import { useToast } from "@/hooks/use-toast"
import { getWhatsappClient } from "@/services/whatsapp-service";
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

const whatsappSettingsSchema = z.object({
  groupChatId: z.string().optional().describe("Untuk notifikasi rekap ke grup wali kelas"),
  notifHadir: z.boolean().default(true),
  notifTerlambat: z.boolean().default(true),
  notifAbsen: z.boolean().default(true),
});

type WhatsappSettings = z.infer<typeof whatsappSettingsSchema>;

export default function NotifikasiPage() {
    const [isLoading, setIsLoading] = useState(true);
    const [isInitializing, setIsInitializing] = useState(false);
    const { toast } = useToast();

    const form = useForm<WhatsappSettings>({
        resolver: zodResolver(whatsappSettingsSchema),
        defaultValues: {
            groupChatId: "",
            notifHadir: true,
            notifTerlambat: true,
            notifAbsen: true,
        },
    });

    useEffect(() => {
        async function fetchSettings() {
            setIsLoading(true);
            try {
                // We reuse the same document for simplicity
                const docRef = doc(db, "settings", "telegramConfig");
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    form.reset(docSnap.data() as WhatsappSettings);
                }
            } catch (error) {
                console.error("Error fetching whatsapp settings:", error);
                toast({
                    variant: "destructive",
                    title: "Gagal Memuat Pengaturan",
                    description: "Gagal mengambil data dari server.",
                });
            } finally {
                setIsLoading(false);
            }
        }
        fetchSettings();
    }, [form, toast]);

    async function onSubmit(values: WhatsappSettings) {
        try {
            await setDoc(doc(db, "settings", "telegramConfig"), values, { merge: true });
            toast({
                title: "Pengaturan Disimpan",
                description: "Pengaturan notifikasi WhatsApp telah berhasil diperbarui.",
            });
        } catch (error) {
            console.error("Error saving settings:", error);
            toast({
                variant: "destructive",
                title: "Gagal Menyimpan",
                description: "Terjadi kesalahan saat menyimpan pengaturan.",
            });
        }
    }

    async function handleInitializeClient() {
        setIsInitializing(true);
        toast({
            title: "Memulai Koneksi WhatsApp...",
            description: "Silakan periksa terminal/konsol untuk melihat QR Code jika diperlukan.",
        });
        
        try {
            await getWhatsappClient();
             toast({
                title: "Koneksi WhatsApp Siap",
                description: "Klien berhasil terhubung. Anda bisa mulai mengirim notifikasi.",
            });
        } catch (error: any) {
             toast({
                variant: "destructive",
                title: "Koneksi Gagal",
                description: `Gagal terhubung ke WhatsApp: ${error.message}`,
            });
        } finally {
            setIsInitializing(false);
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Pengaturan Notifikasi</h1>
                    <p className="text-muted-foreground">Konfigurasi notifikasi WhatsApp.</p>
                </div>
                 <Button
                    onClick={handleInitializeClient}
                    disabled={isInitializing}
                >
                    {isInitializing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isInitializing ? "Menghubungkan..." : "Hubungkan ke WhatsApp"}
                </Button>
            </div>
             <Alert variant="destructive">
                <Info className="h-4 w-4" />
                <AlertTitle>Peringatan Penting</AlertTitle>
                <AlertDescription>
                  Metode ini menggunakan otomatisasi yang melanggar aturan WhatsApp dan dapat menyebabkan nomor Anda diblokir permanen. Gunakan nomor sekali pakai. Untuk memulai, klik "Hubungkan ke WhatsApp" dan pindai QR Code yang muncul di terminal tempat Anda menjalankan `npm run dev`.
                </AlertDescription>
            </Alert>
            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)}>
                    <Card>
                        <CardHeader>
                            <CardTitle>Integrasi WhatsApp</CardTitle>
                            <CardDescription>
                                Atur jenis notifikasi yang akan dikirim via WhatsApp ke orang tua dan wali kelas.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-8">
                            {isLoading ? (
                                <div className="space-y-6">
                                    <Skeleton className="h-10 w-full" />
                                    <Skeleton className="h-6 w-3/4" />
                                    <Skeleton className="h-6 w-3/4" />
                                </div>
                            ) : (
                                <>
                                    <FormField
                                        control={form.control}
                                        name="groupChatId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Group Chat ID (untuk Wali Kelas)</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="(Opsional) Masukkan ID Grup WhatsApp" {...field} />
                                                </FormControl>
                                                <FormDescription>
                                                    ID ini digunakan untuk mengirim rekapitulasi bulanan per kelas ke grup wali kelas. Format: `[nomor]@g.us`.
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <div className="space-y-4">
                                        <h3 className="text-sm font-medium">Jenis Notifikasi ke Orang Tua</h3>
                                        <FormField
                                            control={form.control}
                                            name="notifHadir"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                                                    <div className="space-y-0.5">
                                                        <FormLabel>Notifikasi Hadir & Pulang</FormLabel>
                                                        <FormDescription>
                                                            Kirim notifikasi saat siswa berhasil absen masuk dan pulang.
                                                        </FormDescription>
                                                    </div>
                                                    <FormControl>
                                                        <Switch
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                        />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="notifTerlambat"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                                                    <div className="space-y-0.5">
                                                        <FormLabel>Notifikasi Terlambat</FormLabel>
                                                        <FormDescription>
                                                            Kirim notifikasi jika siswa tercatat terlambat.
                                                        </FormDescription>
                                                    </div>
                                                    <FormControl>
                                                        <Switch
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                        />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="notifAbsen"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                                                    <div className="space-y-0.5">
                                                        <FormLabel>Notifikasi Sakit, Izin, Alfa, Dispen</FormLabel>
                                                        <FormDescription>
                                                            Kirim notifikasi jika status siswa diubah secara manual.
                                                        </FormDescription>
                                                    </div>
                                                    <FormControl>
                                                        <Switch
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                        />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>
                    <div className="mt-6 flex flex-wrap justify-end gap-2">
                        <Button type="submit" disabled={form.formState.isSubmitting || isLoading}>
                          {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Simpan Pengaturan
                        </Button>
                    </div>
                </form>
            </Form>
        </div>
    )
}
