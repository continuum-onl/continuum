import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useLanguage } from "@/contexts/LanguageContext";
import AppLayout from "@/components/AppLayout";
import { QuickCapture } from "@/components/QuickCapture";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAllNoteTypes, noteTypesApi, notesApi, vaultApi } from "@/lib/api";
import { usePlanGate } from "@/hooks/usePlanGate";
import { useCachedResource } from "@/hooks/useCachedResource";
import { qk, STALE } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useCreateNote } from "@/hooks/useCreateNote";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import UpgradeModal from "@/components/UpgradeModal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import MarkdownImportDialog from "@/components/import/MarkdownImportDialog";
import {
  Plus,
  Search,
  Loader2,
  Bookmark,
  BookmarkCheck,
  Trash2,
  Upload,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Tag,
} from "@/lib/heroicons";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { InsightSignalBadge } from "@/components/InsightSignal";
import { FilterChips } from "@/components/ui/filter-chips";
import { FitText } from "@/components/ui/fit-text";
import { ListRowContent } from "@/components/ui/list-row-content";
import { StickyNote } from "@/lib/heroicons";
import { FloatingCreateButton } from "@/components/ui/floating-create-button";
import { ListSortMenu, type ListSortMode } from "@/components/ui/list-sort-menu";


import SmoothDrawer from "@/components/ui/smooth-drawer";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useLongPress } from "@/hooks/useLongPress";

interface NoteSummary {
  id: string;
  title: string;
  type?: string;
  folderId?: string;
  createdAt: string;
  updatedAt: string;
  content?: unknown;
  favorite?: boolean;
}

type View = "all" | "favorites" | "recent" | "archived";



const RECENT_WINDOW = 1000 * 60 * 60 * 24 * 7; // 7d
const ARCHIVE_WINDOW = 1000 * 60 * 60 * 24 * 90; // 90d

/* ── Helpers ──────────────────────────────────────────────────────────── */

function extractPreview(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") {
    return content.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  }
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    if ("text" in n && typeof n.text === "string") out.push(n.text);
    if ("content" in n && Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(content);
  return out.join(" ").replace(/\s+/g, " ").trim();
}

function getErrorMessage(error: unknown): string | undefined {
  if (error && typeof error === "object" && "response" in error) {
    const response = error.response;
    if (response && typeof response === "object" && "data" in response) {
      const data = response.data;
      if (data && typeof data === "object") {
        if ("message" in data && typeof data.message === "string") return data.message;
        if ("error" in data && typeof data.error === "string") return data.error;
      }
    }
  }
  return error instanceof Error ? error.message : undefined;
}

function extractSearchSnippet(content: unknown, query: string): string {
  const preview = extractPreview(content);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery || !preview) return preview;

  const matchIndex = preview.toLocaleLowerCase().indexOf(normalizedQuery);
  if (matchIndex < 0) return preview;

  const start = Math.max(0, matchIndex - 45);
  const end = Math.min(preview.length, matchIndex + normalizedQuery.length + 90);
  return `${start > 0 ? "..." : ""}${preview.slice(start, end)}${end < preview.length ? "..." : ""}`;
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(key: string) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString("en-US", { month: "long", year: "numeric" }).toUpperCase();
}

