import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterChips } from "@/components/ui/filter-chips";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { trashApi } from "@/lib/api";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "@/lib/heroicons";
import { ArrowUturnLeftIcon, DocumentTextIcon, MagnifyingGlassIcon, PaperClipIcon, TagIcon, TrashIcon } from "@heroicons/react/24/outline";

type Item = { id: string; kind: string; title: string; subtype?: string; deletedAt: string; expiresAt: string };
type Filter = "all" | "notes" | "entities" | "files";
const T = {
  en: { title: "Trash", eyebrow: "Deleted items", sub: "Deleted notes, entities, and files stay here for 30 days.", empty: "Trash is empty.", noResults: "No items match your search.", restore: "Restore", del: "Delete forever", emptyTrash: "Empty trash", emptyConfirm: "Permanently delete every item in your trash? This cannot be undone.", left: "{n} days left", note: "Note", entity: "Entity", file: "File", all: "All", notes: "Notes", entities: "Entities", files: "Files", search: "Search trash", ok: "Restored" },
  es: { title: "Papelera", eyebrow: "Elementos eliminados", sub: "Las notas, entidades y archivos eliminados quedan aquí 30 días.", empty: "La papelera está vacía.", noResults: "Ningún elemento coincide con tu búsqueda.", restore: "Restaurar", del: "Eliminar para siempre", emptyTrash: "Vaciar papelera", emptyConfirm: "¿Eliminar permanentemente todos los elementos de la papelera? Esta acción no se puede deshacer.", left: "Quedan {n} días", note: "Nota", entity: "Entidad", file: "Archivo", all: "Todo", notes: "Notas", entities: "Entidades", files: "Archivos", search: "Buscar en la papelera", ok: "Restaurado" },
  pt: { title: "Lixeira", eyebrow: "Itens excluídos", sub: "Notas, entidades e arquivos excluídos ficam aqui por 30 dias.", empty: "A lixeira está vazia.", noResults: "Nenhum item corresponde à busca.", restore: "Restaurar", del: "Excluir para sempre", emptyTrash: "Esvaziar lixeira", emptyConfirm: "Excluir permanentemente todos os itens da lixeira? Esta ação não pode ser desfeita.", left: "{n} dias restantes", note: "Nota", entity: "Entidade", file: "Arquivo", all: "Tudo", notes: "Notas", entities: "Entidades", files: "Arquivos", search: "Buscar na lixeira", ok: "Restaurado" },
  fr: { title: "Corbeille", eyebrow: "Éléments supprimés", sub: "Les notes, entités et fichiers supprimés restent ici 30 jours.", empty: "La corbeille est vide.", noResults: "Aucun élément ne correspond à votre recherche.", restore: "Restaurer", del: "Supprimer définitivement", emptyTrash: "Vider la corbeille", emptyConfirm: "Supprimer définitivement tous les éléments de la corbeille ? Cette action est irréversible.", left: "{n} jours restants", note: "Note", entity: "Entité", file: "Fichier", all: "Tout", notes: "Notes", entities: "Entités", files: "Fichiers", search: "Rechercher dans la corbeille", ok: "Restauré" },
};

function categoryOf(kind: string): Exclude<Filter, "all"> {
  if (kind.toUpperCase() === "NOTE") return "notes";
  if (kind.toUpperCase() === "ENTITY") return "entities";
  return "files";
}

