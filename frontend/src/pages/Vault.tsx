import { PdfPages } from "@/components/editor/VaultPdf";
import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { vaultApi } from "@/lib/api";
import { usePlanGate } from "@/hooks/usePlanGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FilterChips } from "@/components/ui/filter-chips";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  FileText, Image as ImageIcon, File as FileGeneric,
  Loader2, HardDrive, Trash2, Music, ExternalLink, Edit,
} from "@/lib/heroicons";
import type { VaultFile } from "@/types";
import { ensureWallpaperLoaded, getWallpaperFileIdSync } from "@/lib/note-wallpaper";
import { loadVaultNames, displayName, renameVaultFile, splitExtension } from "@/lib/vault-names";
import { useAuth } from "@/contexts/AuthContext";
import { getPlanLimits, isUnlimited } from "@/lib/plan";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { resolveVaultBlob, invalidateVaultBlob } from "@/lib/vault-blob";
import { queryClient } from "@/lib/query-client";

type Category = "images" | "audio" | "pdf" | "other";

function categoryOf(file: VaultFile): Category {
  const t = (file.contentType || "").toLowerCase();
  const n = (file.fileName || "").toLowerCase();
  if (t.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)$/.test(n)) return "images";
  if (t.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|aac)$/.test(n)) return "audio";
  if (t === "application/pdf" || /\.pdf$/.test(n)) return "pdf";
  return "other";
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function useBlobUrl(fileId: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!fileId) return;
    setError(false);
    resolveVaultBlob(fileId)
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [fileId]);
  return { url, error };
}

/* ── Componentes de Itens Modificados pro Novo Design ────────────────── */

