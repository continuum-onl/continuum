import { useEffect, useState } from "react";
import { insightsApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { FireIcon, SparklesIcon, ArrowPathIcon, KeyIcon } from "@heroicons/react/24/outline";
import { useLanguage } from "@/contexts/LanguageContext";
import { InfoPopover } from "@/components/ui/info-popover";

type Kind = "note" | "entity";
type Category = "hot" | "forgotten";
type InsightSignal = { badge: string; score: number; category: Category };
type InsightApiItem = {
  note?: { id?: string };
  entity?: { id?: string };
  badge?: string;
  score?: number;
};
type CacheEntry = {
  byId: Map<string, InsightSignal>;
  fetchedAt: number;
};

const CACHE: Record<Kind, CacheEntry | null> = { note: null, entity: null };
const CACHE_TTL_MS = 5 * 60 * 1000;
const pending: Record<Kind, Promise<CacheEntry> | null> = { note: null, entity: null };

async function loadCache(kind: Kind): Promise<CacheEntry> {
  const existing = CACHE[kind];
  if (existing && Date.now() - existing.fetchedAt < CACHE_TTL_MS) return existing;
  if (pending[kind]) return pending[kind]!;

  const request = (async () => {
    const [hot, forgotten] = await Promise.all(
      kind === "note"
        ? [insightsApi.hotNotes(50), insightsApi.forgottenNotes(50)]
        : [insightsApi.hotEntities(500), insightsApi.forgottenEntities(500)]
    );
    const byId = new Map<string, InsightSignal>();
    ((hot.data || []) as InsightApiItem[]).forEach((it) => {
      const id = kind === "note" ? it.note?.id : it.entity?.id;
      if (id) byId.set(id, { badge: it.badge || "Hot", score: it.score ?? 0, category: "hot" });
    });
    ((forgotten.data || []) as InsightApiItem[]).forEach((it) => {
      const id = kind === "note" ? it.note?.id : it.entity?.id;
      if (!id) return;
      if (!byId.has(id)) byId.set(id, { badge: it.badge || "Forgotten Gem", score: it.score ?? 0, category: "forgotten" });
    });
    const entry = { byId, fetchedAt: Date.now() };
    CACHE[kind] = entry;
    pending[kind] = null;
    return entry;
  })();
  pending[kind] = request;
  try {
    return await request;
  } catch (error) {
    pending[kind] = null;
    throw error;
  }
}

export function useInsightSignal(kind: Kind, id?: string) {
  const [data, setData] = useState<InsightSignal | null>(null);
  useEffect(() => {
    if (!id) return;
    let active = true;
    loadCache(kind)
      .then((cache) => {
        if (!active) return;
        setData(cache.byId.get(id) || null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [kind, id]);
  return data;
}

const BADGE_KEY_MAP: Record<string, string> = {
  "hot right now": "ins_badge_hot",
  "worth revisiting": "ins_badge_worth_revisiting",
  "forgotten gem": "ins_badge_forgotten_gem",
  "key entity": "ins_badge_key_entity",
  hot: "ins_badge_hot",
  forgotten: "ins_badge_forgotten_gem",
};

function normalizeBadgeKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const BADGE_STYLE: Record<
  string,
  { icon: typeof FireIcon; classes: string; color: string }
> = {
  "hot right now": { icon: FireIcon, classes: "border-orange-500/30 bg-orange-500/10 text-orange-300", color: "#fdba74" },
  hot: { icon: FireIcon, classes: "border-orange-500/30 bg-orange-500/10 text-orange-300", color: "#fdba74" },
  "worth revisiting": { icon: ArrowPathIcon, classes: "border-sky-500/30 bg-sky-500/10 text-sky-300", color: "#7dd3fc" },
  "forgotten gem": { icon: SparklesIcon, classes: "border-violet-500/30 bg-violet-500/10 text-violet-300", color: "#c4b5fd" },
  forgotten: { icon: SparklesIcon, classes: "border-violet-500/30 bg-violet-500/10 text-violet-300", color: "#c4b5fd" },
  "key entity": { icon: KeyIcon, classes: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", color: "#6ee7b7" },
};

export function InsightBadge({
  badge,
  category,
  className,
}: {
  badge: string;
  category?: Category;
  className?: string;
}) {
  const { t } = useLanguage();
  const key = normalizeBadgeKey(badge);
  const style = BADGE_STYLE[key] || {
    icon: category === "forgotten" ? SparklesIcon : FireIcon,
    classes:
      category === "forgotten"
        ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
        : "border-orange-500/30 bg-orange-500/10 text-orange-300",
    color: category === "forgotten" ? "#c4b5fd" : "#fdba74",
  };
  const Icon = style.icon;
  const label = BADGE_KEY_MAP[key] ? t(BADGE_KEY_MAP[key]) : badge;

  return (
    <InfoPopover
      description={label}
      icon={<Icon className="h-3 w-3" />}
      iconColor={style.color}
      className={cn(
        "shrink-0 border hover:brightness-125",
        style.classes,
        className,
      )}
      onTriggerClick={(event) => {
        event.stopPropagation();
      }}
    />
  );
}

export function InsightSignalBadge({ kind, id, className }: { kind: Kind; id?: string; className?: string }) {
  const signal = useInsightSignal(kind, id);
  if (!signal) return null;
  return <InsightBadge badge={signal.badge} category={signal.category} className={className} />;
}
