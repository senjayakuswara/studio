"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { doc, getDoc, setDoc } from "firebase/firestore"
import { Loader2, Info, RefreshCw } from "lucide-react"

import { db } from "@/lib/firebase"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { syncTelegramMessages, deleteTelegramWebhook } from "@/ai/flows/telegram-flow"

const telegramSettingsSchema = z.object({
  groupChatId: z.string().optional().describe("Untuk notifikasi rekap ke grup wali kelas"),
  notifHadir: z.boolean().default(true),
  notifTerlambat: z.boolean().default(true),
  notifAbsen: z.boolean().default(true),
});

type TelegramSettings = z.infer<typeof telegramSettingsSchema>;

export default function NotifikasiPage() {
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const { toast } = useToast();

    const form = useForm<TelegramSettings>({
        resolver: zodResolver(telegramSettingsSchema),
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
                const docRef = doc(db, "settings", "telegramConfig");
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    form.reset(docSnap.data() as TelegramSettings);
                }
            } catch (error) {
                console.error("Error fetching telegram settings:", error);
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

    async function onSubmit(values: TelegramSettings) {
        try {
            await setDoc(doc(db, "settings", "telegramConfig"), values, { merge: true });
            toast({
                title: "Pengaturan Disimpan",
                description: "Pengaturan notifikasi Telegram telah berhasil diperbarui.",
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

    async function handleSyncMessages() {
        setIsSyncing(true);
        toast({
            title: "Memeriksa Pesan...",
            description: "Menghubungi server Telegram untuk mengambil pesan baru.",
        });
        const result = await syncTelegramMessages();

        if (result.success) {
            toast({
                title: "Sinkronisasi Selesai",
                description: result.message,
            });
        } else {
            toast({
                variant: "destructive",
                title: "Sinkronisasi Gagal",
                description: result.message,
            });
        }
        setIsSyncing(false);
    }
    
    async function handleResetWebhook() {
        setIsResetting(true);
        const result = await deleteTelegramWebhook();
        if (result.success) {
            toast({
                title: "Koneksi Berhasil Direset",
                description: result.message,
            });
        } else {
            toast({
                variant: "destructive",
                title: "Reset Gagal",
                description: result.message,
            });
        }
        setIsResetting(false);
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Pengaturan Notifikasi</h1>
                    <p className="text-muted-foreground">Konfigurasi notifikasi Telegram.</p>
                </div>
            </div>
             <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Konfigurasi Bot & Pesan Masuk</AlertTitle>
                <AlertDescription>
                  Token Bot Telegram dikelola melalui `TELEGRAM_BOT_TOKEN` di server. Untuk memproses pendaftaran, klik **Periksa Pesan Baru**. Jika terjadi error karena webhook aktif, klik **Reset Koneksi Webhook** terlebih dahulu.
                </AlertDescription>
            </Alert>
            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)}>
                    <Card>
                        <CardHeader>
                            <CardTitle>Integrasi Telegram</CardTitle>
                            <CardDescription>
                                Hubungkan bot Telegram untuk mengirim notifikasi absensi otomatis ke orang tua dan wali kelas.
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
                                                    <Input placeholder="(Opsional) Masukkan Chat ID grup/channel wali kelas" {...field} />
                                                </FormControl>
                                                <FormDescription>
                                                    ID ini digunakan untuk mengirim rekapitulasi bulanan per kelas ke grup wali kelas.
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
                        <Button
                           variant="destructive"
                           type="button"
                           onClick={handleResetWebhook}
                           disabled={isResetting || isLoading || form.formState.isSubmitting}
                        >
                            {isResetting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Reset Koneksi Webhook
                        </Button>
                        <Button
                           variant="outline"
                           type="button"
                           onClick={handleSyncMessages}
                           disabled={isSyncing || isLoading || form.formState.isSubmitting}
                        >
                            {isSyncing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Periksa Pesan Baru
                        </Button>
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
