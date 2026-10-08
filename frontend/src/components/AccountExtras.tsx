import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { useQuery } from "@tanstack/react-query";
import { authApi, vaultApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useUsage } from "@/contexts/UsageContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FilterChips } from "@/components/ui/filter-chips";
import { PdfPages } from "@/components/editor/VaultPdf";
import { File, FileText, Image, Loader2, Music, Search } from "@/lib/heroicons";
import { resolveVaultBlob } from "@/lib/vault-blob";
import type { VaultFile } from "@/types";

type Lang = "en" | "es" | "pt" | "fr";
const S = {
  en: { pick: "Insert from vault", empty: "Your vault is empty.", noResults: "No files match your search.", search: "Search files", loadError: "Could not load vault files.", delTitle: "Account scheduled for deletion", delDesc: "Everything will be permanently erased on {d}.", cancel: "Cancel deletion", cancelConfirmTitle: "Cancel account deletion?", cancelConfirmDesc: "Your account and data will be kept, and the scheduled deletion will be stopped.", deleteNow: "Delete account now", deleteNowDescription: "Permanently delete your account and all data now.", deleteNowConfirmTitle: "Delete your account now?", deleteNowConfirmDescription: "Your account and all data will be permanently deleted immediately. This cannot be undone.", usage: "Plan usage", notes: "Notes", entities: "Entities", vault: "Vault", near: "You're close to your plan limit", nearDesc: "{x} is at {p}% of your limit.", upgrade: "See plans", deleteAccount: "Delete account", deleteAccountDesc: "Everything is erased after 7 days. You can cancel until then.", deleteConfirm: "Your account and all data will be permanently deleted in 7 days. You can cancel anytime before that.", canceled: "Deletion canceled" },
  es: { pick: "Insertar desde el cofre", empty: "Tu cofre está vacío.", noResults: "Ningún archivo coincide con la búsqueda.", search: "Buscar archivos", loadError: "No se pudieron cargar los archivos.", delTitle: "Cuenta programada para eliminación", delDesc: "Todo se borrará permanentemente el {d}.", cancel: "Cancelar eliminación", cancelConfirmTitle: "¿Cancelar la eliminación de la cuenta?", cancelConfirmDesc: "Tu cuenta y tus datos se conservarán y se cancelará la eliminación programada.", deleteNow: "Eliminar cuenta ahora", deleteNowDescription: "Eliminar permanentemente tu cuenta y todos tus datos ahora.", deleteNowConfirmTitle: "¿Eliminar tu cuenta ahora?", deleteNowConfirmDescription: "Tu cuenta y todos tus datos se eliminarán permanentemente de inmediato. Esta acción no se puede deshacer.", usage: "Uso del plan", notes: "Notas", entities: "Entidades", vault: "Cofre", near: "Estás cerca del límite de tu plan", nearDesc: "{x} está al {p}% del límite.", upgrade: "Ver planes", deleteAccount: "Eliminar cuenta", deleteAccountDesc: "Todo se borra tras 7 días. Puedes cancelar hasta entonces.", deleteConfirm: "Tu cuenta y todos los datos se eliminarán en 7 días. Puedes cancelar antes.", canceled: "Eliminación cancelada" },
  pt: { pick: "Inserir do cofre", empty: "Seu cofre está vazio.", noResults: "Nenhum arquivo corresponde à busca.", search: "Buscar arquivos", loadError: "Não foi possível carregar os arquivos.", delTitle: "Conta agendada para exclusão", delDesc: "Tudo será apagado definitivamente em {d}.", cancel: "Cancelar exclusão", cancelConfirmTitle: "Cancelar a exclusão da conta?", cancelConfirmDesc: "Sua conta e seus dados serão mantidos, e a exclusão agendada será interrompida.", deleteNow: "Excluir conta agora", deleteNowDescription: "Excluir permanentemente sua conta e todos os dados agora.", deleteNowConfirmTitle: "Excluir sua conta agora?", deleteNowConfirmDescription: "Sua conta e todos os seus dados serão excluídos permanentemente imediatamente. Essa ação não pode ser desfeita.", usage: "Uso do plano", notes: "Notas", entities: "Entidades", vault: "Cofre", near: "Você está perto do limite do plano", nearDesc: "{x} está em {p}% do limite.", upgrade: "Ver planos", deleteAccount: "Excluir conta", deleteAccountDesc: "Tudo é apagado após 7 dias. Você pode cancelar até lá.", deleteConfirm: "Sua conta e todos os dados serão apagados definitivamente em 7 dias. Você pode cancelar antes disso.", canceled: "Exclusão cancelada" },
  fr: { pick: "Insérer depuis le coffre", empty: "Votre coffre est vide.", noResults: "Aucun fichier ne correspond à la recherche.", search: "Rechercher des fichiers", loadError: "Impossible de charger les fichiers.", delTitle: "Compte programmé pour suppression", delDesc: "Tout sera définitivement effacé le {d}.", cancel: "Annuler la suppression", cancelConfirmTitle: "Annuler la suppression du compte ?", cancelConfirmDesc: "Votre compte et vos données seront conservés, et la suppression programmée sera annulée.", deleteNow: "Supprimer le compte maintenant", deleteNowDescription: "Supprimer définitivement votre compte et toutes vos données maintenant.", deleteNowConfirmTitle: "Supprimer votre compte maintenant ?", deleteNowConfirmDescription: "Votre compte et toutes vos données seront immédiatement supprimés définitivement. Cette action est irréversible.", usage: "Utilisation du forfait", notes: "Notes", entities: "Entités", vault: "Coffre", near: "Vous approchez de la limite", nearDesc: "{x} est à {p}% de la limite.", upgrade: "Voir les forfaits", deleteAccount: "Supprimer le compte", deleteAccountDesc: "Tout est effacé après 7 jours. Annulable d'ici là.", deleteConfirm: "Votre compte et toutes les données seront supprimés dans 7 jours. Vous pouvez annuler avant.", canceled: "Suppression annulée" },
};

