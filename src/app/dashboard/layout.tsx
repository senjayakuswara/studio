"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ClipboardCheck,
  Clock,
  LayoutDashboard,
  Printer,
  School,
  Send,
  Users,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { UserNav } from "@/components/user-nav"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isActive = (path: string) => pathname === path

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center gap-2 p-2">
             <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <School className="h-5 w-5" />
             </div>
            <span className="font-headline text-lg font-semibold">AbTrack</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <Link href="/dashboard" legacyBehavior passHref>
                <SidebarMenuButton
                  tooltip="Dashboard"
                  isActive={isActive("/dashboard")}
                >
                  <LayoutDashboard />
                  <span>Dashboard</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <Link href="/dashboard/siswa" legacyBehavior passHref>
                <SidebarMenuButton
                  tooltip="Manajemen Siswa"
                  isActive={isActive("/dashboard/siswa")}
                >
                  <Users />
                  <span>Manajemen Siswa</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <Link href="/dashboard/absensi" legacyBehavior passHref>
                <SidebarMenuButton
                  tooltip="Manajemen Absensi"
                  isActive={isActive("/dashboard/absensi")}
                >
                  <ClipboardCheck />
                  <span>Manajemen Absensi</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarGroup>
            <SidebarGroupLabel>Pengaturan Umum</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <Link href="/dashboard/pengaturan/notifikasi" legacyBehavior passHref>
                  <SidebarMenuButton
                    tooltip="Notifikasi Telegram"
                    isActive={isActive("/dashboard/pengaturan/notifikasi")}
                  >
                    <Send />
                    <span>Notifikasi Telegram</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link href="/dashboard/pengaturan/laporan" legacyBehavior passHref>
                  <SidebarMenuButton
                    tooltip="Desain Laporan"
                    isActive={isActive("/dashboard/pengaturan/laporan")}
                  >
                    <Printer />
                    <span>Desain Laporan</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link href="/dashboard/pengaturan/jam" legacyBehavior passHref>
                  <SidebarMenuButton
                    tooltip="Pengaturan Jam"
                    isActive={isActive("/dashboard/pengaturan/jam")}
                  >
                    <Clock />
                    <span>Pengaturan Jam</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b bg-background px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6">
            <SidebarTrigger className="sm:hidden" />
            <div></div>
            <UserNav />
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
