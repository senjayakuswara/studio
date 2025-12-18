
"use client"

import { useState, useEffect } from 'react';
import { collection, query, orderBy, getDocs, limit, startAfter, DocumentData, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import { id as localeID } from "date-fns/locale";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { processSingleNotification, deleteNotificationJob, type NotificationJob } from "@/ai/flows/notification-flow";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Bot, Loader2, RefreshCw, Trash2, Send, Clock, CheckCircle2, XCircle, Edit } from "lucide-react";
import { Skeleton } from '@/components/ui/skeleton';
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
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const PAGE_SIZE = 15;

const editRecipientSchema = z.object({
  newRecipient: z.string().refine(val => /^\d{10,15}$/.test(val), {
    message: "Nomor WhatsApp harus berupa angka 10-15 digit (cth: 6281234567890)."
  }),
});

export default function NotifikasiPage() {
    const [jobs, setJobs] = useState<NotificationJob[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessing, setIsProcessing] = useState<string | 'all' | null>(null);
    const [lastDoc, setLastDoc] = useState<DocumentData | null>(null);
    const [isPaginating, setIsPaginating] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [editingJob, setEditingJob] = useState<NotificationJob | null>(null);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const { toast } = useToast();

    const form = useForm<z.infer<typeof editRecipientSchema>>({
      resolver: zodResolver(editRecipientSchema),
    });

    const fetchJobs = async (loadMore = false) => {
        if (!loadMore) {
            setIsLoading(true);
            setJobs([]);
            setLastDoc(null);
            setHasMore(true);
        } else {
            setIsPaginating(true);
        }

        try {
            let q = query(
                collection(db, "notification_queue"), 
                orderBy("createdAt", "desc"), 
                limit(PAGE_SIZE)
            );

            if (loadMore && lastDoc) {
                q = query(
                    collection(db, "notification_queue"), 
                    orderBy("createdAt", "desc"), 
                    startAfter(lastDoc),
                    limit(PAGE_SIZE)
                );
            }

            const querySnapshot = await getDocs(q);
            const newJobs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as NotificationJob[];
            
            setJobs(prev => loadMore ? [...prev, ...newJobs] : newJobs);

            const newLastDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
            setLastDoc(newLastDoc);

            if (querySnapshot.docs.length < PAGE_SIZE) {
                setHasMore(false);
            }

        } catch (error) {
            console.error("Error fetching notification jobs:", error);
            toast({
                variant: "destructive",
                title: "Gagal Memuat Data",
                description: "Tidak dapat memuat antrean notifikasi dari server."
            });
        } finally {
            setIsLoading(false);
            setIsPaginating(false);
        }
    };
    
    useEffect(() => {
        fetchJobs();
    }, []);

    const handleRetry = async (jobId: string) => {
        setIsProcessing(jobId);
        const result = await processSingleNotification(jobId);
        if (result.success) {
            toast({ title: "Sukses", description: "Notifikasi berhasil dikirim." });
            setJobs(prevJobs => prevJobs.map(job => job.id === jobId ? { ...job, status: 'success', errorMessage: '' } : job));
        } else {
            toast({ variant: "destructive", title: "Gagal", description: result.error || "Gagal mengirim notifikasi. Cek log server lokal." });
             setJobs(prevJobs => prevJobs.map(job => job.id === jobId ? { ...job, status: 'failed', errorMessage: result.error || "Failed on manual retry" } : job));
        }
        setIsProcessing(null);
    };

    const handleDelete = async (jobId: string) => {
        setIsProcessing(jobId);
        try {
            await deleteNotificationJob(jobId);
            toast({ title: "Dihapus", description: "Notifikasi telah dihapus dari antrean." });
            setJobs(prevJobs => prevJobs.filter(job => job.id !== jobId));
        } catch (error) {
            toast({ variant: "destructive", title: "Gagal Menghapus" });
        }
        setIsProcessing(null);
    };

    const handleRetryAll = async () => {
        setIsProcessing('all');
        const pendingJobs = jobs.filter(job => job.status === 'pending' || job.status === 'failed');
        if (pendingJobs.length === 0) {
            toast({ title: "Tidak Ada Tugas", description: "Tidak ada notifikasi yang perlu dikirim ulang."});
            setIsProcessing(null);
            return;
        }

        toast({ title: "Memulai Proses", description: `Mencoba mengirim ulang ${pendingJobs.length} notifikasi...` });

        let successCount = 0;
        let failCount = 0;

        for (const job of pendingJobs) {
            const result = await processSingleNotification(job.id);
            if (result.success) {
                successCount++;
                setJobs(prev => prev.map(j => j.id === job.id ? {...j, status: 'success', errorMessage: ''} : j));
            } else {
                failCount++;
                setJobs(prev => prev.map(j => j.id === job.id ? {...j, status: 'failed', errorMessage: result.error || 'Failed on bulk retry'} : j));
            }
        }

        toast({
            title: "Proses Selesai",
            description: `${successCount} berhasil terkirim, ${failCount} gagal.`
        });
        setIsProcessing(null);
    };

    const openEditModal = (job: NotificationJob) => {
      setEditingJob(job);
      form.reset({ newRecipient: job.payload.recipient });
      setIsEditModalOpen(true);
    };
    
    const handleUpdateAndSend = async (values: z.infer<typeof editRecipientSchema>) => {
      if (!editingJob) return;
      setIsProcessing(editingJob.id);
      try {
        const jobRef = doc(db, "notification_queue", editingJob.id);
        const newPayload = { ...editingJob.payload, recipient: values.newRecipient };
        await updateDoc(jobRef, { payload: newPayload });
        
        const updatedJob = { ...editingJob, payload: newPayload };
        
        const result = await processSingleNotification(editingJob.id);
        if (result.success) {
          toast({ title: "Sukses", description: `Nomor diperbarui dan notifikasi berhasil dikirim ke ${values.newRecipient}` });
          setJobs(prev => prev.map(j => j.id === editingJob.id ? {...updatedJob, status: 'success', errorMessage: ''} : j));
          setIsEditModalOpen(false);
          setEditingJob(null);
        } else {
          toast({ variant: "destructive", title: "Gagal Mengirim", description: result.error || "Nomor berhasil diperbarui, namun pengiriman tetap gagal." });
          setJobs(prev => prev.map(j => j.id === editingJob.id ? {...updatedJob, status: 'failed', errorMessage: result.error} : j));
        }

      } catch (error: any) {
        toast({ variant: "destructive", title: "Gagal Memperbarui", description: error.message });
      } finally {
        setIsProcessing(null);
      }
    };
    
    const getStatusVariant = (status: NotificationJob['status']): 'default' | 'secondary' | 'destructive' => {
        switch (status) {
            case 'success': return 'default';
            case 'pending': return 'secondary';
            case 'failed': return 'destructive';
            default: return 'secondary';
        }
    }

    const getStatusIcon = (status: NotificationJob['status']) => {
        switch (status) {
            case 'success': return <CheckCircle2 className="h-4 w-4 mr-2" />;
            case 'pending': return <Clock className="h-4 w-4 mr-2" />;
            case 'failed': return <XCircle className="h-4 w-4 mr-2" />;
            default: return null;
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit & Kirim Ulang Notifikasi</DialogTitle>
                        <DialogDescription>
                            Perbarui nomor tujuan untuk notifikasi kepada <span className="font-semibold">{(editingJob?.metadata as any)?.studentName || 'Siswa'}</span>, lalu coba kirim lagi.
                        </DialogDescription>
                    </DialogHeader>
                     <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleUpdateAndSend)} className="space-y-4 py-4">
                        <FormField
                            control={form.control}
                            name="newRecipient"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Nomor WhatsApp Baru</FormLabel>
                                <FormControl>
                                    <Input placeholder="cth: 6281234567890" {...field} />
                                </FormControl>
                                <FormMessage />
                                </FormItem>
                            )}
                            />
                        <DialogFooter>
                            <Button type="submit" disabled={isProcessing === editingJob?.id}>
                                {isProcessing === editingJob?.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Perbarui & Kirim Ulang
                            </Button>
                        </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            <div className="flex items-start justify-between">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Antrean Notifikasi</h1>
                    <p className="text-muted-foreground">Kelola notifikasi yang tertunda atau gagal terkirim.</p>
                </div>
                <div className="flex gap-2">
                    <Button onClick={() => fetchJobs()} disabled={isLoading || isProcessing !== null} variant="outline">
                        <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                        Muat Ulang
                    </Button>
                    <Button onClick={handleRetryAll} disabled={isProcessing !== null || jobs.filter(j => j.status !== 'success').length === 0}>
                        {isProcessing === 'all' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                        Coba Kirim Ulang Semua
                    </Button>
                </div>
            </div>
            
            <Alert variant="default">
                <Bot className="h-4 w-4" />
                <AlertTitle>Cara Kerja Sistem Antrean</AlertTitle>
                <AlertDescription>
                    Jika server WhatsApp lokal Anda mati, notifikasi tidak akan hilang. Notifikasi akan masuk ke antrean ini dengan status "gagal". Anda bisa mencoba mengirimnya lagi secara manual dari halaman ini setelah koneksi pulih. Jika error disebabkan nomor tidak terdaftar, Anda bisa mengeditnya di sini.
                </AlertDescription>
            </Alert>
            
            <Card>
                <CardHeader>
                    <CardTitle>Daftar Tugas Notifikasi</CardTitle>
                    <CardDescription>Menampilkan notifikasi yang sedang diproses, berhasil, atau gagal.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="border rounded-md">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Tujuan</TableHead>
                                    <TableHead>Waktu Dibuat</TableHead>
                                    <TableHead>Pesan / Error</TableHead>
                                    <TableHead className="text-right">Aksi</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    [...Array(5)].map((_, i) => (
                                        <TableRow key={i}>
                                            <TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell>
                                        </TableRow>
                                    ))
                                ) : jobs.length > 0 ? (
                                    jobs.map(job => (
                                        <TableRow key={job.id}>
                                            <TableCell>
                                                <Badge variant={getStatusVariant(job.status)} className="capitalize flex items-center w-fit">
                                                    {getStatusIcon(job.status)}
                                                    {job.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="font-medium">
                                                <div className='flex flex-col'>
                                                    <span>{job.payload.recipient}</span>
                                                    <span className='text-xs text-muted-foreground'>
                                                         {(job.metadata as any)?.studentName || (job.metadata as any)?.className || (job.type === 'attendance' ? 'Absensi Harian' : 'Rekap Bulanan')}
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span>{format(job.createdAt.toDate(), "d MMM yyyy, HH:mm", { locale: localeID })}</span>
                                                    <span className="text-xs text-muted-foreground">{formatDistanceToNow(job.createdAt.toDate(), { addSuffix: true, locale: localeID })}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                 <p className="max-w-xs truncate" title={job.errorMessage || job.payload.message}>
                                                    {job.status === 'failed' ? <span className='text-destructive'>{job.errorMessage}</span> : job.payload.message}
                                                 </p>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex gap-2 justify-end">
                                                    {(job.status === 'pending' || job.status === 'failed') && (
                                                      <>
                                                        <Button size="sm" variant="outline" onClick={() => openEditModal(job)} disabled={isProcessing !== null}>
                                                            <Edit className="h-4 w-4"/>
                                                        </Button>
                                                        <Button size="sm" variant="outline" onClick={() => handleRetry(job.id)} disabled={isProcessing !== null}>
                                                            {isProcessing === job.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                                        </Button>
                                                      </>
                                                    )}
                                                     <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button size="sm" variant="destructive" disabled={isProcessing !== null}>
                                                                 {isProcessing === job.id && job.id === 'delete' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Anda Yakin?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    Tindakan ini akan menghapus tugas notifikasi dari antrean secara permanen. Anda tidak dapat mengurungkannya.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Batal</AlertDialogCancel>
                                                                <AlertDialogAction onClick={() => handleDelete(job.id)}>Hapus</AlertDialogAction>
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
                    {hasMore && (
                        <div className="mt-4 flex justify-center">
                            <Button onClick={() => fetchJobs(true)} disabled={isPaginating}>
                                {isPaginating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Muat Lebih Banyak
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
