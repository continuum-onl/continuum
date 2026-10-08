import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { entitiesApi } from "@/lib/api";
import { usePlanGate } from "@/hooks/usePlanGate";
import { useCachedResource } from "@/hooks/useCachedResource";
import { qk, STALE } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import UpgradeModal from "@/components/UpgradeModal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CreateEntityDialog } from "@/components/CreateEntityDialog";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  Plus,
  Search,
  Loader2,
  Bookmark,
  BookmarkCheck,
  Trash2,
  SlidersHorizontal,
  Check,
  X,
} from "@/lib/heroicons";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { FilterChips } from "@/components/ui/filter-chips";
import { FitText } from "@/components/ui/fit-text";
import { ListRowContent } from "@/components/ui/list-row-content";
import { EntityTypeIcon } from "@/components/ui/entity-type-icon";
import { FloatingCreateButton } from "@/components/ui/floating-create-button";
import { ListSortMenu, type ListSortMode } from "@/components/ui/list-sort-menu";
import { InsightSignalBadge } from "@/components/InsightSignal";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useLongPress } from "@/hooks/useLongPress";
import type { EntityType } from "@/types";

interface Entity {
  id: string;
  title: string;
  type: EntityType;
  description?: string;
  createdAt: string;
  updatedAt?: string; // Adicionado para suportar ordenação por modificação
  trackingDates?: string[];
  favorite?: boolean;
}

const typeLabels: Record<string, string> = {
  PERSON: "Person",
  PROJECT: "Project",
  TOPIC: "Topic",
  ORGANIZATION: "Organization",
  ACTIVITY: "Activity",
};

const types = ["PERSON", "PROJECT", "TOPIC", "ORGANIZATION", "ACTIVITY"];

/* ── Helpers ──────────────────────────────────────────────────────────── */

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
            active ? "bg-foreground w-5" : "bg-foreground/20 group-hover:bg-foreground/40"
          )}
        />
        {label}
      </span>
      <span className={cn("font-mono text-[10px] tabular-nums", active ? "text-muted-foreground" : "text-muted-foreground")}>
        {count}
      </span>
    </Button>
  );
}