function ItemActions({
  file, onDelete, onRename, className,
}: { file: VaultFile; onDelete: (f: VaultFile) => void; onRename: (f: VaultFile) => void; className?: string }) {
  return (
    <div className={className}>
      <Button
        type="button" size="icon" variant="ghost"
        className="h-7 w-7 rounded-sm text-white/40 hover:text-white hover:bg-white/5"
        onClick={(e) => { e.stopPropagation(); onRename(file); }}
        aria-label="Rename file"
      >
        <Edit className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button" size="icon" variant="ghost"
        className="h-7 w-7 rounded-sm text-white/40 hover:text-red-400 hover:bg-white/5"
        onClick={(e) => { e.stopPropagation(); onDelete(file); }}
        aria-label="Delete file"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function ImageThumb({ file, name, onDelete, onRename, onOpen }: {
  file: VaultFile; name: string; onDelete: (f: VaultFile) => void; onRename: (f: VaultFile) => void; onOpen: (f: VaultFile) => void;
}) {
  const { url, error } = useBlobUrl(file.id);
  const { t } = useLanguage();
  return (
    <Card variant="subtle" className="group relative cursor-zoom-in overflow-hidden border-white/5 bg-black/10 aspect-square p-0 transition-colors hover:border-white/20" onClick={() => onOpen(file)}>
      {error ? (
        <div className="flex items-center justify-center h-full text-[11px] text-red-400/70 font-mono">{t("gr_vault_error_generic")}</div>
      ) : url ? (
        <img src={url} alt={name} className="w-full h-full object-cover transition-opacity duration-300 opacity-80 group-hover:opacity-100" />
      ) : (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-3 w-3 animate-spin text-white/20" />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="text-xs text-white/90 truncate">{name}</p>
        <p className="text-[10px] font-mono text-white/40 mt-0.5">{formatSize(file.size)}</p>
      </div>
      <ItemActions
        file={file}
        onDelete={onDelete}
        onRename={onRename}
        className="absolute top-1.5 right-1.5 flex items-center rounded-sm bg-black/50 opacity-100 transition-all sm:opacity-0 sm:group-hover:opacity-100"
      />
    </Card>
  );
}

function AudioPlayer({ file, name, onDelete, onRename }: {
  file: VaultFile; name: string; onDelete: (f: VaultFile) => void; onRename: (f: VaultFile) => void;
}) {
  const { url, error } = useBlobUrl(file.id);
  const { t } = useLanguage();
  return (
    <Card variant="subtle" className="group relative flex flex-col justify-between border-white/5 bg-black/10 p-4 transition-colors hover:border-white/10">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-serif text-white/80 truncate group-hover:text-white transition-colors">{name}</p>
          <p className="text-[10px] font-mono text-white/30 mt-0.5">{formatSize(file.size)}</p>
        </div>
        <ItemActions file={file} onDelete={onDelete} onRename={onRename} className="flex shrink-0 items-center" />
      </div>
      <div className="mt-4">
        {error ? (
          <p className="text-[11px] font-mono text-red-400/60">{t("gr_vault_audio_error")}</p>
        ) : url ? (
          <audio src={url} controls className="w-full h-8 accent-white filter invert opacity-40 hover:opacity-70 transition-opacity" />
        ) : (
          <div className="flex items-center gap-2 text-[11px] font-mono text-white/30">
            <Loader2 className="h-3 w-3 animate-spin" /> {t("gr_vault_audio_fetching")}
          </div>
        )}
      </div>
    </Card>
  );
}

function PdfCard({ file, name, onDelete, onRename, onOpen }: {
  file: VaultFile; name: string; onDelete: (f: VaultFile) => void; onRename: (f: VaultFile) => void; onOpen: (f: VaultFile) => void;
}) {
  const { url, error } = useBlobUrl(file.id);
  const { t } = useLanguage();
  return (
    <Card variant="subtle" className="border-white/5 bg-black/10 overflow-hidden flex flex-col p-0 transition-colors hover:border-white/10 group">
      <button type="button" onClick={() => onOpen(file)} className="aspect-[4/3] bg-black/40 relative overflow-hidden border-b border-white/5 flex items-center justify-center">
        {error ? (
          <div className="text-[11px] font-mono text-red-400/60">{t("gr_vault_error_generic")}</div>
        ) : url ? (
          <PdfPages src={url} maxPages={1} onError={() => {}} className="pointer-events-none absolute inset-0 overflow-hidden bg-white/90 opacity-80 group-hover:opacity-100 transition-opacity" />
        ) : (
          <Loader2 className="h-3 w-3 animate-spin text-white/20" />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-[11px] bg-black border border-white/10 px-2.5 py-1 text-white/80 rounded-sm">{t("gr_vault_view_document")}</span>
        </div>
      </button>
      <div className="p-3 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-serif text-white/80 truncate group-hover:text-white">{name}</p>
          <p className="text-[10px] font-mono text-white/30 mt-0.5">{formatSize(file.size)}</p>
        </div>
        <div className="flex items-center shrink-0">
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7 rounded-sm text-white/30 hover:text-white hover:bg-white/5" onClick={() => onOpen(file)}>
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <ItemActions file={file} onDelete={onDelete} onRename={onRename} className="flex items-center" />
        </div>
      </div>
    </Card>
  );
}

function OtherFileRow({ file, name, onDelete, onRename }: {
  file: VaultFile; name: string; onDelete: (f: VaultFile) => void; onRename: (f: VaultFile) => void;
}) {
  return (
    <div className="group relative flex items-center justify-between py-4 border-b border-white/[0.06] hover:bg-white/[0.01] transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <FileGeneric className="w-3.5 h-3.5 text-white/30 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-serif text-white/80 truncate group-hover:text-white transition-colors">{name}</p>
          <p className="text-[10px] font-mono text-white/30 mt-0.5">
            {formatSize(file.size)} &middot; {new Date(file.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>
      </div>
      <ItemActions file={file} onDelete={onDelete} onRename={onRename} className="flex shrink-0 items-center" />
    </div>
  );
}

/* ── Main Vault Page Component ────────────────────────────────────────── */

export default function Vault() {
  const { t } = useLanguage();
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<VaultFile | null>(null);
  const [pdfPreview, setPdfPreview] = useState<VaultFile | null>(null);
  const [mediaPreview, setMediaPreview] = useState<VaultFile | null>(null);
  const [renameTarget, setRenameTarget] = useState<VaultFile | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [category, setCategory] = useState<Category>("images");
  const [search, setSearch] = useState("");
  const [wallpaperFileId, setWallpaperFileId] = useState<string | null>(() => getWallpaperFileIdSync());

  useEffect(() => {
    void ensureWallpaperLoaded().then((w) => setWallpaperFileId(w.fileId));
  }, []);

  useEffect(() => {
    void loadVaultNames().then((m) => setNames({ ...m }));
  }, []);

  const nameOf = (f: VaultFile) => displayName(f.id, f.fileName || "");

  const openRename = (f: VaultFile) => {
    setRenameTarget(f);
    setRenameValue(splitExtension(nameOf(f)).base);
  };

  const submitRename = async () => {
    const file = renameTarget;
    if (!file) return;
    setRenameTarget(null);
    try {
      // Only the base name changes — the extension (and therefore the file
      // type) is preserved automatically.
      await renameVaultFile(file.id, renameValue);
      setNames({ ...(await loadVaultNames()) });
      toast({ title: t("gr_vault_renamed") || "File renamed" });
    } catch {
      toast({ title: t("gr_vault_rename_failed") || "Could not rename file", variant: "destructive" });
    }
  };

  const { toast } = useToast();
  const { user } = useAuth();
  const { loading: authLoading } = useRequireAuth();
  const { applyUsageDelta } = usePlanGate();
  const limits = getPlanLimits(user);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const { data } = await vaultApi.list();
      const all = Array.isArray(data) ? data : [];
      // The editor wallpaper is a system file: never listed, never counted.
      setFiles(all.filter((f: VaultFile) => f.id !== wallpaperFileId));
    } catch {
      toast({ title: t("gr_vault_error_loading"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchFiles(); }, [wallpaperFileId]);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const visible = q
      ? files.filter((f) => nameOf(f).toLowerCase().includes(q) || (f.fileName || "").toLowerCase().includes(q))
      : files;
    const g: Record<Category, VaultFile[]> = { images: [], audio: [], pdf: [], other: [] };
    for (const f of visible) g[categoryOf(f)].push(f);
    return g;
  }, [files, search, names]);


  const confirmDelete = async () => {
    const file = pendingDelete;
    if (!file) return;
    setPendingDelete(null);
    try {
      await vaultApi.delete(file.id);
      await queryClient.invalidateQueries({ queryKey: ["trash"] });
      invalidateVaultBlob(file.id);
      setFiles((cur) => cur.filter((f) => f.id !== file.id));
      applyUsageDelta({ vaultSizeMB: -Number((file.size / (1024 * 1024)).toFixed(2)) });
      toast({ title: t("gr_vault_delete_success") });
    } catch {
      toast({ title: t("gr_vault_delete_failed"), variant: "destructive" });
    }
  };

  const pdfPreviewBlob = useBlobUrl(pdfPreview?.id ?? null);

  if (authLoading) {
    return (
      <AppLayout>
        <div className="mx-auto w-full max-w-6xl animate-fade-in px-4 py-8 sm:px-6">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-4 h-9 w-48" />
          <Skeleton className="mt-6 h-2 w-full rounded-full" />
          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="aspect-[4/3] w-full" />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  const vaultUsedMB = files.reduce((t, f) => t + f.size / (1024 * 1024), 0);
  const vaultMaxMB = limits.maxVaultSizeMB;
  const vaultPct = isUnlimited(vaultMaxMB) ? 0 : Math.min((vaultUsedMB / vaultMaxMB) * 100, 100);

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl px-6 py-10 lg:px-12 lg:py-16">
        <main className="min-w-0 flex-1">
          
          {/* Cabeçalho (desktop) — no mobile o título vem do AppLayout */}
          <header className="mb-8 hidden lg:block">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
                {t("gr_vault_title")}
              </p>
              <h1 className="mt-2 font-serif text-5xl tracking-tight text-foreground">
                {t("vault_title")}
              </h1>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {t("gr_vault_subtitle")}
            </p>
          </header>


          {/* Indicador de Espaço Sutil (Removido o bloco chamativo) */}
          <div className="mb-6 border-b border-white/5 pb-5 pt-2">
            <div className="flex items-center justify-between text-[11px] font-mono text-white/40 mb-2">
              <div className="flex items-center gap-1.5">
                <HardDrive className="w-3 h-3 text-white/30" />
                <span>{t("gr_vault_volume_capacity")}</span>
              </div>
              <span>
                {isUnlimited(vaultMaxMB) ? `${vaultUsedMB.toFixed(1)} MB` : `${vaultUsedMB.toFixed(1)} / ${vaultMaxMB} MB`}
              </span>
            </div>
            <Progress value={isUnlimited(vaultMaxMB) ? 0 : vaultPct} className="h-[2px] bg-white/5 text-white" />
          </div>

          {loading ? (
            <div className="flex justify-center py-24">
              <Loader2 className="h-5 w-5 animate-spin text-white/30" />
            </div>
          ) : files.length === 0 ? (
            /* Empty State poético e limpo igual ao do seu Notes */
            <div className="py-24 text-center">
              <p className="font-serif text-2xl italic text-white/40">
                {t("vault_empty")}
              </p>
            </div>
          ) : (
            
            /* Tabs minimalistas estilo Notion/Axiom UI */
            <div className="w-full">
              {/* Busca + filtros, mesmo padrão de Notes/Entities */}
              <div className="mb-5 space-y-3">
                <div className="relative">
                  <MagnifyingGlassIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("vault_searchAmong", { n: files.length })}
                    className="h-12 w-full rounded-2xl bg-accent pl-11 text-[15px] placeholder:italic placeholder:text-muted-foreground"
                  />
                </div>
                <FilterChips
                  value={category}
                  onChange={(v) => setCategory(v as Category)}
                  options={[
                    { value: "images", label: `${t("gr_vault_tab_photos")} · ${grouped.images.length}` },
                    { value: "audio", label: `${t("gr_vault_tab_audio")} · ${grouped.audio.length}` },
                    { value: "pdf", label: `${t("gr_vault_tab_pdf")} · ${grouped.pdf.length}` },
                    { value: "other", label: `${t("gr_vault_tab_other")} · ${grouped.other.length}` },
                  ]}
                />
              </div>

              {category === "images" && (
                grouped.images.length === 0 ? (
                  <p className="py-12 font-serif text-sm italic text-muted-foreground">{t("gr_vault_no_images")}</p>
                ) : (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {grouped.images.map((f) => (
                      <ImageThumb key={f.id} file={f} name={nameOf(f)} onDelete={setPendingDelete} onRename={openRename} onOpen={setMediaPreview} />
                    ))}
                  </div>
                )
              )}

              {category === "audio" && (
                grouped.audio.length === 0 ? (
                  <p className="py-12 font-serif text-sm italic text-muted-foreground">{t("gr_vault_no_audio")}</p>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {grouped.audio.map((f) => (
                      <AudioPlayer key={f.id} file={f} name={nameOf(f)} onDelete={setPendingDelete} onRename={openRename} />
                    ))}
                  </div>
                )
              )}

              {category === "pdf" && (
                grouped.pdf.length === 0 ? (
                  <p className="py-12 font-serif text-sm italic text-muted-foreground">{t("gr_vault_no_pdf")}</p>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                    {grouped.pdf.map((f) => (
                      <PdfCard key={f.id} file={f} name={nameOf(f)} onDelete={setPendingDelete} onRename={openRename} onOpen={setPdfPreview} />
                    ))}
                  </div>
                )
              )}

              {category === "other" && (
                grouped.other.length === 0 ? (
                  <p className="py-12 font-serif text-sm italic text-muted-foreground">{t("gr_vault_no_other")}</p>
                ) : (
                  <div className="divide-y divide-border">
                    {grouped.other.map((f) => (
                      <OtherFileRow key={f.id} file={f} name={nameOf(f)} onDelete={setPendingDelete} onRename={openRename} />
                    ))}
                  </div>
                )
              )}
            </div>

          )}
        </main>
      </div>

      {/* CONFIRM DIALOG */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("gr_vault_remove_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("gr_vault_remove_desc", { fileName: (pendingDelete ? nameOf(pendingDelete) : "") || t("gr_vault_this_asset") })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("gr_vault_cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{t("gr_vault_remove")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* MODAL EXPANDIDO DE PREVIEW PDF */}
      <Dialog open={!!pdfPreview} onOpenChange={(open) => !open && setPdfPreview(null)}>
        <DialogContent
          hideClose
          viewportAware={false}
          overlayClassName="bg-black/80 backdrop-blur-md"
          className="fixed inset-0 left-0 top-0 z-50 grid h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 grid-rows-[auto_1fr] gap-0 rounded-none border-0 bg-transparent p-0 shadow-none flex flex-col"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-black/40 backdrop-blur-xl text-white">
            <p className="font-serif text-sm truncate max-w-xl">{pdfPreview?.fileName}</p>
            <Button size="sm" variant="ghost" onClick={() => setPdfPreview(null)} className="text-white/40 hover:text-white rounded-sm hover:bg-white/5 text-xs">{t("gr_vault_close")}</Button>
          </div>
          <div className="flex-1 p-6">
            {pdfPreviewBlob.url ? (
              <PdfPages src={pdfPreviewBlob.url} onError={() => {}} className="mx-auto h-full max-w-3xl overflow-y-auto" />
            ) : (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-5 w-5 animate-spin text-white/30" />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* MEDIA PLAYER — images */}
      <Dialog open={!!mediaPreview} onOpenChange={(open) => !open && setMediaPreview(null)}>
        <DialogContent
          hideClose
          viewportAware={false}
          overlayClassName="bg-black/90 backdrop-blur-md"
          className="fixed inset-0 left-0 top-0 z-50 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-transparent p-0 shadow-none"
        >
          <div className="flex items-center justify-between border-b border-white/5 bg-black/40 px-6 py-4 text-white backdrop-blur-xl">
            <p className="max-w-xl truncate font-serif text-sm">{mediaPreview ? nameOf(mediaPreview) : ""}</p>
            <Button size="sm" variant="ghost" onClick={() => setMediaPreview(null)} className="rounded-sm text-xs text-white/40 hover:bg-white/5 hover:text-white">
              {t("gr_vault_close")}
            </Button>
          </div>
          <div className="flex flex-1 items-center justify-center p-4 sm:p-8">
            {mediaPreview && <MediaViewerBody file={mediaPreview} name={nameOf(mediaPreview)} />}
          </div>
        </DialogContent>
      </Dialog>

      {/* RENAME DIALOG — extension is preserved silently */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="text-left">
            <DialogTitle>{t("gr_vault_rename_title")}</DialogTitle>
            <DialogDescription>{t("gr_vault_rename_hint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="vault-file-name" className="sr-only">{t("gr_vault_rename_title")}</Label>
          <Input
            id="vault-file-name"
            type="text"
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submitRename(); } }}
            className="h-10 border border-[hsl(var(--popup-border))] bg-white/[0.03] text-sm focus-visible:ring-2 focus-visible:ring-ring"
          />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRenameTarget(null)}>
              {t("gr_vault_cancel")}
            </Button>
            <Button type="button" onClick={() => void submitRename()} disabled={!renameValue.trim()}>
              {t("gr_vault_save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

function MediaViewerBody({ file, name }: { file: VaultFile; name: string }) {
  const { url, error } = useBlobUrl(file.id);
  if (error) return <p className="font-mono text-xs text-red-400/70">{name}</p>;
  if (!url) return <Loader2 className="h-5 w-5 animate-spin text-white/30" />;
  return <img src={url} alt={name} className="max-h-full max-w-full rounded-sm object-contain" />;
}
