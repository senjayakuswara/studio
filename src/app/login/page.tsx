
"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import { doc, getDoc } from "firebase/firestore"
import Image from "next/image"
import { School, Loader2, AlertTriangle } from "lucide-react"

import { db } from "@/lib/firebase"
import { signInWithEmail } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { Skeleton } from "@/components/ui/skeleton"

const requiredEnvVars = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID'
];

const formSchema = z.object({
  email: z.string().email({
    message: "Format email tidak valid.",
  }),
  password: z.string().min(8, {
    message: "Password minimal 8 karakter.",
  }),
})

export default function LoginPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [appName, setAppName] = useState("AbTrack")
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [isSettingsLoading, setIsSettingsLoading] = useState(true)
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const missingVars = isClient ? requiredEnvVars.filter(varName => !process.env[varName]) : [];
  const hasConfigError = isClient && missingVars.length > 0;

  useEffect(() => {
    if (hasConfigError || !isClient) {
      setIsSettingsLoading(false);
      return;
    }
    
    async function fetchSettings() {
      setIsSettingsLoading(true)
      try {
        const docRef = doc(db, "settings", "appConfig");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setAppName(data.appName || "AbTrack");
          setLogoUrl(data.logoUrl || null);
          document.title = data.appName || "AbTrack";
        }
      } catch (error) {
        console.error("Error fetching settings:", error);
        if (error instanceof Error && error.message.includes("Failed to get document because the client is offline")) {
             toast({
                variant: "destructive",
                title: "Gagal Terhubung ke Firebase",
                description: "Pastikan konfigurasi Firebase Anda benar dan Anda terhubung ke internet.",
            })
        } else {
            toast({
                variant: "destructive",
                title: "Gagal memuat data aplikasi",
                description: "Gagal terhubung ke server. Periksa koneksi internet Anda.",
            })
        }
      } finally {
        setIsSettingsLoading(false);
      }
    }
    fetchSettings();
  }, [toast, hasConfigError, isClient]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  })

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoggingIn(true);
    try {
      await signInWithEmail(values.email, values.password);
      toast({
        title: "Login Berhasil",
        description: "Selamat datang kembali!",
      })
      router.push("/dashboard")
    } catch (error) {
      console.error("Login failed:", error);
      toast({
        variant: "destructive",
        title: "Login Gagal",
        description: "Email atau password salah. Silakan coba lagi.",
      })
    } finally {
      setIsLoggingIn(false);
    }
  }

  const renderMainContent = () => {
    if (!isClient || isSettingsLoading) {
      return (
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle className="font-headline text-2xl">Masuk</CardTitle>
            <CardDescription className="font-body">
                Selamat datang! Silakan masuk ke akun Anda.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-10 w-full" />
            </div>
            <div className="space-y-2">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-10 w-full" />
            </div>
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      );
    }

    if (hasConfigError) {
      return (
        <Card className="w-full max-w-2xl bg-destructive/10 border-destructive">
            <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle />
                Kesalahan Konfigurasi
            </CardTitle>
            <CardDescription className="text-destructive/80">
                Aplikasi tidak dapat terhubung ke Firebase karena beberapa kunci konfigurasi hilang.
            </CardDescription>
            </CardHeader>
            <CardContent>
            <p className="font-medium">Harap periksa pengaturan Environment Variables di Vercel Anda dan pastikan variabel berikut ini sudah diisi dengan benar:</p>
            <ul className="mt-2 list-disc list-inside space-y-1 font-mono text-sm">
                {missingVars.map(varName => <li key={varName}>{varName}</li>)}
            </ul>
            <p className="mt-4 text-xs text-muted-foreground text-destructive/80">
                Setelah Anda mengisi semua variabel di Vercel, lakukan Redeploy.
            </p>
            </CardContent>
        </Card>
      );
    }

    return (
        <Card className="w-full max-w-sm">
            <CardHeader className="text-center">
                <CardTitle className="font-headline text-2xl">Masuk</CardTitle>
                <CardDescription className="font-body">
                    Selamat datang! Silakan masuk ke akun Anda.
                </CardDescription>
            </CardHeader>
            <CardContent>
            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                    <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                        <Input
                            placeholder="Masukan email anda"
                            {...field}
                        />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                    <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                        <Input
                            type="password"
                            placeholder="Masukan password anda"
                            {...field}
                        />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                    )}
                />
                <Button type="submit" className="w-full font-headline" disabled={isLoggingIn}>
                    {isLoggingIn && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Masuk
                </Button>
                </form>
            </Form>
            </CardContent>
        </Card>
    );
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-4 bg-primary p-4 text-primary-foreground shadow-md">
        {isSettingsLoading ? (
            <>
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-6 w-32" />
            </>
        ) : (
            <>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background text-primary">
                    {logoUrl ? (
                        <Image src={logoUrl} alt="Logo" width={32} height={32} className="rounded-full" />
                    ) : (
                        <School className="h-6 w-6" />
                    )}
                </div>
                <h1 className="font-headline text-xl font-semibold">{appName}</h1>
            </>
        )}
      </header>
      <main className="flex flex-1 flex-col items-center justify-center bg-background p-4">
        {renderMainContent()}
      </main>
      <footer className="bg-muted p-4 text-center text-sm text-muted-foreground">
        <p>2025 @ E-Absensi created by KS</p>
      </footer>
    </div>
  )
}
