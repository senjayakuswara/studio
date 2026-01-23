"use client"

import { useState, useEffect, type ChangeEvent } from "react"
import { doc, getDoc, setDoc } from "firebase/firestore"
import Image from "next/image"
import { UploadCloud, Loader2 } from "lucide-react"

import { db } from "@/lib/firebase"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"

// Types & Schemas
type AppSettings = {
    appName: string
    logoUrl: string | null
    theme: ThemeSettings
}

type ThemeSettings = {
    primary: string;
    background: string;
    accent: string;
}

// Color Conversion Utilities
function hslStringToHex(hslString: string): string {
    const [h, s, l] = hslString.split(" ").map(val => parseFloat(val.replace('%', '')));
    const s_norm = s / 100;
    const l_norm = l / 100;
    const c = (1 - Math.abs(2 * l_norm - 1)) * s_norm;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l_norm - c / 2;
    let r = 0, g = 0, b = 0;

    if (h >= 0 && h < 60) { [r, g, b] = [c, x, 0]; }
    else if (h >= 60 && h < 120) { [r, g, b] = [x, c, 0]; }
    else if (h >= 120 && h < 180) { [r, g, b] = [0, c, x]; }
    else if (h >= 180 && h < 240) { [r, g, b] = [0, x, c]; }
    else if (h >= 240 && h < 300) { [r, g, b] = [x, 0, c]; }
    else if (h >= 300 && h < 360) { [r, g, b] = [c, 0, x]; }

    const toHex = (c: number) => {
        const hex = Math.round((c + m) * 255).toString(16);
        return hex.length === 1 ? "0" + hex : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToHslString(hex: string): string {
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) {
        r = parseInt(hex[1] + hex[1], 16);
        g = parseInt(hex[2] + hex[2], 16);
        b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 7) {
        r = parseInt(hex.substring(1, 3), 16);
        g = parseInt(hex.substring(3, 5), 16);
        b = parseInt(hex.substring(5, 7), 16);
    }
    r /= 255; g /= 255; b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    
    h = Math.round(h * 360);
    s = Math.round(s * 100);
    l = Math.round(l * 100);

    return `${h} ${s}% ${l}%`;
}


export default function AppSettingsPage() {
    const [settings, setSettings] = useState<Omit<AppSettings, 'theme'>>({
        appName: "AbTrack",
        logoUrl: null,
    });
    const [theme, setTheme] = useState<ThemeSettings>({
        primary: "#0f172a",
        background: "#fafafa",
        accent: "#ffb6c1",
    })
    const [isSaving, setIsSaving] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const { toast } = useToast()

    useEffect(() => {
        async function fetchSettings() {
            setIsLoading(true)
            try {
                const docRef = doc(db, "settings", "appConfig")
                const docSnap = await getDoc(docRef)
                if (docSnap.exists()) {
                    const data = docSnap.data() as Partial<AppSettings>;
                    setSettings({
                        appName: data.appName || "AbTrack",
                        logoUrl: data.logoUrl || null,
                    });
                    if (data.theme) {
                         setTheme({
                            primary: hslStringToHex(data.theme.primary),
                            background: hslStringToHex(data.theme.background),
                            accent: hslStringToHex(data.theme.accent),
                        });
                    }
                }
            } catch (error) {
                console.error("Error fetching settings:", error)
                toast({
                    variant: "destructive",
                    title: "Gagal memuat pengaturan",
                    description: "Gagal terhubung ke server. Periksa koneksi internet Anda atau pastikan izin akses database sudah benar.",
                })
            } finally {
                setIsLoading(false)
            }
        }
        fetchSettings()
    }, [toast])

    const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) {
            const reader = new FileReader()
            reader.onloadend = () => {
                setSettings(prev => ({ ...prev, logoUrl: reader.result as string }));
            }
            reader.readAsDataURL(file)
        }
    }

    const handleThemeChange = (id: keyof ThemeSettings, value: string) => {
        setTheme(prev => ({ ...prev, [id]: value }))
    }

    const handleSettingsChange = (e: ChangeEvent<HTMLInputElement>) => {
        const { id, value } = e.target;
        setSettings(prev => ({ ...prev, [id]: value }));
    }

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const themeToSave = {
                primary: hexToHslString(theme.primary),
                background: hexToHslString(theme.background),
                accent: hexToHslString(theme.accent),
            };

            const dataToSave: AppSettings = {
                ...settings,
                theme: themeToSave,
            };

            const docRef = doc(db, "settings", "appConfig");
            await setDoc(docRef, dataToSave, { merge: true });

            document.documentElement.style.setProperty('--primary', themeToSave.primary);
            document.documentElement.style.setProperty('--background', themeToSave.background);
            document.documentElement.style.setProperty('--accent', themeToSave.accent);

            toast({
                title: "Pengaturan Disimpan",
                description: "Informasi aplikasi dan tema telah berhasil diperbarui.",
            });
        } catch (error) {
            console.error("Error saving settings:", error);
            toast({
                variant: "destructive",
                title: "Gagal menyimpan",
                description: "Gagal terhubung ke server. Periksa koneksi internet Anda atau pastikan izin akses database sudah benar.",
            });
        } finally {
            setIsSaving(false);
        }
    };

  return (
    <div className="flex flex-col gap-6">
       <div className="flex items-center justify-between">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Pengaturan Aplikasi</h1>
                <p className="text-muted-foreground">Sesuaikan identitas dan tampilan aplikasi.</p>
            </div>
             <Button onClick={handleSave} disabled={isSaving || isLoading}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Simpan Semua Pengaturan
            </Button>
        </div>
      <Card>
        <CardHeader>
          <CardTitle>Identitas & Logo</CardTitle>
          <CardDescription>
            Atur nama dan logo aplikasi Anda.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
            {isLoading ? (
                <div className="space-y-6">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-32 w-full" />
                </div>
            ) : (
                <>
                    <div className="space-y-2">
                        <Label htmlFor="appName">Nama Aplikasi</Label>
                        <Input id="appName" value={settings.appName} onChange={handleSettingsChange} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="app-logo">Logo Aplikasi</Label>
                        <div className="flex items-center justify-center w-full">
                            <label htmlFor="dropzone-file" className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-card hover:bg-muted relative">
                                {settings.logoUrl ? (
                                    <Image src={settings.logoUrl} alt="Logo Preview" layout="fill" objectFit="contain" className="rounded-lg p-2" />
                                ) : (
                                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                        <UploadCloud className="w-8 h-8 mb-4 text-muted-foreground" />
                                        <p className="mb-2 text-sm text-muted-foreground"><span className="font-semibold">Klik untuk unggah</span> atau seret dan lepas</p>
                                        <p className="text-xs text-muted-foreground">SVG, PNG, JPG (REKOM: 200x200px)</p>
                                    </div>
                                )}
                                <Input id="dropzone-file" type="file" className="hidden" onChange={handleFileChange} accept="image/png, image/jpeg, image/svg+xml" />
                            </label>
                        </div>
                    </div>
                </>
            )}
        </CardContent>
      </Card>
      
       <Card>
        <CardHeader>
          <CardTitle>Tema & Tampilan</CardTitle>
          <CardDescription>
            Ubah skema warna aplikasi menggunakan pemilih warna di bawah ini.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {isLoading ? (
                [...Array(3)].map((_, i) => (
                    <div key={i} className="space-y-2">
                        <Skeleton className="h-4 w-20" />
                        <Skeleton className="h-10 w-full" />
                    </div>
                ))
            ) : (
                <>
                <div className="space-y-2">
                    <Label htmlFor="primary">Warna Primer</Label>
                    <div className="flex items-center gap-2 border rounded-md pr-2">
                       <Input type="color" value={theme.primary} onChange={(e) => handleThemeChange('primary', e.target.value)} className="h-auto w-12 p-1 border-0" />
                       <Input id="primary" value={theme.primary} onChange={(e) => handleThemeChange('primary', e.target.value)} className="border-0 focus-visible:ring-0"/>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Warna utama untuk tombol dan elemen penting.
                    </p>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="background">Warna Background</Label>
                    <div className="flex items-center gap-2 border rounded-md pr-2">
                       <Input type="color" value={theme.background} onChange={(e) => handleThemeChange('background', e.target.value)} className="h-auto w-12 p-1 border-0" />
                       <Input id="background" value={theme.background} onChange={(e) => handleThemeChange('background', e.target.value)} className="border-0 focus-visible:ring-0"/>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Warna latar belakang utama aplikasi.
                    </p>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="accent">Warna Aksen</Label>
                    <div className="flex items-center gap-2 border rounded-md pr-2">
                       <Input type="color" value={theme.accent} onChange={(e) => handleThemeChange('accent', e.target.value)} className="h-auto w-12 p-1 border-0" />
                       <Input id="accent" value={theme.accent} onChange={(e) => handleThemeChange('accent', e.target.value)} className="border-0 focus-visible:ring-0"/>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Warna untuk sorotan, seperti saat hover.
                    </p>
                </div>
                </>
            )}
        </CardContent>
      </Card>
    </div>
  )
}
