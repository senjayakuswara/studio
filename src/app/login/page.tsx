"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import { doc, getDoc } from "firebase/firestore"
import Image from "next/image"
import { School } from "lucide-react"

import { db } from "@/lib/firebase"
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
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function fetchSettings() {
      setIsLoading(true)
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
        toast({
            variant: "destructive",
            title: "Gagal memuat data aplikasi",
            description: "Gagal terhubung ke server. Periksa koneksi internet Anda atau pastikan izin akses database sudah benar.",
        })
      } finally {
        setIsLoading(false);
      }
    }
    fetchSettings();
  }, [toast]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  })

  function onSubmit(values: z.infer<typeof formSchema>) {
    if (values.email === "admin@absen.com" && values.password === "admin123456") {
      toast({
        title: "Login Berhasil",
        description: "Selamat datang kembali, Admin!",
      })
      router.push("/dashboard")
    } else {
      toast({
        variant: "destructive",
        title: "Login Gagal",
        description: "Email atau password salah. Silakan coba lagi.",
      })
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
            {isLoading ? (
                <>
                    <Skeleton className="mx-auto h-16 w-16 rounded-full" />
                    <Skeleton className="mx-auto mt-4 h-8 w-32" />
                    <Skeleton className="mx-auto mt-2 h-4 w-48" />
                </>
            ) : (
                <>
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    {logoUrl ? (
                        <Image src={logoUrl} alt="Logo" width={40} height={40} className="rounded-full" />
                    ) : (
                        <School className="h-8 w-8" />
                    )}
                    </div>
                    <CardTitle className="font-headline text-3xl">{appName}</CardTitle>
                    <CardDescription className="font-body">
                        Selamat datang! Silakan masuk ke akun Anda.
                    </CardDescription>
                </>
            )}
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
                        placeholder="admin@absen.com"
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
                        placeholder="********"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full font-headline">
                Masuk
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
      <p className="mt-4 text-xs text-muted-foreground">
          Email: admin@absen.com | Password: admin123456
      </p>
    </div>
  )
}