/* ── Row with long-press → select ────────────────────────────────────── */
interface EntityRowProps {
  selectMode: boolean;
  selected: boolean;
  onLongPress: () => void;
  onOpen: () => void;
  children: React.ReactNode;
}
function EntityRow({ selectMode, selected, onLongPress, onOpen, children }: EntityRowProps) {
  const press = useLongPress({ onLongPress, onClick: onOpen });
  return (
    <li>
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
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-8 w-px -translate-x-3 -translate-y-1/2 bg-foreground opacity-0 transition-opacity group-hover:opacity-100"
        />
        {children}
      </div>
    </li>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export default function Entities() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { refresh: refreshUsage, applyUsageDelta } = usePlanGate();

  const [entities, setEntities] = useState<Entity[]>([]);
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState<string | null>(null);
  
  // Estados de Ordenação
  const [sortMode, setSortMode] = useState<ListSortMode>("recent");
  
  const [createOpen, setCreateOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [pendingDeleteEntity, setPendingDeleteEntity] = useState<Entity | null>(null);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  // Multiselect
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  /* Carregar Dados — cache primeiro, revalida em segundo plano */
  const entitiesQuery = useCachedResource<Entity[]>(
    qk.entities(),
    async () => {
      const res = await entitiesApi.list();
      return Array.isArray(res.data) ? (res.data as Entity[]) : [];
    },
    { staleTime: STALE.list, refetchOnMount: "always" }
  );
  const loading =
    entitiesQuery.loading ||
    (entitiesQuery.data !== undefined && entities.length === 0 && entitiesQuery.data.length > 0);

  useEffect(() => {
    if (entitiesQuery.data) setEntities(entitiesQuery.data);
  }, [entitiesQuery.data]);

  /* Deletar */
  const handleDelete = (e: React.MouseEvent, entity: Entity) => {
    e.stopPropagation();
    setPendingDeleteEntity(entity);
  };

  const toggleFavorite = async (entity: Entity, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const previousFavorite = !!entity.favorite;
    const favorite = !previousFavorite;
    const updateFavorite = (items: Entity[]) =>
      items.map((item) => (item.id === entity.id ? { ...item, favorite } : item));
    setEntities(updateFavorite);
    entitiesQuery.setData((prev) => updateFavorite(prev ?? []));
    try {
      const { data } = await entitiesApi.toggleFavorite(entity.id);
      const persistedFavorite = !!data.favorite;
      setEntities((prev) => prev.map((item) => item.id === entity.id ? { ...item, favorite: persistedFavorite } : item));
      entitiesQuery.setData((prev) =>
        (prev ?? []).map((item) => item.id === entity.id ? { ...item, favorite: persistedFavorite } : item)
      );
    } catch {
      setEntities((prev) => prev.map((item) => item.id === entity.id ? { ...item, favorite: previousFavorite } : item));
      entitiesQuery.setData((prev) =>
        (prev ?? []).map((item) => item.id === entity.id ? { ...item, favorite: previousFavorite } : item)
      );
      toast({ title: t("ls_entities_error_favorite"), variant: "destructive" });
    }
  };

  const confirmDelete = async () => {
    if (!pendingDeleteEntity) return;
    const deletedEntity = pendingDeleteEntity;
    setEntities((prev) => prev.filter((x) => x.id !== deletedEntity.id));
    entitiesQuery.setData((prev) => (prev ?? []).filter((x) => x.id !== deletedEntity.id));
    try {
      await entitiesApi.delete(deletedEntity.id);
      await queryClient.invalidateQueries({ queryKey: ["trash"] });
      applyUsageDelta({ entitiesCount: -1, activitiesCount: deletedEntity.type === "ACTIVITY" ? -1 : 0 });
      void refreshUsage();
    } catch {
      setEntities((prev) => [deletedEntity, ...prev]);
      entitiesQuery.setData((prev) => [deletedEntity, ...(prev ?? [])]);
      toast({ title: t("ls_entities_error_deleting"), variant: "destructive" });
    } finally {
      setPendingDeleteEntity(null);
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
    const targets = entities.filter((e) => selectedIds.has(e.id));
    if (targets.length === 0) return;
    setEntities((prev) => prev.filter((e) => !selectedIds.has(e.id)));
    entitiesQuery.setData((prev) => (prev ?? []).filter((e) => !selectedIds.has(e.id)));
    setBulkDeleting(true);
    try {
      await Promise.all(targets.map((e) => entitiesApi.delete(e.id)));
      await queryClient.invalidateQueries({ queryKey: ["trash"] });
      const activities = targets.filter((e) => e.type === "ACTIVITY").length;
      applyUsageDelta({ entitiesCount: -targets.length, activitiesCount: -activities });
      void refreshUsage();
      toast({ title: t(targets.length === 1 ? "entities_countRemoved_one" : "entities_countRemoved", { n: targets.length }) });
      exitSelectMode();
    } catch {
      setEntities((prev) => [...targets, ...prev]);
      entitiesQuery.setData((prev) => [...targets, ...(prev ?? [])]);
      toast({ title: t("ls_entities_error_deleting_many"), variant: "destructive" });
    } finally {
      setBulkDeleting(false);
      setBulkDeleteOpen(false);
    }
  };



  /* Contadores da Barra Lateral */
  const counts = useMemo(() => {
    return {
      all: entities.length,
      byType: types.reduce<Record<string, number>>((acc, t) => {
        acc[t] = entities.filter((e) => e.type === t).length;
        return acc;
      }, {}),
    };
  }, [entities]);

  /* Filtragem e Ordenação Dinâmica */
  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entities
      .filter((e) => {
        if (selectedType && e.type !== selectedType) return false;
        if (q) {
          const hay = `${e.title} ${e.description || ""} ${typeLabels[e.type] || ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortMode === "az" || sortMode === "za") {
          const order = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
          return sortMode === "az" ? order : -order;
        }
        const dateA = new Date(a.updatedAt || a.createdAt).getTime();
        const dateB = new Date(b.updatedAt || b.createdAt).getTime();
        return sortMode === "recent" ? dateB - dateA : dateA - dateB;
      });
  }, [entities, selectedType, search, sortMode]);

  const sortLabels = {
    recent: t("list_sort_recent"),
    oldest: t("list_sort_oldest"),
    az: t("list_sort_az"),
    za: t("list_sort_za"),
  };

  const SidebarContent = (
    <div className="space-y-7">
      <div>
        <p className="mb-3 text-[10px] uppercase tracking-[0.32em] text-muted-foreground">{t("notes_index")}</p>
        <div className="space-y-0.5">
          <NavItem
            label={t("entities_all")}
            count={counts.all}
            active={!selectedType}
            onClick={() => { setSelectedType(null); setFilterDrawerOpen(false); }}
          />
        </div>
      </div>

      <div>
        <p className="mb-3 text-[10px] uppercase tracking-[0.32em] text-muted-foreground">{t("notes_types")}</p>
        <div className="space-y-0.5">
          {types.map((tp) => (
            <NavItem
              key={tp}
              label={t(`entities_type_${tp}`) ?? typeLabels[tp]}
              count={counts.byType[tp] || 0}
              active={selectedType === tp}
              onClick={() => { setSelectedType(tp); setFilterDrawerOpen(false); }}
            />
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <AppLayout>
      <div className="relative min-h-full">
        {/* Menu Lateral Mobile */}
        <Sheet open={filterDrawerOpen} onOpenChange={setFilterDrawerOpen}>
          <SheetContent side="left" className="w-[280px] border-border/10 bg-background/95 p-6">
            <p className="mb-6 font-serif text-2xl text-foreground">{t("notes_filters")}</p>
            {SidebarContent}
          </SheetContent>
        </Sheet>

        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-5 lg:flex-row lg:gap-16 lg:px-12 lg:py-16">
          {/* Sidebar Desktop */}
          <aside className="hidden lg:sticky lg:top-16 lg:block lg:w-52 lg:shrink-0 lg:self-start">
            {SidebarContent}
          </aside>

          {/* Conteúdo Principal */}
          <main className="min-w-0 flex-1">
            {/* Header (desktop) */}
            <header className="mb-8 hidden lg:block">
              <div className="flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
                    {selectedType ? (t(`entities_type_${selectedType}`) ?? typeLabels[selectedType]) : t("entities_allAtoms")}
                  </p>
                  <h1 className="mt-2 font-serif text-5xl tracking-tight text-foreground">{t("entities_title")}</h1>
                  <p className="mt-2 text-sm text-muted-foreground">{t("entities_tagline")}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
                    <Plus className="h-3.5 w-3.5" /> {t("entities_new")}
                  </Button>
                </div>

              </div>
            </header>

            {/* Mobile: search + type chips */}
            <div className="mb-5 space-y-3 lg:hidden">
              <div className="flex items-center gap-2">
                <div className="relative z-0 flex-1">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("entities_searchAmong", { n: counts.all }) || `Search among ${counts.all} entities…`}
                    className="h-12 w-full rounded-2xl bg-accent pl-11 text-[15px] placeholder:italic placeholder:text-muted-foreground"
                  />
                </div>
                <ListSortMenu value={sortMode} onValueChange={setSortMode} labels={sortLabels} />
              </div>
              <FilterChips
                value={selectedType ?? "ALL"}
                onChange={(v) => setSelectedType(v === "ALL" ? null : v)}
                options={[
                  { value: "ALL", label: t("entities_all") },
                  ...types.map((tp) => ({
                    value: tp,
                    label: t(`entities_type_${tp}`) ?? typeLabels[tp],
                  })),
                ]}
              />
            </div>

            {/* Input de Busca Fixo (desktop) */}
            <div className="sticky top-14 z-10 -mx-4 hidden border-b border-border/10 bg-background/70 px-4 py-3 backdrop-blur-xl lg:block">
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    variant="ghost"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("common_search") + "…"}
                    className="w-full border-0 bg-transparent pl-6 text-sm text-foreground placeholder:italic placeholder:text-muted-foreground focus:outline-none focus:ring-0"
                  />
                </div>
                <ListSortMenu value={sortMode} onValueChange={setSortMode} labels={sortLabels} />
              </div>
            </div>


            {/* Selection action bar */}
            {selectMode && (
              <div className="sticky top-[7.5rem] z-20 mb-6 flex flex-col items-stretch gap-3 rounded-sm border border-border/15 bg-background/80 px-3 py-2.5 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
                <span className="text-sm text-muted-foreground">{t("select_selected", { n: selectedIds.size })}</span>
                <div className="grid w-full min-w-0 grid-cols-2 gap-2 md:flex md:w-auto md:flex-wrap">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="col-span-2 w-full justify-center normal-case px-3 py-1.5 text-xs text-muted-foreground hover:border-border/40 hover:text-foreground md:col-span-1 md:w-auto"
                    onClick={() => {
                      const allIds = filteredAndSorted.map((e) => e.id);
                      const allSelected = allIds.every((id) => selectedIds.has(id));
                      setSelectedIds(allSelected ? new Set() : new Set(allIds));
                    }}
                  >
                    {filteredAndSorted.length > 0 && filteredAndSorted.every((e) => selectedIds.has(e.id)) ? t("select_clearAll") : t("select_all")}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="w-full justify-center normal-case inline-flex items-center gap-1.5 px-3 py-1.5 text-xs md:w-auto"
                    onClick={() => setBulkDeleteOpen(true)}
                    disabled={selectedIds.size === 0}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> {t("common_delete")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-center normal-case inline-flex items-center gap-1.5 px-3 py-1.5 text-xs md:w-auto"
                    onClick={exitSelectMode}
                  >
                    <X className="h-3.5 w-3.5" /> {t("select_done")}
                  </Button>
                </div>
              </div>
            )}

            {/* Listagem Contínua */}

            {loading ? (
              <div className="space-y-3 py-6">
                {Array.from({ length: 8 }).map((_, index) => (
                  <Skeleton key={index} className="h-14 w-full" />
                ))}
              </div>
            ) : filteredAndSorted.length === 0 ? (
              <div className="py-24 text-center">
                <p className="font-serif text-2xl italic text-muted-foreground">
                  {search ? t("entities_empty_search") : t("entities_empty_all")}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/10">
                {filteredAndSorted.map((entity) => {
                  const targetDate = entity.updatedAt || entity.createdAt;
                  const selected = selectedIds.has(entity.id);
                  return (
                    <EntityRow
                      key={entity.id}
                      selectMode={selectMode}
                      selected={selected}
                      onLongPress={() => {
                        setSelectMode(true);
                        setSelectedIds((prev) => new Set(prev).add(entity.id));
                      }}
                      onOpen={() =>
                        selectMode ? toggleSelect(entity.id) : navigate(`/entities/${entity.id}`)
                      }
                    >
                      {selectMode && (
                        <span
                          className={cn(
                            "mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-sm border transition-colors",
                            selected ? "border-border/10 bg-foreground text-background" : "border-border/30 text-transparent"
                          )}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      )}

                      <ListRowContent
                        icon={<EntityTypeIcon type={entity.type} className="h-5 w-5" />}
                        title={entity.title || t("notes_untitled")}
                        meta={
                          <>
                            {t(`entities_type_${entity.type}`) ?? typeLabels[entity.type] ?? entity.type}
                            {" · "}
                            {relativeDate(targetDate)}
                            {entity.description ? ` · ${entity.description}` : ""}
                          </>
                        }
                      />


                      {!selectMode && (
                        <div className="flex shrink-0 items-center gap-2 pt-1">
                          <span className="flex h-5 w-5 items-center justify-center">
                            <InsightSignalBadge kind="entity" id={entity.id} className="h-5 w-5" />
                          </span>
                          <span className="flex h-5 w-5 items-center justify-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="iconSm"
                              className={cn(
                                "h-5 w-5 rounded-full p-0 opacity-70 transition-colors hover:opacity-100",
                                entity.favorite ? "text-foreground" : "text-foreground"
                              )}
                              onClick={(e) => void toggleFavorite(entity, e)}
                              aria-label={entity.favorite ? t("notes_unfavorite") : t("notes_favorite")}
                            >
                              {entity.favorite ? (
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
                                handleDelete(e, entity);
                              }}
                              aria-label={t("common_delete")}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </span>
                        </div>
                      )}
                    </EntityRow>
                  );
                })}
              </ul>
            )}
          </main>
        </div>
      </div>

      <FloatingCreateButton
        label={t("entities_new")}
        onClick={() => setCreateOpen(true)}
        icon={<Plus className="h-4 w-4" />}
      />


      <CreateEntityDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultType={(selectedType as EntityType) || "TOPIC"}
        onCreated={(entity) => {
          const resolvedEntity = entity as Entity & { _optimisticId?: string };
          if (resolvedEntity._optimisticId) {
            const { _optimisticId, ...serverEntity } = resolvedEntity;
            setEntities((prev) => prev.map((item) => item.id === _optimisticId ? serverEntity : item));
            entitiesQuery.setData((prev) => (prev ?? []).map((item) => item.id === _optimisticId ? serverEntity : item));
            return;
          }
          setEntities((prev) => [...prev, resolvedEntity]);
          entitiesQuery.setData((prev) => [...(prev ?? []), resolvedEntity]);
        }}
        onCreationFailed={(entityId) => {
          setEntities((prev) => prev.filter((entity) => entity.id !== entityId));
          entitiesQuery.setData((prev) => (prev ?? []).filter((entity) => entity.id !== entityId));
        }}
      />
      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        reason={t("entities_limit")}
      />
      <ConfirmDialog
        open={!!pendingDeleteEntity}
        onOpenChange={(open) => !open && setPendingDeleteEntity(null)}
        title={t("entities_delete_one_title")}
        description={
          pendingDeleteEntity
            ? t("entities_delete_one_desc", { title: pendingDeleteEntity.title || t("notes_untitled") })
            : ""
        }
        confirmText={t("common_delete")}
        destructive
        onConfirm={confirmDelete}
      />
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => !open && !bulkDeleting && setBulkDeleteOpen(false)}
        title={t(selectedIds.size === 1 ? "entities_delete_many_title_one" : "entities_delete_many_title", { n: selectedIds.size })}
        description={t("entities_delete_many_desc")}
        confirmText={bulkDeleting ? t("entities_deleting") : t("common_delete")}
        destructive
        onConfirm={confirmBulkDelete}
      />
    </AppLayout>
  );
}