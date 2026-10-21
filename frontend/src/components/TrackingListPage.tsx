import { useCallback, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { TimeTrackingList } from "@/components/TimeTrackingList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { Plus } from "@/lib/heroicons";
import { FloatingCreateButton } from "@/components/ui/floating-create-button";
import { FilterChips } from "@/components/ui/filter-chips";
import { ListSortMenu, type ListSortMode } from "@/components/ui/list-sort-menu";
import { useLanguage } from "@/contexts/LanguageContext";

type QuickFilter = "all" | "yes" | "no";

export function TrackingListPage({ kind }: { kind: "PROJECT" | "ACTIVITY" }) {
  const { t, language } = useLanguage() as ReturnType<typeof useLanguage> & { language?: string };
  const p = kind === "PROJECT" ? "projects" : "activities";
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<ListSortMode>("recent");
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [total, setTotal] = useState(0);
  const handleCount = useCallback((n: number) => setTotal(n), []);
  const pt = String(language ?? "").startsWith("pt");

  const chipLabels = kind === "PROJECT"
    ? { all: pt ? "Todos" : "All", yes: pt ? "Com registros" : "Tracked", no: pt ? "Sem registros" : "No entries" }
    : { all: pt ? "Todas" : "All", yes: pt ? "Feitas hoje" : "Done today", no: pt ? "Pendentes" : "Pending" };
  const sortLabels = { recent: pt ? "Recentes" : "Recent", oldest: pt ? "Antigos" : "Oldest", az: "A–Z", za: "Z–A" };

  return (
    <AppLayout>
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-5 lg:flex-row lg:items-start lg:gap-14 lg:px-12 lg:py-10">
        <main className="min-w-0 flex-1">
          <header className="mb-8 hidden lg:block">
            <div className="flex items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
                  {kind === "PROJECT" ? t("tm_project") : t("tm_activity")}
                </p>
                <h1 className="mt-2 font-serif text-5xl tracking-tight text-foreground">{t(`${p}_title`)}</h1>
                <p className="mt-2 text-sm text-muted-foreground">{t(`${p}_subtitle`)}</p>
              </div>
              <Button
                className="h-auto gap-2 rounded-full bg-foreground px-6 py-3 text-[15px] font-medium text-background shadow-[0_10px_30px_rgba(0,0,0,0.45)] transition active:scale-95 hover:bg-foreground"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="h-4 w-4" />
                {t(`${p}_new`)}
              </Button>
            </div>
          </header>

          <div className="mb-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative z-0 flex-1">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t(`${p}_searchAmong`, { n: total })}
                  className="h-12 w-full rounded-2xl bg-accent pl-11 text-[15px] placeholder:italic placeholder:text-muted-foreground"
                />
              </div>
              <ListSortMenu className="lg:h-12 lg:w-12 lg:rounded-2xl" value={sortMode} onValueChange={setSortMode} labels={sortLabels} />
            </div>
            <FilterChips
              value={quick}
              onChange={(v) => setQuick(v as QuickFilter)}
              options={(["all", "yes", "no"] as const).map((v) => ({ value: v, label: chipLabels[v] }))}
            />
          </div>

          <TimeTrackingList
            filterType={kind}
            search={search}
            sortMode={sortMode}
            quickFilter={quick}
            hideInternalSearch
            createOpen={createOpen}
            onCreateOpenChange={setCreateOpen}
            onCountChange={handleCount}
          />
        </main>
      </div>

      <FloatingCreateButton label={t(`${p}_new`)} onClick={() => setCreateOpen(true)} icon={<Plus className="h-4 w-4" />} />
    </AppLayout>
  );
}
