import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FireIcon,
  ClockIcon,
  UsersIcon,
  ArrowTrendingUpIcon,
  ArrowPathIcon,
  MagnifyingGlassIcon,
  AdjustmentsHorizontalIcon,
} from "@heroicons/react/24/outline";
import AppLayout from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { FilterChips } from "@/components/ui/filter-chips";
import { FitText } from "@/components/ui/fit-text";
import { ListRowContent } from "@/components/ui/list-row-content";
import { EntityTypeIcon } from "@/components/ui/entity-type-icon";
import { StickyNote } from "@/lib/heroicons";
import { ScoreEvolutionSection } from "@/components/insights/ScoreEvolutionSection";

import { cn } from "@/lib/utils";
import { insightsApi } from "@/lib/api";
import { useCachedResource } from "@/hooks/useCachedResource";
import { qk, STALE } from "@/lib/queries";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";

/* ── Types ────────────────────────────────────────────────────────────── */

interface NoteInsight {
  note: { id: string; title: string; type?: string };
  score: number;
  badge: string;
  mentionCount: number;
  entityConnections: number;
  hoursTracked: number;
  daysSinceLastInteraction: number;
}

interface EntityInsight {
  entity: { id: string; title: string; type?: string };
  score: number;
  badge: string;
  mentionCount: number;
  relationsCount: number;
  hoursTracked: number;
  daysSinceLastMention: number;
}

type InsightCategory = "hotNotes" | "hotEntities" | "worthRevisiting" | "forgottenGems";
type View = "all" | InsightCategory;

interface InsightItem {
  id: string;
  kind: "note" | "entity";
  category: InsightCategory;
  score: number;
  normalizedScore: number;
  badge: string;
  title: string;
  subtitle: string;
  metaDetails: {
    mentions?: number;
    links?: number;
    hours?: number;
    daysAgo: number;
  };
  onOpen: () => void;
}

/* ── Meta de Categorias ──────────────────────────────────────────────── */

const CATEGORY_META: Record<InsightCategory, { labelKey: string; subtitleKey: string; icon: typeof FireIcon }> = {
  hotNotes: {
    labelKey: "ins_cat_hot_notes",
    subtitleKey: "ins_cat_hot_notes_sub",
    icon: FireIcon,
  },
  hotEntities: {
    labelKey: "ins_cat_hot_entities",
    subtitleKey: "ins_cat_hot_entities_sub",
    icon: UsersIcon,
  },
  worthRevisiting: {
    labelKey: "ins_cat_worth_revisiting",
    subtitleKey: "ins_cat_worth_revisiting_sub",
    icon: ClockIcon,
  },
  forgottenGems: {
    labelKey: "ins_cat_forgotten_gems",
    subtitleKey: "ins_cat_forgotten_gems_sub",
    icon: ArrowTrendingUpIcon,
  },
};

const categoryOrder: InsightCategory[] = ["hotNotes", "hotEntities", "worthRevisiting", "forgottenGems"];

/* ── Helpers de Formatação e Estilo ─────────────────────────────────── */

