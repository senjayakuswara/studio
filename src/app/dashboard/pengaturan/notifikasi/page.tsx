"use client"

import { useState, useEffect, useMemo } from "react"
import { collection, query, onSnapshot, orderBy, doc, updateDoc, deleteDoc, Timestamp } from "firebase/firestore"
import { format, formatDistanceToNow } from "date-fns"
import { id as localeID } from "date-fns/locale"
import { Trash2, Send, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"

type NotificationJob = {
    id: string;
    payload: { recipient: string; message: string; };
    status: 'pending' | 'sent' | 'failed' | 'processing';
    createdAt: Timestamp;
    updatedAt: Timestamp;
    errorMessage?: string;
}

export default function NotifikasiPage() {
    const [jobs, setJobs] = useState<NotificationJob[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessingAction, setIsProcessingAction] = useState<string | null>(null);
    const { toast } = useToast();

    useEffect(() => {
        const q = query(collection(db, "notification_queue"), orderBy("createdAt", "desc"));
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const jobsData: NotificationJob[] = [];
            querySnapshot.forEach((doc) => {
                jobsData.push({ id: doc.id, ...doc.data() } as NotificationJob);
            });
            setJobs(jobsData);
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching notification queue:", error);
            toast({
                variant: "destructive",
                title: "Gagal Memuat Antrean",
                description: "Tidak dapat terhubung ke database untuk memuat data antrean notifikasi.",
            });
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [toast]);
    
    const sortedJobs = useMemo(() => {
        return jobs.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    }, [jobs]);

    const handleRetry = async (jobId: string) => {
        setIsProcessingAction(jobId);
        try {
            const jobRef = doc(db, "notification_queue", jobId);
            await updateDoc(jobRef, {
                status: 'pending',
                updatedAt: Timestamp.now(),
                errorMessage: 'Retrying...',
                retryCount: 0, // Reset retry count
            });
            toast({ title: "Sukses", description: "Tugas dijadwalkan untuk dicoba kembali." });
        } catch (e: any) {
            console.error(`Failed to retry job ${jobId}`, e);
            toast({ variant: "destructive", title: "Gagal", description: e.message });
        } finally {
            setIsProcessingAction(null);
        }
    };

    const handleDelete = async (jobId: string) => {
        setIsProcessingAction(jobId);
        try {
            const jobRef = doc(db, "notification_queue", jobId);
            await deleteDoc(jobRef);
            toast({ title: "Sukses", description: "Tugas berhasil dihapus dari antrean." });
        } catch (e: any) {
            console.error(`Failed to delete job ${jobId}`, e);
            toast({ variant: "destructive", title: "Gagal", description: e.message });
        } finally {
            setIsProcessingAction(null);
        }
    };

    const getStatusVariant = (status: NotificationJob['status']) => {
        switch (status) {
            case 'sent': return 'default';
            case 'failed': return 'destructive';
            case 'pending': return 'secondary';
            case 'processing': return 'outline';
            default: return 'outline';
        }
    };

  return (
    <div className="flex flex-col gap-6">
       <div>
          <h1 className="font-headline text-3xl font-bold tracking-tight">Antrean Notifikasi</h1>
          <p className="text-muted-foreground">Pantau status pengiriman notifikasi WhatsApp ke grup kelas.</p>
        </div>
      <Card>
        <CardHeader>
          <CardTitle>Daftar Tugas Notifikasi</CardTitle>
          <CardDescription>
            Menampilkan 50 tugas notifikasi terakhir. Status diperbarui secara real-time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead>Tujuan (Grup)</TableHead>
                  <TableHead>Waktu Dibuat</TableHead>
                  <TableHead>Pesan / Error</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={5}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : sortedJobs.length > 0 ? (
                  sortedJobs.slice(0, 50).map((job) => (
                    <TableRow key={job.id}>
                      <TableCell>
                        <Badge variant={getStatusVariant(job.status)} className="capitalize">
                            {job.status === 'processing' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                            {job.status === 'sent' && <CheckCircle2 className="mr-1 h-3 w-3" />}
                            {job.status === 'failed' && <AlertCircle className="mr-1 h-3 w-3" />}
                            {job.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{job.payload.recipient}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                            <span>{format(job.createdAt.toDate(), "d MMM yyyy, HH:mm", { locale: localeID })}</span>
                            <span className="text-xs text-muted-foreground">{formatDistanceToNow(job.createdAt.toDate(), { addSuffix: true, locale: localeID })}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <p className="truncate text-sm text-foreground">{job.status === 'failed' ? job.errorMessage : job.payload.message}</p>
                      </TableCell>
                      <TableCell className="text-right">
                         <div className="flex gap-2 justify-end">
                                                    {job.status === 'failed' && (
                                                         <Button size="sm" variant="secondary" onClick={() => handleRetry(job.id)} disabled={isProcessingAction !== null}>
                                                            {isProcessingAction === job.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                                         </Button>
                                                    )}
                                                     <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button size="sm" variant="destructive" disabled={isProcessingAction !== null}>
                                                                {isProcessingAction === job.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Anda Yakin?</AlertDialogTitle>
                                                                <AlertDialogDescription>Tindakan ini akan menghapus tugas notifikasi ini secara permanen dari antrean.</AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Batal</AlertDialogCancel>
                                                                <AlertDialogAction onClick={() => handleDelete(job.id)}>Ya, Hapus</AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      Tidak ada tugas notifikasi ditemukan.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
