"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { doc, getDoc, setDoc } from "firebase/firestore"
import { Loader2, Info } from "lucide-react"

import { db } from "@/lib/firebase"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

const telegramSettingsSchema = z.object({
  botToken: z.string().describe("Bot Father Token"),
  chatId: z.string().describe("Your personal chat id"),
  groupChatId: z.string().optional().describe("For recap notifications to the advisors' group"),
  notifHadir: z.boolean().default(true),
  notifTerlambat: z.boolean().default(true),
  notifAbsen: z.boolean().default(true),
});

type TelegramSettings = z.infer<typeof telegramSettingsSchema>;

export default function NotifikasiPage() {
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();

    const form = useForm<TelegramSettings>({
        resolver: zodResolver(telegramSettingsSchema),
        defaultValues: {
            botToken: "",
            chatId: "",
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

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Pengaturan Notifikasi</h1>
                    <p className="text-muted-foreground">Konfigurasi notifikasi via Telegram.</p>
                </div>
            </div>
             <Alert variant="default">
                <Info className="h-4 w-4" />
                <AlertTitle>Informasi</AlertTitle>
                <AlertDescription>
                 Sistem ini menggunakan Telegram untuk mengirim notifikasi. Telegram API gratis, andal, dan tidak akan menyebabkan nomor Anda diblokir. Harap isi Token Bot dan ID Chat Anda untuk mengaktifkan notifikasi.
                </AlertDescription>
            </Alert>
            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)}>
                    <Card>
                        <CardHeader>
                            <CardTitle>Integrasi Telegram</CardTitle>
                            <CardDescription>
                                Atur jenis notifikasi yang akan dikirim via Telegram ke orang tua dan wali kelas.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-8">
                            {isLoading ? (
                                <div className="space-y-6">
                                    <Skeleton className="h-10 w-full" />
                                    <Skeleton className="h-10 w-full" />
                                    <Skeleton className="h-6 w-3/4" />
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <FormField
                                            control={form.control}
                                            name="botToken"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Bot Token</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="Masukkan token dari BotFather" {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="chatId"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Admin Chat ID</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="Masukkan ID chat personal Anda" {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                    <FormField
                                        control={form.control}
                                        name="groupChatId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Group Chat ID (untuk Wali Kelas)</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="(Opsional) Masukkan ID Grup Telegram" {...field} />
                                                </FormControl>
                                                <FormDescription>
                                                    ID ini digunakan untuk mengirim rekapitulasi bulanan per kelas ke grup wali kelas.
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <div className="space-y-4">
                                        <h3 className="text-sm font-medium">Jenis Notifikasi ke Orang Tua (via Admin Chat ID)</h3>
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