const formatHours = (h: number) => {
  if (!h) return null;
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(h < 10 ? 1 : 0)}h`;
};

const formatDays = (d: number, t: (key: string, vars?: Record<string, any>) => string) => {
  if (d <= 0) return t("ins_today");
  if (d === 1) return t("ins_days_ago_1");
  if (d < 30) return t("ins_days_ago_n", { count: d });
  if (d < 365) return t("ins_months_ago", { count: Math.floor(d / 30) });
  return t("ins_years_ago", { count: Math.floor(d / 365) });
};

const BADGE_KEY_MAP: Record<string, string> = {
  "hot right now": "ins_badge_hot",
  "worth revisiting": "ins_badge_worth_revisiting",
  "forgotten gem": "ins_badge_forgotten_gem",
  "key entity": "ins_badge_key_entity",
};

const translateBadge = (badge: string, t: (key: string, vars?: Record<string, any>) => string) => {
  const key = BADGE_KEY_MAP[badge?.toLowerCase()?.trim() || ""];
  return key ? t(key) : badge;
};

const badgeStyle = (badge: string) => {
  const b = badge?.toLowerCase() || "";
  if (b.includes("hot")) return "bg-foreground/[0.06] text-muted-foreground border-border/20";
  if (b.includes("forgotten") || b.includes("gem")) return "bg-foreground/[0.04] text-muted-foreground border-border/10";
  return "bg-transparent text-muted-foreground border-border/10";
};

function StatChip({ children }: { children: ReactNode }) {
  return (
    <Badge variant="outline" className="rounded-sm border-border/5 bg-foreground/[0.02] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {children}
    </Badge>
  );
}

/* ── Sidebar Nav Item ─────────────────────────────────────────────────── */

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

/* ── Linha do Insight ───────────────────────────────────────────────── */

function InsightRow({ item }: { item: InsightItem }) {
  const { t } = useLanguage();
  return (
    <li>
      <button
        onClick={item.onOpen}
        className="group relative flex w-full items-center gap-4 py-4 text-left transition-colors hover:bg-foreground/[0.02]"
      >
        <ListRowContent
          icon={
            item.kind === "note" ? (
              <StickyNote className="h-5 w-5" />
            ) : (
              <EntityTypeIcon type={item.subtitle} className="h-5 w-5" />
            )
          }
          title={item.title}
          meta={
            <>
              {item.subtitle}
              {" · "}
              {formatDays(item.metaDetails.daysAgo, t)}
              {item.metaDetails.mentions ? ` · ${t("ins_mentions", { count: item.metaDetails.mentions })}` : ""}
              {item.metaDetails.hours ? ` · ${t("ins_hours_tracked", { hours: formatHours(item.metaDetails.hours) })}` : ""}
            </>
          }
          trailing={
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="rounded-sm border-border/10 bg-transparent px-1.5 py-0 font-mono text-[10px] text-muted-foreground"
                aria-label={`Score ${item.score.toFixed(1)}`}
              >
                {item.score.toFixed(1)}
              </Badge>
            </div>
          }
        />
      </button>

    </li>
  );
}

/* ── Componente Principal ─────────────────────────────────────────────── */

export default function Insights() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { toast } = useToast();

  const insightsQuery = useCachedResource<{
    hotNotes: NoteInsight[];
    forgottenNotes: NoteInsight[];
    hotEntities: EntityInsight[];
    forgottenEntities: EntityInsight[];
  }>(
    qk.insights("all", 12),
    async () => {
      const [hn, fn, he, fe] = await Promise.all([
        insightsApi.hotNotes(12),
        insightsApi.forgottenNotes(12),
        insightsApi.hotEntities(12),
        insightsApi.forgottenEntities(12),
      ]);
      return {
        hotNotes: hn.data || [],
        forgottenNotes: fn.data || [],
        hotEntities: he.data || [],
        forgottenEntities: fe.data || [],
      };
    },
    { staleTime: STALE.insights }
  );

  const loading = insightsQuery.loading;
  const refreshing = insightsQuery.refreshing;
  const hotNotes = insightsQuery.data?.hotNotes ?? [];
  const forgottenNotes = insightsQuery.data?.forgottenNotes ?? [];
  const hotEntities = insightsQuery.data?.hotEntities ?? [];
  const forgottenEntities = insightsQuery.data?.forgottenEntities ?? [];
  
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  const load = async (_silent = false) => {
    await insightsQuery.refetch();
  };

  const insights = useMemo(() => {
    const items: InsightItem[] = [];

    hotNotes.forEach((item) => {
      items.push({
        id: item.note.id,
        kind: "note",
        category: "hotNotes",
        score: item.score,
        normalizedScore: item.score,
        badge: item.badge,
        title: item.note.title || t("ins_untitled"),
        subtitle: t("ins_note"),
        metaDetails: { mentions: item.mentionCount, links: item.entityConnections, hours: item.hoursTracked, daysAgo: item.daysSinceLastInteraction },
        onOpen: () => navigate(`/notes/${item.note.id}`),
      });
    });

    hotEntities.forEach((item) => {
      items.push({
        id: item.entity.id,
        kind: "entity",
        category: "hotEntities",
        score: item.score,
        normalizedScore: item.score,
        badge: item.badge,
        title: item.entity.title || t("ins_untitled"),
        subtitle: item.entity.type || t("ins_atom"),
        metaDetails: { mentions: item.mentionCount, links: item.relationsCount, hours: item.hoursTracked, daysAgo: item.daysSinceLastMention },
        onOpen: () => navigate(`/entities/${item.entity.id}`),
      });
    });

    forgottenNotes.forEach((item) => {
      items.push({
        id: item.note.id,
        kind: "note",
        category: "worthRevisiting",
        score: item.score,
        normalizedScore: item.score,
        badge: item.badge,
        title: item.note.title || t("ins_untitled"),
        subtitle: t("ins_note"),
        metaDetails: { mentions: item.mentionCount, links: item.entityConnections, hours: item.hoursTracked, daysAgo: item.daysSinceLastInteraction },
        onOpen: () => navigate(`/notes/${item.note.id}`),
      });
    });

    forgottenEntities.forEach((item) => {
      items.push({
        id: item.entity.id,
        kind: "entity",
        category: "forgottenGems",
        score: item.score,
        normalizedScore: item.score,
        badge: item.badge,
        title: item.entity.title || t("ins_untitled"),
        subtitle: item.entity.type || t("ins_atom"),
        metaDetails: { mentions: item.mentionCount, links: item.relationsCount, hours: item.hoursTracked, daysAgo: item.daysSinceLastMention },
        onOpen: () => navigate(`/entities/${item.entity.id}`),
      });
    });

    // Normalize within each category before mixing them in the "All" tab —
    // notes and entities use different weight scales on the backend, so raw
    // scores aren't comparable across categories. Min-max is monotonic inside
    // each group, so individual tabs keep their existing order.
    const byCategory = new Map<InsightCategory, InsightItem[]>();
    items.forEach((item) => {
      const arr = byCategory.get(item.category) ?? [];
      arr.push(item);
      byCategory.set(item.category, arr);
    });
    byCategory.forEach((group) => {
      const scores = group.map((i) => i.score);
      const min = Math.min(...scores);
      const max = Math.max(...scores);
      const range = max - min || 1;
      group.forEach((item) => {
        item.normalizedScore = (item.score - min) / range;
      });
    });

    return items.sort((a, b) => b.normalizedScore - a.normalizedScore);
  }, [hotNotes, hotEntities, forgottenNotes, forgottenEntities, navigate]);

  const filteredInsights = useMemo(() => {
    const query = search.trim().toLowerCase();
    return insights.filter((item) => {
      if (view !== "all" && item.category !== view) return false;
      if (!query) return true;
      return `${item.title} ${item.subtitle} ${item.badge}`.toLowerCase().includes(query);
    });
  }, [insights, search, view]);

  const counts = {
    all: insights.length,
    hotNotes: hotNotes.length,
    hotEntities: hotEntities.length,
    worthRevisiting: forgottenNotes.length,
    forgottenGems: forgottenEntities.length,
  };

  const SidebarContent = (
    <div className="space-y-7">
      <div>
        <p className="mb-3 text-[10px] uppercase tracking-[0.32em] text-muted-foreground">{t("ins_index")}</p>
        <NavItem label={t("ins_all_insights")} count={counts.all} active={view === "all"} onClick={() => { setView("all"); setFilterDrawerOpen(false); }} />
      </div>
      <div>
        <p className="mb-3 text-[10px] uppercase tracking-[0.32em] text-muted-foreground">{t("ins_signals")}</p>
        <div className="space-y-0.5">
          {categoryOrder.map((cat) => (
            <NavItem
              key={cat}
              label={t(CATEGORY_META[cat].labelKey)}
              count={counts[cat]}
              active={view === cat}
              onClick={() => { setView(cat); setFilterDrawerOpen(false); }}
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
            <p className="mb-6 font-serif text-2xl text-foreground">{t("ins_filters")}</p>
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
            {/* Evolução do score */}
            <div className="-mx-6 mb-6 sm:-mx-2 lg:-mx-4 lg:mb-8">
              <ScoreEvolutionSection />
            </div>



            {/* Mobile: search + category chips */}
            <div className="mb-5 space-y-3 lg:hidden">
              <div className="flex items-center gap-2">
                <div className="relative z-0 flex-1">
                  <MagnifyingGlassIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("ins_searchAmong", { n: counts.all }) || `Search among ${counts.all} signals…`}
                    className="h-12 w-full rounded-2xl bg-accent pl-11 text-[15px] placeholder:italic placeholder:text-muted-foreground"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-12 w-12 shrink-0 rounded-2xl bg-accent"
                  onClick={() => load(true)}
                  disabled={refreshing}
                  aria-label={t("ins_refresh")}
                >
                  <ArrowPathIcon className={cn("h-4 w-4", refreshing && "animate-spin")} />
                </Button>
              </div>
              <FilterChips
                value={view}
                onChange={(v) => setView(v as View)}
                options={[
                  { value: "all", label: t("ins_all_insights") },
                  ...categoryOrder.map((cat) => ({ value: cat, label: t(CATEGORY_META[cat].labelKey) })),
                ]}
              />
            </div>

            {/* Input de Busca Sticky (desktop) */}
            <div className="sticky top-14 z-10 -mx-4 hidden border-b border-border/10 bg-background/70 px-4 py-3 backdrop-blur-xl lg:block">
              <div className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("ins_search_placeholder")}
                  className="w-full border-0 bg-transparent pl-6 text-sm text-foreground placeholder:italic placeholder:text-muted-foreground focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
            </div>


            <div className="flex items-center justify-between border-b border-border/5 pb-3 pt-4 mb-4 text-[11px] text-muted-foreground">
              <div>
                {filteredInsights.length === 1
                  ? t("ins_showing_signal", { count: filteredInsights.length })
                  : t("ins_showing_signals", { count: filteredInsights.length })}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("ins_sorted_by_score")}
              </div>
            </div>

            <div className="mt-2">
              {loading ? (
                <div className="space-y-3 py-6">
                  {Array.from({ length: 7 }).map((_, index) => (
                    <Skeleton key={index} className="h-14 w-full" />
                  ))}
                </div>
              ) : filteredInsights.length === 0 ? (
                <div className="py-24 text-center">
                  <p className="font-serif text-2xl italic text-muted-foreground">
                    {t("ins_no_matching")}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border/10">
                  {filteredInsights.map((item) => (
                    <InsightRow key={`${item.kind}-${item.id}-${item.category}`} item={item} />
                  ))}
                </ul>
              )}
            </div>
          </main>
        </div>
      </div>
    </AppLayout>
  );
}