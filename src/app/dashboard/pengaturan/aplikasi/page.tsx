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

export default function AppSettingsPage() {
    const [appName, setAppName] = useState("")
    const [logoUrl, setLogoUrl] = useState<string | null>(null)
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
                    const data = docSnap.data()
                    setAppName(data.appName || "AbTrack")
                    setLogoUrl(data.logoUrl || null)
                } else {
                    setAppName("AbTrack")
                }
            } catch (error) {
                console.error("Error fetching settings:", error)
                toast({
                    variant: "destructive",
                    title: "Gagal memuat pengaturan",
                    description: "Terjadi kesalahan saat mengambil data dari server.",
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
                setLogoUrl(reader.result as string)
            }
            reader.readAsDataURL(file)
        }
    }

    const handleSave = async () => {
        setIsSaving(true)
        try {
            const docRef = doc(db, "settings", "appConfig")
            await setDoc(docRef, { appName, logoUrl }, { merge: true })
            toast({
                title: "Pengaturan Disimpan",
                description: "Informasi aplikasi telah berhasil diperbarui.",
            })
        } catch (error) {
            console.error("Error saving settings:", error)
            toast({
                variant: "destructive",
                title: "Gagal menyimpan",
                description: "Terjadi kesalahan saat menyimpan pengaturan.",
            })
        } finally {
            setIsSaving(false)
        }
    }

  return (
    <div className="flex flex-col gap-6">
       <div className="flex items-center justify-between">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Pengaturan Aplikasi</h1>
                <p className="text-muted-foreground">Sesuaikan identitas dan tampilan aplikasi.</p>
            </div>
        </div>
      <Card>
        <CardHeader>
          <CardTitle>Informasi Aplikasi</CardTitle>
          <CardDescription>
            Pengaturan ini akan mengubah bagaimana aplikasi ditampilkan kepada pengguna, termasuk di halaman login.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
            {isLoading ? (
                <div className="space-y-6">
                    <div className="space-y-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-10 w-full" />
                    </div>
                    <div className="space-y-2">
                         <Skeleton className="h-4 w-24" />
                         <Skeleton className="h-32 w-full" />
                    </div>
                </div>
            ) : (
                <>
                    <div className="space-y-2">
                        <Label htmlFor="app-name">Nama Aplikasi</Label>
                        <Input id="app-name" value={appName} onChange={(e) => setAppName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="app-logo">Logo Aplikasi</Label>
                        <div className="flex items-center justify-center w-full">
                            <label htmlFor="dropzone-file" className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-card hover:bg-muted relative">
                                {logoUrl ? (
                                    <Image src={logoUrl} alt="Logo Preview" layout="fill" objectFit="contain" className="rounded-lg p-2" />
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
            Ubah skema warna aplikasi. Anda dapat menggunakan HSL color picker online untuk mendapatkan nilai warna.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
            <div className="space-y-2">
                <Label htmlFor="primary-color">Warna Primer (HSL)</Label>
                <Input id="primary-color" defaultValue="222.2 47.4% 11.2%" placeholder="Contoh: 222.2 47.4% 11.2%" />
                <p className="text-xs text-muted-foreground">
                    Ini akan mengubah warna utama komponen seperti tombol.
                </p>
            </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving || isLoading}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Simpan Pengaturan
          </Button>
      </div>
    </div>
  )
}