export default function Trash() {
  const { language } = useLanguage();
  const s = T[(language as keyof typeof T)] ?? T.en;
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [emptyOpen, setEmptyOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["trash"], queryFn: () => trashApi.list().then((r) => r.data as Item[]) });
  const items = data ?? [];
  const counts = useMemo(() => ({
    notes: items.filter((item) => categoryOf(item.kind) === "notes").length,
    entities: items.filter((item) => categoryOf(item.kind) === "entities").length,
    files: items.filter((item) => categoryOf(item.kind) === "files").length,
  }), [items]);
  const filteredItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return items.filter((item) => {
      const category = categoryOf(item.kind);
      const matchesFilter = filter === "all" || filter === category;
      const matchesSearch = !query || `${item.title} ${item.subtype ?? ""} ${item.kind}`.toLocaleLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [filter, items, search]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["trash"] }); qc.invalidateQueries({ queryKey: ["notes"] }); qc.invalidateQueries({ queryKey: ["entities"] }); qc.invalidateQueries({ queryKey: ["vault", "files"] }); };
  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    try { await fn(); if (msg) toast({ title: msg }); } catch (e: any) { toast({ title: e?.response?.data?.message ?? "Error", variant: "destructive" }); }
    refresh();
  };
  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-12 lg:py-16">
        <header className="mb-8 flex items-end justify-between gap-4 border-b border-white/5 pb-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">{s.eyebrow}</p>
            <h1 className="mt-2 font-serif text-4xl tracking-tight text-foreground sm:text-5xl">{s.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{s.sub}</p>
          </div>
          {!!items.length && (
            <Button variant="outline" size="sm" onClick={() => setEmptyOpen(true)} className="shrink-0 rounded-sm border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06] hover:text-red-300">
              <TrashIcon className="mr-2 h-4 w-4" />{s.emptyTrash}
            </Button>
          )}
        </header>

        <div className="mb-5 space-y-3">
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={s.search}
              className="h-12 w-full rounded-2xl bg-accent pl-11 text-[15px] placeholder:italic placeholder:text-muted-foreground"
            />
          </div>
          <FilterChips
            value={filter}
            onChange={(value) => setFilter(value as Filter)}
            options={[
              { value: "all", label: `${s.all} · ${items.length}` },
              { value: "notes", label: `${s.notes} · ${counts.notes}` },
              { value: "entities", label: `${s.entities} · ${counts.entities}` },
              { value: "files", label: `${s.files} · ${counts.files}` },
            ]}
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-24"><Loader2 className="h-5 w-5 animate-spin text-white/30" /></div>
        ) : filteredItems.length === 0 ? (
          <p className="py-16 text-center font-serif text-lg italic text-white/40">
            {items.length === 0 ? s.empty : s.noResults}
          </p>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {filteredItems.map((item) => {
              const category = categoryOf(item.kind);
              const ItemIcon = category === "notes" ? DocumentTextIcon : category === "entities" ? TagIcon : PaperClipIcon;
              const kindLabel = category === "notes" ? s.note : category === "entities" ? s.entity : s.file;
              const days = Math.max(0, Math.ceil((new Date(item.expiresAt).getTime() - Date.now()) / 864e5));
              return (
                <li key={item.id} className="group flex flex-wrap items-center gap-x-3 gap-y-3 py-4 transition-colors hover:bg-white/[0.01] sm:gap-x-4">
                  <ItemIcon className="h-4 w-4 shrink-0 text-white/30" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-serif text-sm text-white/80 transition-colors group-hover:text-white">{item.title || "—"}</p>
                    <p className="mt-0.5 text-[10px] font-mono text-white/35">
                      {kindLabel}{item.subtype ? ` · ${item.subtype}` : ""} · {s.left.replace("{n}", String(days))}
                    </p>
                  </div>
                  <div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto">
                    <Button size="sm" variant="ghost" className="h-8 rounded-sm text-white/50 hover:bg-white/5 hover:text-white" onClick={() => act(() => trashApi.restore(item.id), s.ok)}>
                      <ArrowUturnLeftIcon className="mr-1.5 h-3.5 w-3.5" />{s.restore}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 rounded-sm text-white/40 hover:bg-white/5 hover:text-red-300" onClick={() => act(() => trashApi.purge(item.id))}>
                      <TrashIcon className="mr-1.5 h-3.5 w-3.5" />{s.del}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ConfirmDialog open={emptyOpen} onOpenChange={setEmptyOpen} title={s.emptyTrash} description={s.emptyConfirm} confirmText={s.emptyTrash} destructive onConfirm={async () => { setEmptyOpen(false); await act(() => trashApi.empty()); }} />
    </AppLayout>
  );
}
