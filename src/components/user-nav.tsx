
"use client"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useRouter } from "next/navigation"
import { User, Settings, LogOut } from "lucide-react"
import { signOut } from "@/lib/auth"
import { useToast } from "@/hooks/use-toast"


export function UserNav() {
  const router = useRouter()
  const { toast } = useToast()

  const handleSignOut = async () => {
    try {
        await signOut();
        toast({ title: "Anda telah keluar." })
        router.push('/login');
    } catch (error) {
        toast({ variant: "destructive", title: "Gagal Keluar", description: "Terjadi kesalahan saat mencoba keluar." })
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
          <Avatar className="h-8 w-8">
            <AvatarFallback>
              <User />
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">Admin</p>
            <p className="text-xs leading-none text-muted-foreground">
              admin@absen.com
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => router.push('/dashboard/profil')}>
            <User />
            Profil
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push('/dashboard/pengaturan/aplikasi')}>
            <Settings />
            Pengaturan
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut />
          Keluar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
