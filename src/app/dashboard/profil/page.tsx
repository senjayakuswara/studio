
"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useState, useEffect } from "react"
import { useToast } from "@/hooks/use-toast"
import { onAuthChange, updateUserProfile, changeUserPassword } from "@/lib/auth"
import { Loader2 } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import type { User } from "firebase/auth"


const profileSchema = z.object({
  nama: z.string().min(1, "Nama tidak boleh kosong."),
  email: z.string().email(),
})

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Password lama diperlukan."),
  newPassword: z.string().min(8, "Password baru minimal 8 karakter."),
  confirmPassword: z.string()
}).refine(data => data.newPassword === data.confirmPassword, {
  message: "Password baru dan konfirmasi tidak cocok.",
  path: ["confirmPassword"],
});


export default function ProfilPage() {
  const { toast } = useToast()
  const [user, setUser] = useState<User | null>(null)
  const [isProfileSaving, setIsProfileSaving] = useState(false)
  const [isPasswordSaving, setIsPasswordSaving] = useState(false)

  const profileForm = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      nama: "",
      email: ""
    },
  })

  const passwordForm = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: ""
    },
  })
  
  useEffect(() => {
    const unsubscribe = onAuthChange((currentUser) => {
      setUser(currentUser)
      if (currentUser) {
        profileForm.reset({
          nama: currentUser.displayName || "Admin",
          email: currentUser.email || ""
        })
      }
    });
    return () => unsubscribe();
  }, [profileForm])


  async function onProfileSubmit(values: z.infer<typeof profileSchema>) {
    setIsProfileSaving(true)
    try {
      await updateUserProfile(values.nama)
      toast({ title: "Profil Diperbarui", description: "Nama Anda telah berhasil diubah." })
    } catch (error: any) {
      console.error("Error updating profile:", error)
      toast({ variant: "destructive", title: "Gagal Memperbarui Profil", description: error.message })
    } finally {
      setIsProfileSaving(false)
    }
  }

  async function onPasswordSubmit(values: z.infer<typeof passwordSchema>) {
    setIsPasswordSaving(true)
    try {
      await changeUserPassword(values.currentPassword, values.newPassword)
      toast({ title: "Password Diperbarui", description: "Password Anda telah berhasil diubah." })
      passwordForm.reset()
    } catch (error: any) {
      console.error("Error changing password:", error)
      toast({ variant: "destructive", title: "Gagal Mengubah Password", description: "Password lama salah atau terjadi kesalahan lain." })
    } finally {
      setIsPasswordSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold tracking-tight">Profil Saya</h1>
          <p className="text-muted-foreground">Kelola informasi profil dan keamanan akun Anda.</p>
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <Form {...profileForm}>
            <form onSubmit={profileForm.handleSubmit(onProfileSubmit)}>
              <CardHeader>
                <CardTitle>Informasi Admin</CardTitle>
                <CardDescription>
                  Detail personal Anda. Email tidak dapat diubah.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={profileForm.control}
                  name="nama"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nama</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={profileForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} disabled />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
              <CardFooter className="justify-end">
                <Button type="submit" disabled={isProfileSaving}>
                  {isProfileSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Simpan Info Profil
                </Button>
              </CardFooter>
            </form>
          </Form>
        </Card>
        <Card>
          <Form {...passwordForm}>
            <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}>
              <CardHeader>
                <CardTitle>Ubah Password</CardTitle>
                <CardDescription>
                  Pastikan untuk menggunakan password yang kuat.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                 <FormField
                  control={passwordForm.control}
                  name="currentPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password Lama</FormLabel>
                      <FormControl>
                        <Input type="password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <FormField
                  control={passwordForm.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password Baru</FormLabel>
                      <FormControl>
                        <Input type="password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <FormField
                  control={passwordForm.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Konfirmasi Password Baru</FormLabel>
                      <FormControl>
                        <Input type="password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
              <CardFooter className="justify-end">
                <Button type="submit" disabled={isPasswordSaving}>
                  {isPasswordSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Ubah Password
                </Button>
              </CardFooter>
            </form>
          </Form>
        </Card>
      </div>
    </div>
  )
}
