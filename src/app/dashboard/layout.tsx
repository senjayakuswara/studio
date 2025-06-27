
"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import { doc, getDoc } from "firebase/firestore"
import Image from "next/image"
import {
  BookCopy,
  BookText,
  ChevronDown,
  ClipboardCheck,
  Clock,
  Fingerprint,
  LayoutDashboard,
  Loader2,
  Printer,
  School,
  Send,
  Settings,
  Users,
} from "lucide-react"

import { db } from "@/lib/firebase"
import { onAuthChange } from "@/lib/auth"
import { cn } from "@/lib/utils"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/components/ui/sidebar"
import { UserNav } from "@/components/user-nav"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter();
  const isActive = (path: string) => pathname.startsWith(path)
  const [appName, setAppName] = useState("AbTrack")
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const { toast } = useToast()

  useEffect(() => {
    const unsubscribe = onAuthChange((user) => {
      if (!user) {
        router.push('/login');
      } else {
        setIsAuthLoading(false);
      }
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    async function fetchSettings() {
      setIsLoading(true);
      try {
        const docRef = doc(db, "settings", "appConfig");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setAppName(data.appName || "AbTrack");
          setLogoUrl(data.logoUrl || null);
          document.title = `${data.appName || "AbTrack"} - Dashboard`;
          
          const theme = data.theme || {};
          if (theme.primary) document.documentElement.style.setProperty('--primary', theme.primary);
          if (theme.background) document.documentElement.style.setProperty('--background', theme.background);
          if (theme.accent) document.documentElement.style.setProperty('--accent', theme.accent);

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

  if (isAuthLoading) {
      return (
          <div className="flex h-screen w-full items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
      )
  }

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center gap-2 p-2">
            {isLoading ? (
                <>
                    <Skeleton className="h-8 w-8 rounded-lg" />
                    <Skeleton className="h-6 w-24" />
                </>
            ) : (
                <>
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                        {logoUrl ? (
                            <Image src={logoUrl} alt="Logo" width={24} height={24} className="rounded-md" />
                        ) : (
                            <School className="h-5 w-5" />
                        )}
                    </div>
                    <span className="font-headline text-lg font-semibold">{appName}</span>
                </>
            )}
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <Link href="/dashboard">
                <SidebarMenuButton
                  tooltip="Dashboard"
                  isActive={pathname === "/dashboard"}
                >
                  <LayoutDashboard />
                  <span>Dashboard</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <Collapsible
                className="w-full"
                defaultOpen={pathname.startsWith("/dashboard/e-absensi")}
              >
                <CollapsibleTrigger className="w-full" asChild>
                  <SidebarMenuButton
                    tooltip="E-Absensi"
                    isActive={pathname.startsWith("/dashboard/e-absensi")}
                    className="group w-full justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <Fingerprint />
                      <span>E-Absensi</span>
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden">
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <Link href="/dashboard/e-absensi/x">
                        <SidebarMenuSubButton
                          isActive={pathname === "/dashboard/e-absensi/x"}
                        >
                          Kelas X
                        </SidebarMenuSubButton>
                      </Link>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <Link href="/dashboard/e-absensi/xi">
                        <SidebarMenuSubButton
                          isActive={pathname === "/dashboard/e-absensi/xi"}
                        >
                          Kelas XI
                        </SidebarMenuSubButton>
                      </Link>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <Link href="/dashboard/e-absensi/xii">
                        <SidebarMenuSubButton
                          isActive={pathname === "/dashboard/e-absensi/xii"}
                        >
                          Kelas XII
                        </SidebarMenuSubButton>
                      </Link>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <Link href="/dashboard/siswa">
                <SidebarMenuButton
                  tooltip="Manajemen Siswa"
                  isActive={pathname === "/dashboard/siswa"}
                >
                  <Users />
                  <span>Manajemen Siswa</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <Link href="/dashboard/absensi">
                <SidebarMenuButton
                  tooltip="Manajemen Absensi"
                  isActive={pathname === "/dashboard/absensi"}
                >
                  <ClipboardCheck />
                  <span>Manajemen Absensi</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <Link href="/dashboard/rekapitulasi">
                <SidebarMenuButton
                  tooltip="Rekapitulasi"
                  isActive={pathname === "/dashboard/rekapitulasi"}
                >
                  <BookText />
                  <span>Rekapitulasi</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarGroup>
            <SidebarGroupLabel>Pengaturan</SidebarGroupLabel>
            <SidebarMenu>
               <SidebarMenuItem>
                <Link href="/dashboard/pengaturan/aplikasi">
                  <SidebarMenuButton
                    tooltip="Pengaturan Aplikasi"
                    isActive={isActive("/dashboard/pengaturan/aplikasi")}
                  >
                    <Settings />
                    <span>Aplikasi</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link href="/dashboard/pengaturan/kelas">
                  <SidebarMenuButton
                    tooltip="Manajemen Kelas"
                    isActive={isActive("/dashboard/pengaturan/kelas")}
                  >
                    <BookCopy />
                    <span>Kelas</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link href="/dashboard/pengaturan/notifikasi">
                  <SidebarMenuButton
                    tooltip="Notifikasi Telegram"
                    isActive={isActive("/dashboard/pengaturan/notifikasi")}
                  >
                    <Send />
                    <span>Notifikasi</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link href="/dashboard/pengaturan/laporan">
                  <SidebarMenuButton
                    tooltip="Desain Laporan"
                    isActive={isActive("/dashboard/pengaturan/laporan")}
                  >
                    <Printer />
                    <span>Laporan</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link href="/dashboard/pengaturan/jam">
                  <SidebarMenuButton
                    tooltip="Pengaturan Jam"
                    isActive={isActive("/dashboard/pengaturan/jam")}
                  >
                    <Clock />
                    <span>Jam Sekolah</span>
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
        <div className="flex-1 p-4 md:p-6">{children}</div>
        <footer className="bg-muted p-4 text-center text-sm text-muted-foreground">
            <p>2025 @ E-Absensi created by KS</p>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  )
}