function sortLabels(t: (key: string) => string) {
  return {
    recent: t("list_sort_recent"),
    oldest: t("list_sort_oldest"),
    az: t("list_sort_az"),
    za: t("list_sort_za"),
  };
}

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const day = 86400000;
  if (diff < day) return "today";
  if (diff < day * 2) return "yesterday";
  if (diff < day * 7) return `${Math.floor(diff / day)}d ago`;
  if (diff < day * 30) return `${Math.floor(diff / (day * 7))}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ── Sidebar nav item ─────────────────────────────────────────────────── */

interface NavItemProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}
function NavItem({ label, count, active, onClick }: NavItemProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "group flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-[13px] normal-case transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-muted-foreground"
      )}
      onClick={onClick}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "h-px w-3 transition-all",
            active ? "w-5 bg-foreground" : "bg-foreground/20 group-hover:bg-foreground/40"
          )}
        />
        <span className="truncate">{label}</span>
      </span>
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
        {count}
      </span>
    </Button>
  );
}

/* ── Row with long-press → select ────────────────────────────────────── */
interface NoteRowProps {
  selectMode: boolean;
  selected: boolean;
  onLongPress: () => void;
  onOpen: () => void;
  children: React.ReactNode;
}
function NoteRow({ selectMode, selected, onLongPress, onOpen, children }: NoteRowProps) {
  const press = useLongPress({ onLongPress, onClick: onOpen });
  return (
    <div
      role="button"
      tabIndex={0}
      {...press}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group relative flex w-full cursor-pointer select-none items-start gap-4 py-5 text-left transition-colors hover:bg-foreground/[0.02] focus:outline-none",
        selected && "bg-foreground/[0.04]"
      )}
    >
      {children}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export default function Notes() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { loading: authLoading } = useRequireAuth();
  const { getLimitMessage, refresh, applyUsageDelta } = usePlanGate();
  const { createNote, creating } = useCreateNote({ onLimitReached: () => setUpgradeOpen(true) });

  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [searchContentById, setSearchContentById] = useState<Record<string, unknown>>({});
  const [view, setView] = useState<View>("all");
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<NoteSummary | null>(null);
  const [pendingTypeDelete, setPendingTypeDelete] = useState<string | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(false);
  const [othersChipActive, setOthersChipActive] = useState(false);

  // Multiselect
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkTypeApplying, setBulkTypeApplying] = useState(false);

  // Estados de Ordenação Dinâmica
  const [sortMode, setSortMode] = useState<ListSortMode>("recent");

  // Drag-drop upload to vault
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);

  const indexSwipeStart = useRef<{ x: number; y: number; startedAt: number; excluded: boolean } | null>(null);
  const handleIndexTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    const target = event.target;
    const excluded = target instanceof Element && !!target.closest(
      "input, textarea, select, [contenteditable='true'], [role='dialog'], [data-radix-popper-content-wrapper], [data-filter-chips]",
    );
    indexSwipeStart.current = {
      x: touch.clientX,
      y: touch.clientY,
      startedAt: Date.now(),
      excluded,
    };
  };
  const handleIndexTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = indexSwipeStart.current;
    indexSwipeStart.current = null;
    if (!start || start.excluded || event.changedTouches.length !== 1) return;
    if (!window.matchMedia("(max-width: 1023px)").matches) return;

    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const horizontalDistance = Math.abs(dx);
    const dy = Math.abs(touch.clientY - start.y);
    if (horizontalDistance >= 60 && dy <= horizontalDistance * 0.75 && Date.now() - start.startedAt <= 1000) {
      setFilterDrawerOpen(true);
    }
  };

  /* Load — cached first, revalidated in background */
  const notesQuery = useCachedResource<NoteSummary[]>(
    qk.notes(),
    async () => {
      const res = await notesApi.list();
      return Array.isArray(res.data) ? res.data : [];
    },
    { staleTime: STALE.list, refetchInterval: 15_000, refetchOnMount: "always" }
  );
  const typesQuery = useCachedResource<string[]>(
    qk.noteTypes(),
    getAllNoteTypes,
    { staleTime: STALE.list, refetchOnMount: "always" }
  );
  const loading =
    notesQuery.loading ||
    (notesQuery.data !== undefined && notes.length === 0 && notesQuery.data.length > 0);

  useEffect(() => {
    if (notesQuery.data) {
      setNotes(notesQuery.data);
      void queryClient.invalidateQueries({ queryKey: ["notes", "detail"] });
    }
  }, [notesQuery.data]);
  useEffect(() => {
    if (typesQuery.data) setTypes(typesQuery.data);
  }, [typesQuery.data]);

  // Note summaries intentionally omit content. Load uncached details only when
  // the user searches so mobile and desktop can search the complete note text.
  useEffect(() => {
    const query = search.trim().toLocaleLowerCase();
    if (query.length < 2 || notes.length === 0) {
      setSearchContentById({});
      return;
    }

    let cancelled = false;
    setSearchContentById({});
    const timer = window.setTimeout(async () => {
      const uncached = notes.filter((note) => {
        const detail = queryClient.getQueryData<{ content?: unknown }>(qk.note(note.id));
        if (!detail || !Object.prototype.hasOwnProperty.call(detail, "content")) return true;
        if (!cancelled) setSearchContentById((previous) => ({ ...previous, [note.id]: detail.content }));
        return false;
      });

      await Promise.allSettled(uncached.map(async (note) => {
        const response = await notesApi.get(note.id);
        queryClient.setQueryData(qk.note(note.id), response.data);
        if (!cancelled) setSearchContentById((previous) => ({ ...previous, [note.id]: response.data?.content }));
      }));
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, notes]);

  const fetchData = async () => {
    await Promise.all([notesQuery.refetch(), typesQuery.refetch()]);
  };

  /* Mutations */
  const toggleFavorite = async (noteId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, favorite: !n.favorite } : n)));
    try {
      const { data } = await notesApi.toggleFavorite(noteId);
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, favorite: !!data.favorite } : n))
      );
      notesQuery.setData((prev) => (prev ?? []).map((n) => (n.id === noteId ? { ...n, favorite: !!data.favorite } : n)));
    } catch {
      setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, favorite: !n.favorite } : n)));
      toast({ title: t("ls_notes_error_favorite"), variant: "destructive" });
    }
  };

  const handleCreate = () => {
    void createNote();
  };

  const createNoteType = async () => {
    const name = window.prompt(t("notes_new_type_prompt"));
    const cleanName = name?.trim();
    if (!cleanName) return;

    try {
      const { data } = await noteTypesApi.create(cleanName);
      const nextTypes = [...new Set([...types, data.name])].sort((a, b) => a.localeCompare(b));
      setTypes(nextTypes);
      typesQuery.setData(nextTypes);
      toast({ title: t("notes_type_created", { type: data.name }) });
    } catch (error) {
      console.error("[Notes] type creation failed", error);
      toast({ title: t("notes_type_create_failed"), variant: "destructive" });
    }
  };

  const confirmDeleteType = async () => {
    if (!pendingTypeDelete) return;
    const type = pendingTypeDelete;
    try {
      await noteTypesApi.delete(type);
      const nextTypes = types.filter((item) => item !== type);
      const updatedAt = new Date().toISOString();
      const nextNotes = notes.map((note) => note.type === type ? { ...note, type: undefined, updatedAt } : note);
      setTypes(nextTypes);
      typesQuery.setData(nextTypes);
      setNotes(nextNotes);
      notesQuery.setData(nextNotes);
      notes.filter((note) => note.type === type).forEach((note) => {
        queryClient.setQueryData<{ type?: string }>(qk.note(note.id), (detail) =>
          detail ? { ...detail, type: undefined } : detail
        );
      });
      if (selectedType === type) setSelectedType(null);
      setPendingTypeDelete(null);
      toast({ title: t("notes_type_deleted", { type }) });
    } catch (error) {
      console.error("[Notes] type deletion failed", error);
      toast({ title: t("notes_type_delete_failed"), variant: "destructive" });
    }
  };


  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const deletedNote = pendingDelete;
    setNotes((prev) => prev.filter((n) => n.id !== deletedNote.id));
    notesQuery.setData((prev) => (prev ?? []).filter((n) => n.id !== deletedNote.id));
    try {
      await notesApi.delete(deletedNote.id);
      await queryClient.invalidateQueries({ queryKey: ["trash"] });
      applyUsageDelta({ notesCount: -1 });
      void refresh();
    } catch {
      setNotes((prev) => [deletedNote, ...prev]);
      notesQuery.setData((prev) => [deletedNote, ...(prev ?? [])]);
      toast({ title: t("ls_notes_error_deleting"), variant: "destructive" });
    } finally {
      setPendingDelete(null);
    }
  };

  /* Multiselect */
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (selectMode && selectedIds.size === 0) {
      setSelectMode(false);
    }
  }, [selectMode, selectedIds]);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const confirmBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const deletedNotes = notes.filter((note) => selectedIds.has(note.id));
    setNotes((prev) => prev.filter((n) => !selectedIds.has(n.id)));
    notesQuery.setData((prev) => (prev ?? []).filter((n) => !selectedIds.has(n.id)));
    setBulkDeleting(true);
    try {
      await Promise.all(ids.map((id) => notesApi.delete(id)));
      await queryClient.invalidateQueries({ queryKey: ["trash"] });
      applyUsageDelta({ notesCount: -ids.length });
      void refresh();
      toast({ title: t(ids.length === 1 ? "notes_bulk_removed_one" : "notes_bulk_removed", { n: ids.length }) || `${ids.length} removed` });
      exitSelectMode();
    } catch {
      setNotes((prev) => [...deletedNotes, ...prev]);
      notesQuery.setData((prev) => [...deletedNotes, ...(prev ?? [])]);
      toast({ title: t("ls_notes_error_deleting_entries"), variant: "destructive" });
    } finally {
      setBulkDeleting(false);
      setBulkDeleteOpen(false);
    }
  };

  const applyBulkType = async (newType: string) => {
    const ids = Array.from(selectedIds);
    const clean = (newType || "").trim();
    if (ids.length === 0 || !clean || bulkTypeApplying) return;
    const idSet = new Set(ids);
    const previousNotes = notes;
    setBulkTypeApplying(true);
    setNotes((prev) => prev.map((n) => (idSet.has(n.id) ? { ...n, type: clean } : n)));
    setTypes((prev) => (prev.includes(clean) ? prev : [...prev, clean].sort((a, b) => a.localeCompare(b))));
    try {
      await notesApi.bulkUpdateType(ids, clean);
      notesQuery.setData((prev) => (prev ?? []).map((n) => (idSet.has(n.id) ? { ...n, type: clean } : n)));
      typesQuery.setData((prev) => (prev ?? []).includes(clean) ? (prev ?? []) : [...(prev ?? []), clean].sort((a, b) => a.localeCompare(b)));
      toast({ title: t("notes_bulk_type_applied", { n: ids.length }) || `${ids.length} updated` });
      exitSelectMode();
      void fetchData();
    } catch (e) {
      console.error("[Notes] bulk type error", e);
      setNotes(previousNotes);
      const details = getErrorMessage(e);
      toast({ title: t("ls_notes_error_updating_type"), description: details || t("ls_notes_error_updating_type_desc"), variant: "destructive" });
      void fetchData();
    } finally {
      setBulkTypeApplying(false);
    }
  };



  /* Filter + group */
  const counts = useMemo(() => {
    const now = Date.now();
    return {
      all: notes.length,
      favorites: notes.filter((n) => n.favorite).length,
      recent: notes.filter((n) => now - new Date(n.updatedAt).getTime() < RECENT_WINDOW).length,
      archived: notes.filter((n) => now - new Date(n.updatedAt).getTime() > ARCHIVE_WINDOW).length,
      byType: types.reduce<Record<string, number>>((acc, t) => {
        acc[t] = notes.filter((n) => n.type === t).length;
        return acc;
      }, {}),
    };
  }, [notes, types]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const q = search.trim().toLowerCase();
    return notes
      .filter((n) => {
        if (selectedType && n.type !== selectedType) return false;
        const age = now - new Date(n.updatedAt).getTime();
        if (view === "favorites" && !n.favorite) return false;
        if (view === "recent" && age >= RECENT_WINDOW) return false;
        if (view === "archived" && age <= ARCHIVE_WINDOW) return false;
        if (q) {
          const cachedDetail = queryClient.getQueryData<{ content?: unknown }>(qk.note(n.id));
          const content = n.content ?? searchContentById[n.id] ?? cachedDetail?.content;
          const hay = `${n.title} ${extractPreview(content)}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortMode === "az" || sortMode === "za") {
          const order = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
          return sortMode === "az" ? order : -order;
        }
        const dateA = new Date(a.updatedAt).getTime();
        const dateB = new Date(b.updatedAt).getTime();
        return sortMode === "recent" ? dateB - dateA : dateA - dateB;
      });
  }, [notes, view, selectedType, search, sortMode, searchContentById]);

  const grouped = useMemo(() => {
    if (sortMode === "az" || sortMode === "za") {
      return filtered.length ? [[sortMode, filtered] as const] : [];
    }
    const map = new Map<string, NoteSummary[]>();
    for (const n of filtered) {
      const key = monthKey(new Date(n.updatedAt));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    }
    return Array.from(map.entries());
  }, [filtered, sortMode]);

  const toggleMonth = (key: string) => {
    setCollapsedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /* Drag-drop */
  const handleFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await vaultApi.upload(form);
      toast({ title: t("ls_notes_sent_to_vault"), description: file.name });
    } catch {
      toast({ title: t("ls_notes_upload_failed"), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };
  const dragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
  };
  const dragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  if (authLoading) {
    return (
      <AppLayout>
        <div className="mx-auto w-full max-w-5xl animate-fade-in px-4 py-8 sm:px-6">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-4 h-9 w-56" />
          <div className="mt-8 space-y-3">
            {Array.from({ length: 7 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  const limitMsg = getLimitMessage("notes");
  const viewLabel =
    view === "all"
      ? t("notes_view_archive")
      : view === "favorites"
        ? t("notes_view_favorites")
        : view === "recent"
          ? t("notes_view_recent")
          : t("notes_view_dormant");

  const SidebarContent = (
    <div className="border-t border-border/15 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">{t("notes_types")}</p>
        <Button
          type="button"
          variant="ghost"
          size="iconSm"
          aria-label={t("notes_create_type")}
          title={t("notes_create_type")}
          onClick={() => void createNoteType()}
          className="h-7 w-7 text-muted-foreground/70 hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="divide-y divide-border/10">
        <button
          type="button"
          onClick={() => setSelectedType(null)}
          className={cn(
            "group flex w-full items-center justify-between border-l-2 px-3 py-3 text-left text-[13px] transition-colors",
            !selectedType
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <span>{t("notes_allTypes")}</span>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{counts.all}</span>
        </button>
        {types.map((tp) => (
          <div key={tp} className="group flex items-center border-b border-border/10 last:border-0">
            <button
              type="button"
              onClick={() => setSelectedType(tp)}
              className={cn(
                "flex min-w-0 flex-1 items-center justify-between border-l-2 px-3 py-3 text-left text-[13px] transition-colors",
                selectedType === tp
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="truncate">{tp}</span>
              <span className="ml-3 font-mono text-[10px] tabular-nums text-muted-foreground">{counts.byType[tp] || 0}</span>
            </button>
            <Button
              type="button"
              variant="ghost"
              size="iconSm"
              aria-label={t("notes_delete_type", { type: tp })}
              title={t("notes_delete_type", { type: tp })}
              onClick={() => setPendingTypeDelete(tp)}
              className="mr-1 h-7 w-7 shrink-0 text-muted-foreground/50 opacity-100 transition-opacity hover:text-destructive focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );

  const DrawerFilterContent = (
    <div className="space-y-7">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">{t("notes_types")}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("notes_create_type")}
            title={t("notes_create_type")}
            onClick={() => void createNoteType()}
            className="h-9 w-9 text-muted-foreground/70 hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-0.5">
          <NavItem
            label={t("notes_allTypes")}
            count={counts.all}
            active={!selectedType}
            onClick={() => { setSelectedType(null); setFilterDrawerOpen(false); }}
          />
          {types.map((tp) => (
            <div key={tp} className="group flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <NavItem
                  label={tp}
                  count={counts.byType[tp] || 0}
                  active={selectedType === tp}
                  onClick={() => { setSelectedType(tp); setFilterDrawerOpen(false); }}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("notes_delete_type", { type: tp })}
                title={t("notes_delete_type", { type: tp })}
                onClick={() => setPendingTypeDelete(tp)}
                className="h-9 w-9 shrink-0 text-muted-foreground/60 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <AppLayout>
      <div
        className="relative min-h-full"
        onDragEnter={dragOver}
        onDragOver={dragOver}
        onDragLeave={dragLeave}
        onDrop={handleFileDrop}
        onTouchStart={handleIndexTouchStart}
        onTouchEnd={handleIndexTouchEnd}
      >
        {dragActive && (
          <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="rounded-md border border-dashed border-border/30 px-10 py-8 text-center">
              <Upload className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t("notes_dropToVault")}</p>
            </div>
          </div>
        )}
        {uploading && (
          <div className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-md border border-border/10 bg-background/90 px-3 py-2 text-[11px] text-muted-foreground backdrop-blur-xl">
            <Loader2 className="h-3 w-3 animate-spin" /> {t("notes_uploading")}
          </div>
        )}

        {/* Mobile filter drawer */}
        <SmoothDrawer
          title={t("notes_filters")}
          open={filterDrawerOpen}
          onOpenChange={(open) => {
            setFilterDrawerOpen(open);
            if (!open) setOthersChipActive(false);
          }}
        >
          <div className="px-6 pb-6 pt-4" onTouchStart={(event) => event.stopPropagation()}>
            {DrawerFilterContent}
          </div>
        </SmoothDrawer>

        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-5 lg:flex-row lg:items-start lg:gap-14 lg:px-12 lg:py-10">
          {/* ─── Main ────────────────────────────────────────────── */}
          <motion.main layout="position" transition={{ layout: { type: "spring", stiffness: 280, damping: 30 } }} className="min-w-0 flex-1">
            {/* Header (desktop) */}
            <header className="mb-8 hidden lg:block">
              <div className="flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">{viewLabel}</p>
                  <h1 className="mt-2 font-serif text-5xl tracking-tight text-foreground">{t("notes_title")}</h1>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    onClick={handleCreate}
                    className="h-auto gap-2 rounded-full bg-foreground px-6 py-3 text-[15px] font-medium text-background shadow-[0_10px_30px_rgba(0,0,0,0.45)] transition active:scale-95 hover:bg-foreground disabled:opacity-60"
                    disabled={creating}
                  >
                    <Plus className="h-4 w-4" /> {creating ? t("notes_creating") : t("notes_new")}
                  </Button>
                </div>

              </div>
              {limitMsg && <p className="mt-3 text-xs text-muted-foreground">{limitMsg}</p>}
            </header>

            {/* Mobile: search + view chips */}
            <div className={selectMode ? "hidden lg:mb-5 lg:block lg:space-y-3" : "mb-5 space-y-3"}>
                <div className="flex items-center gap-2">
                  <div className="relative z-0 flex-1">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t("notes_searchAmong", { n: counts.all }) || `Search among ${counts.all} notes…`}
                      className="h-12 w-full rounded-2xl bg-accent pl-11 text-[15px] placeholder:italic placeholder:text-muted-foreground"
                    />
                  </div>
                  <ListSortMenu className="lg:h-12 lg:w-12 lg:rounded-2xl" value={sortMode} onValueChange={setSortMode} labels={sortLabels(t)} />
                </div>
              <div
                data-filter-chips
                onTouchStart={(event) => {
                  indexSwipeStart.current = null;
                  event.stopPropagation();
                }}
                onTouchEnd={(event) => {
                  indexSwipeStart.current = null;
                  event.stopPropagation();
                }}
                onTouchCancel={(event) => {
                  indexSwipeStart.current = null;
                  event.stopPropagation();
                }}
              >
                <FilterChips
                  value={othersChipActive || desktopSidebarOpen ? "others" : view}
                  onChange={(v) => {
                    if (v === "others") {
                      if (window.matchMedia("(min-width: 1024px)").matches) {
                        setDesktopSidebarOpen((open) => !open);
                      } else {
                        setOthersChipActive(true);
                        setFilterDrawerOpen(true);
                      }
                      return;
                    }
                    setOthersChipActive(false);
                    setView(v as View);
                  }}
                  options={[
                    { value: "all", label: t("notes_archive") },
                    { value: "recent", label: t("notes_recent") },
                    { value: "favorites", label: t("notes_favorites") },
                    { value: "archived", label: t("notes_dormant") },
                    { value: "others", label: t("notes_others") },
                  ]}
                />
              </div>
            </div>

            {/* Selection action bar */}
            {selectMode && (
              <div className="fixed inset-x-0 top-0 z-50 flex flex-col items-stretch gap-3 rounded-b-3xl border border-t-0 border-border/10 bg-background/95 px-6 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] shadow-2xl backdrop-blur-xl lg:sticky lg:inset-auto lg:top-[7.5rem] lg:z-20 lg:mb-6 lg:flex-row lg:items-center lg:justify-between lg:rounded-sm lg:bg-background/80 lg:px-3 lg:py-2.5 lg:shadow-none">
                <span className="text-sm text-muted-foreground">
                  {t("select_selected", { n: selectedIds.size })}
                </span>
                <div className="grid w-full min-w-0 grid-cols-2 gap-2 lg:flex lg:w-auto lg:flex-wrap">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-center normal-case px-3 py-1.5 text-xs text-muted-foreground hover:border-border/40 hover:text-foreground lg:w-auto"
                    onClick={() => {
                      const allIds = filtered.map((n) => n.id);
                      const allSelected = allIds.every((id) => selectedIds.has(id));
                      setSelectedIds(allSelected ? new Set() : new Set(allIds));
                    }}
                  >
                    {filtered.length > 0 && filtered.every((n) => selectedIds.has(n.id)) ? t("select_clearAll") : t("select_all")}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={selectedIds.size === 0 || bulkTypeApplying}
                        className="w-full justify-center normal-case inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground lg:w-auto"
                      >
                        {bulkTypeApplying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Tag className="h-3.5 w-3.5" />} {t("notes_set_type") || "Set type"}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[180px]">
                      {types.map((tp) => (
                        <DropdownMenuItem key={tp} onSelect={() => applyBulkType(tp)}>
                          {tp}
                        </DropdownMenuItem>
                      ))}
                      {types.length > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuItem
                        onSelect={() => {
                          const v = window.prompt(t("notes_new_type_prompt") || "New type name");
                          if (v && v.trim()) applyBulkType(v.trim());
                        }}
                      >
                        {t("notes_new_type") || "New type…"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="w-full justify-center normal-case inline-flex items-center gap-1.5 px-3 py-1.5 text-xs lg:w-auto"
                    onClick={() => setBulkDeleteOpen(true)}
                    disabled={selectedIds.size === 0}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> {t("common_delete")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-center normal-case inline-flex items-center gap-1.5 px-3 py-1.5 text-xs lg:w-auto"
                    onClick={exitSelectMode}
                  >
                    <X className="h-3.5 w-3.5" /> {t("select_done")}
                  </Button>
                </div>
              </div>
            )}
            {selectMode && <div aria-hidden="true" className="h-[calc(9rem+env(safe-area-inset-top))] lg:hidden" />}

            {/* Content */}

            {loading ? (
              <div className="space-y-3 py-6">
                {Array.from({ length: 8 }).map((_, index) => (
                  <Skeleton key={index} className="h-14 w-full" />
                ))}
              </div>
            ) : grouped.length === 0 ? (
              <div className="py-24 text-center">
                <p className="font-serif text-2xl italic text-muted-foreground">
                  {search
                    ? t("notes_empty_search")
                    : view === "favorites"
                      ? t("notes_empty_favorites")
                      : view === "recent"
                        ? t("notes_empty_recent")
                        : view === "archived"
                          ? t("notes_empty_archived")
                          : t("notes_empty_all")}
                </p>
                {!search && view === "all" && (
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-sm">
                    <Button
                      type="button"
                      variant="link"
                      className="gap-1.5 normal-case text-muted-foreground hover:text-foreground"
                      onClick={handleCreate}
                      disabled={creating}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {creating ? t("notes_creating") : t("notes_createFirst")}
                    </Button>
                    <span className="text-muted-foreground">{t("notes_empty_or")}</span>
                    <Button
                      type="button"
                      variant="link"
                      className="gap-1.5 normal-case text-muted-foreground hover:text-foreground"
                      onClick={() => setImportOpen(true)}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {t("notes_importBtn")}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-12">
                {grouped.map(([key, items]) => {
                  const collapsed = collapsedMonths.has(key);
                  return (
                    <section key={key}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="group mb-5 flex w-full items-center justify-between border-b border-border/10 pb-2 text-left normal-case"
                        onClick={() => toggleMonth(key)}
                      >
                        <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.32em] text-muted-foreground group-hover:text-muted-foreground">
                          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          {key === "az" || key === "za"
                            ? t(key === "az" ? "list_sort_az" : "list_sort_za")
                            : formatMonth(key)}
                        </span>
                        {key !== "az" && key !== "za" && (
                          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                            {items.length}
                          </span>
                        )}
                      </Button>

                      {!collapsed && (
                        <ul className="divide-y divide-border/10">
                          {items.map((note) => {
                            const activeSearch = search.trim();
                            const noteContent = activeSearch
                              ? note.content
                                ?? searchContentById[note.id]
                                ?? queryClient.getQueryData<{ content?: unknown }>(qk.note(note.id))?.content
                              : undefined;
                            const preview = activeSearch ? extractSearchSnippet(noteContent, activeSearch) : "";
                            const targetDate = note.updatedAt;

                            const selected = selectedIds.has(note.id);
                            return (
                              <NoteRow
                                key={note.id}
                                selectMode={selectMode}
                                selected={selected}
                                onLongPress={() => { setSelectMode(true); toggleSelect(note.id); }}
                                onOpen={() => selectMode ? toggleSelect(note.id) : navigate(`/notes/${note.id}`)}
                              >
                                  <span
                                    aria-hidden
                                    className="absolute left-0 top-1/2 h-8 w-px -translate-x-3 -translate-y-1/2 bg-foreground opacity-0 transition-opacity group-hover:opacity-100"
                                  />

                                  <ListRowContent
                                    icon={<StickyNote className="h-5 w-5" />}
                                    title={note.title || t("notes_untitled")}
                                    className={cn(activeSearch && "items-start")}
                                    metaClassName={cn(
                                      activeSearch && "whitespace-normal leading-relaxed line-clamp-3"
                                    )}
                                    meta={activeSearch ? (
                                      <>
                                        {note.type ? `${note.type} · ` : ""}
                                        {relativeDate(targetDate)}
                                        {preview ? " · " : ""}
                                        {preview}
                                      </>
                                    ) : (
                                      <>{note.type ? `${note.type} · ` : ""}{relativeDate(targetDate)}</>
                                    )}
                                  />

                                  <div className="flex w-[76px] shrink-0 items-center justify-end gap-2 pt-1">
                                    {selectMode ? (
                                      <span
                                        className={cn(
                                          "grid h-5 w-5 place-items-center rounded-sm border transition-colors",
                                          selected ? "border-border/10 bg-foreground text-background" : "border-border/30 text-transparent"
                                        )}
                                      >
                                        <Check className="h-3.5 w-3.5" />
                                      </span>
                                    ) : (
                                      <>
                                        <span className="flex h-5 w-5 items-center justify-center">
                                          <InsightSignalBadge kind="note" id={note.id} className="h-5 w-5" />
                                        </span>
                                        <span className="flex h-5 w-5 items-center justify-center">
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="iconSm"
                                            className={cn(
                                              "h-5 w-5 rounded-full p-0 opacity-70 transition-colors hover:opacity-100",
                                              note.favorite ? "text-foreground" : "text-foreground"
                                            )}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              toggleFavorite(note.id, e);
                                            }}
                                            aria-label={note.favorite ? t("notes_unfavorite") : t("notes_favorite")}
                                          >
                                            {note.favorite ? (
                                              <BookmarkCheck className="h-3 w-3 fill-current" />
                                            ) : (
                                              <Bookmark className="h-3 w-3" />
                                            )}
                                          </Button>
                                        </span>
                                        <span className="flex h-5 w-5 items-center justify-center">
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="iconSm"
                                            className="h-5 w-5 rounded-full p-0 text-foreground opacity-70 transition hover:opacity-100"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              e.preventDefault();
                                              setPendingDelete(note);
                                            }}
                                            aria-label={t("common_delete")}
                                          >
                                            <Trash2 className="h-3 w-3" />
                                          </Button>
                                        </span>
                                      </>
                                    )}
                                  </div>
                              </NoteRow>
                            );
                          })}
                        </ul>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </motion.main>
          <AnimatePresence initial={false}>
            {desktopSidebarOpen && (
              <motion.aside
                id="notes-desktop-filters"
                aria-label={t("notes_filters")}
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 18 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="hidden w-64 shrink-0 lg:sticky lg:top-10 lg:block lg:self-start"
              >
                {SidebarContent}
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      </div>

      <FloatingCreateButton
        label={creating ? t("notes_creating") : t("notes_new")}
        disabled={creating}
        onClick={handleCreate}
        onLongPress={() => setQuickCaptureOpen(true)}
        icon={<Plus className="h-4 w-4" />}
      />
      <QuickCapture open={quickCaptureOpen} onOpenChange={setQuickCaptureOpen} showTrigger={false} />

      <UpgradeModal open={upgradeOpen} onOpenChange={setUpgradeOpen} reason={t("notes_limit")} />

      <MarkdownImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => { void fetchData(); }}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={t("notes_remove_one_title")}
        description={
          pendingDelete
            ? t("notes_remove_one_desc", { title: pendingDelete.title || t("notes_untitled") })
            : t("ls_notes_action_cannot_be_undone")
        }
        confirmText={t("notes_remove")}
        destructive
        onConfirm={confirmDelete}
      />
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => !open && !bulkDeleting && setBulkDeleteOpen(false)}
        title={t(selectedIds.size === 1 ? "notes_remove_many_title_one" : "notes_remove_many_title", { n: selectedIds.size })}
        description={t("notes_remove_many_desc")}
        confirmText={bulkDeleting ? t("notes_removing") : t("notes_remove")}
        destructive
        onConfirm={confirmBulkDelete}
      />
      <ConfirmDialog
        open={pendingTypeDelete !== null}
        onOpenChange={(open) => !open && setPendingTypeDelete(null)}
        title={t("notes_delete_type_title")}
        description={t("notes_delete_type_desc", { type: pendingTypeDelete ?? "" })}
        confirmText={t("notes_remove")}
        destructive
        onConfirm={confirmDeleteType}
      />
    </AppLayout>
  );
}