type VaultCategory = "images" | "audio" | "pdf" | "other";

function getVaultCategory(file: VaultFile): VaultCategory {
  const contentType = (file.contentType || "").toLowerCase();
  const fileName = file.fileName.toLowerCase();
  if (contentType.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)$/.test(fileName)) return "images";
  if (contentType.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|aac)$/.test(fileName)) return "audio";
  if (contentType === "application/pdf" || /\.pdf$/.test(fileName)) return "pdf";
  return "other";
}

function VaultFilePreview({ file, category }: { file: VaultFile; category: VaultCategory }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = previewRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "120px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || (category !== "images" && category !== "pdf")) return;
    let cancelled = false;
    resolveVaultBlob(file.id)
      .then((blobUrl) => { if (!cancelled) setUrl(blobUrl); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [category, file.id, visible]);

  return (
    <div ref={previewRef} className="relative flex h-28 items-center justify-center overflow-hidden rounded-lg bg-foreground/[0.04]">
      {category === "images" ? (
        failed ? <File className="h-7 w-7 text-muted-foreground" />
          : url ? <img src={url} alt="" className="h-full w-full object-cover" />
            : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : category === "pdf" ? (
        failed ? <FileText className="h-7 w-7 text-muted-foreground" />
          : url ? <PdfPages src={url} maxPages={1} onError={() => setFailed(true)} className="h-28 w-full overflow-hidden bg-white/90" />
            : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : category === "audio" ? (
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Music className="h-7 w-7" />
          <span className="flex h-5 items-center gap-1" aria-hidden="true">
            {[3, 5, 2, 4, 6, 3, 5, 2, 4].map((height, index) => (
              <span key={index} className="w-1 rounded-full bg-current/60" style={{ height: `${height * 3}px` }} />
            ))}
          </span>
        </div>
      ) : (
        <File className="h-7 w-7 text-muted-foreground" />
      )}
    </div>
  );
}
export function useExtrasText() {
  const { language } = useLanguage();
  return S[(language as Lang) in S ? (language as Lang) : "en"];
}

export function VaultPicker() {
  const s = useExtrasText();
  const { t } = useLanguage();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | VaultCategory>("all");
  useEffect(() => {
    const h = (e: Event) => {
      setSearch("");
      setCategory("all");
      setEditor((e as CustomEvent).detail?.editor ?? null);
    };
    window.addEventListener("continuum:vault-pick", h);
    return () => window.removeEventListener("continuum:vault-pick", h);
  }, []);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["vault", "files", "picker"], queryFn: () => vaultApi.list().then((r) => r.data as VaultFile[]), enabled: !!editor });
  const files = useMemo(() => data ?? [], [data]);
  const filteredFiles = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return files.filter((file) => {
      const matchesCategory = category === "all" || getVaultCategory(file) === category;
      const matchesSearch = !query || file.fileName.toLocaleLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [category, files, search]);
  const filterOptions = [
    { value: "all", label: `${t("gr_filter_all")} · ${files.length}` },
    { value: "images", label: `${t("gr_vault_tab_photos")} · ${files.filter((file) => getVaultCategory(file) === "images").length}` },
    { value: "audio", label: `${t("gr_vault_tab_audio")} · ${files.filter((file) => getVaultCategory(file) === "audio").length}` },
    { value: "pdf", label: `${t("gr_vault_tab_pdf")} · ${files.filter((file) => getVaultCategory(file) === "pdf").length}` },
    { value: "other", label: `${t("gr_vault_tab_other")} · ${files.filter((file) => getVaultCategory(file) === "other").length}` },
  ];
  const insert = (f: VaultFile) => {
    if (!editor) return;
    const fileCategory = getVaultCategory(f);
    const node = fileCategory === "images" ? { type: "vaultImage", attrs: { vaultId: f.id, alt: f.fileName } }
      : fileCategory === "pdf" ? { type: "vaultPdf", attrs: { vaultId: f.id, fileName: f.fileName } }
      : fileCategory === "audio" ? { type: "vaultAudio", attrs: { vaultId: f.id, fileName: f.fileName } }
      : { type: "text", text: f.fileName, marks: [{ type: "link", attrs: { href: `/vault/download/${encodeURIComponent(f.id)}` } }] };
    editor.chain().focus().insertContent([node, { type: "paragraph" }]).run();
    setEditor(null);
  };
  return (
    <Dialog open={!!editor} onOpenChange={(o) => !o && setEditor(null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{s.pick}</DialogTitle></DialogHeader>
        {!!files.length && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={s.search} className="h-10 pl-9" />
            </div>
            <FilterChips options={filterOptions} value={category} onChange={(value) => setCategory(value as "all" | VaultCategory)} className="mx-0 flex-wrap overflow-visible px-0" />
          </div>
        )}
        <div className="max-h-[55vh] overflow-y-auto">
          {isLoading ? <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            : isError ? (
              <div className="space-y-3 p-8 text-center text-sm text-muted-foreground">
                <p>{s.loadError}</p>
                <button type="button" onClick={() => void refetch()} className="text-foreground underline underline-offset-4">{t("common_tryAgain")}</button>
              </div>
            ) : !files.length ? <p className="p-8 text-center text-sm text-muted-foreground">{s.empty}</p>
              : !filteredFiles.length ? <p className="p-8 text-center text-sm text-muted-foreground">{s.noResults}</p>
                : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {filteredFiles.map((file) => (
                    <button key={file.id} type="button" onClick={() => insert(file)} className="group min-w-0 rounded-xl border border-border/10 p-2 text-left transition-colors hover:border-primary/40 hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <VaultFilePreview file={file} category={getVaultCategory(file)} />
                      <span className="mt-2 block truncate px-1 text-xs font-medium text-foreground/90 group-hover:text-foreground">{file.fileName}</span>
                      <span className="mt-0.5 block px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t(({ images: "gr_vault_tab_photos", audio: "gr_vault_tab_audio", pdf: "gr_vault_tab_pdf", other: "gr_vault_tab_other" } as const)[getVaultCategory(file)])}
                      </span>
                    </button>
                  ))}
                </div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function useDeletionStatus() {
  const { user } = useAuth();
  return useQuery({ queryKey: ["account", "deletion"], queryFn: () => authApi.deletionStatus().then((r) => r.data as { scheduled?: boolean; purgeAt?: string; deletionRequestedAt?: string }), enabled: !!user, staleTime: 60_000 });
}

/** Real usage bars. `alertOnly` renders only a warning card when any limit is >= 80%. */
export function UsageCard({ alertOnly = false }: { alertOnly?: boolean }) {
  const s = useExtrasText();
  const { user } = useAuth();
  const { usage } = useUsage();
  if (!user || !usage) return null;
  const rows = [
    { label: s.notes, used: usage.notesCount, max: user.maxNotes, unit: "" },
    { label: s.entities, used: usage.entitiesCount, max: user.maxEntities, unit: "" },
    { label: s.vault, used: usage.vaultSizeMB, max: user.maxVaultSizeMB, unit: " MB" },
  ].map((r) => ({ ...r, pct: r.max && r.max > 0 ? Math.min(100, Math.round((r.used / r.max) * 100)) : 0, unlimited: !r.max || r.max < 0 }));
  const hot = rows.filter((r) => !r.unlimited && r.pct >= 80).sort((a, b) => b.pct - a.pct)[0];
  if (alertOnly) {
    if (!hot) return null;
    return (
      <a href="/pricing" className="mb-5 block rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
        <p className="text-sm font-medium text-foreground">{s.near}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{s.nearDesc.replace("{x}", hot.label).replace("{p}", String(hot.pct))} · {s.upgrade}</p>
      </a>
    );
  }
  return (
    <div className="space-y-3 rounded-xl border border-border/10 p-4">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex justify-between text-xs text-muted-foreground"><span>{r.label}</span><span className="font-mono">{Math.round(r.used * 10) / 10}{r.unit} / {r.unlimited ? "∞" : `${r.max}${r.unit}`}</span></div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/10">
            <div className={r.pct >= 80 ? "h-full bg-amber-500" : "h-full bg-primary"} style={{ width: `${r.unlimited ? 0 : r.pct}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
