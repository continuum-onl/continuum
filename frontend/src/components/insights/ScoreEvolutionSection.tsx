import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

import { metricsApi } from "@/lib/api";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowRight, RefreshCw } from "@/lib/heroicons";

const rangeDaysMap = { "14d": 14, "1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, total: 3650 };
type TimeRange = keyof typeof rangeDaysMap;

type Components = Record<string, number>;
type Point = { date: string; score: number; rawScore: number; delta: number; components: Components };
type Contribution = { kind: string; value: number; count: number; subject?: string | null };
type Comparison = {
  currentScore: number;
  firstScore: number;
  average30: number;
  percentVsAverage30: number;
  bestWeekStart?: string | null;
  bestWeekAverage: number;
  daysTracked: number;
  coldStart: boolean;
};
type Milestone = { kind: string; value: number; date: string; achievedToday: boolean };
type Insights = {
  points: Point[];
  todayContributions: Contribution[];
  comparison: Comparison;
  milestones: Milestone[];
};

const COMPONENT_KEYS = ["notes", "entities", "connections", "freshness", "continuity", "daily"] as const;

const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: "2-digit", month: "short" });

export function ScoreEvolutionSection({
  onScoreChange,
}: {
  onScoreChange?: (score: number) => void;
}) {
  const { t } = useLanguage();
  const [timeRange, setTimeRange] = useState<TimeRange>("14d");
  const [forceHideTooltip, setForceHideTooltip] = useState(false);

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ["metrics", "scoreInsights"],
    queryFn: () => metricsApi.scoreInsights().then((r) => r.data as Insights),
    retry: 1,
    staleTime: 60_000,
  });

  const points = useMemo(() => (Array.isArray(data?.points) ? data!.points : []), [data]);
  const current = points.length ? points[points.length - 1].score : 0;

  useEffect(() => {
    onScoreChange?.(current);
  }, [current, onScoreChange]);

  const chartData = useMemo(() => {
    const days = rangeDaysMap[timeRange];
    const sliced = timeRange === "total" ? points : points.slice(-days);
    const step = Math.max(1, Math.ceil(sliced.length / 365));
    return sliced
      .filter((_, i) => i % step === 0 || i === sliced.length - 1)
      .map((p) => ({ ...p, label: fmtDate(p.date) }));
  }, [points, timeRange]);

  const hasData = points.length > 0;

  const comparison = data?.comparison;
  const comparisonText = null;

  const bestWeekText = null;

  const milestoneBadges = [];

  const handleTouchStart = () => setForceHideTooltip(false);
  const handleTouchEnd = () => setForceHideTooltip(true);

  const renderTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload as Point & { label: string };
    return (
      <div className="rounded-lg border border-border/10 bg-background/90 px-3 py-2 text-[11px] shadow-xl backdrop-blur-md">
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {fmtDate(p.date)} · {p.score.toFixed(2)}
          {p.delta !== 0 && (
            <span className={cn("ml-1", p.delta > 0 ? "text-emerald-400" : "text-red-400")}>
              {p.delta > 0 ? "+" : ""}
              {p.delta.toFixed(2)}
            </span>
          )}
        </p>
        <div className="space-y-0.5">
          {COMPONENT_KEYS.map((k) => (
            <div key={k} className="flex items-center justify-between gap-4 text-muted-foreground">
              <span>{t(`sc_bd_${k}`)}</span>
              <span className="font-mono tabular-nums text-foreground">
                {(p.components?.[k] ?? 0).toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col justify-between bg-background">
      <div className="flex h-full flex-col justify-between p-4 sm:p-6">
        <div className="mb-3 flex items-baseline justify-between">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{t("sc_current")}</p>
          <p className="font-mono text-sm text-foreground">{current.toFixed(2)}</p>
        </div>

        <div className="relative mb-4 -mx-4 sm:mx-0">
          <div className="flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:px-0">
            {(Object.keys(rangeDaysMap) as TimeRange[]).map((range) => {
              const labels: Record<TimeRange, string> = {
                "14d": t("db_range14d"),
                "1mo": t("db_range1mo"),
                "3mo": t("db_range3mo"),
                "6mo": t("db_range6mo"),
                "1y": t("db_range1y"),
                total: t("db_rangeTotal"),
              };
              const active = timeRange === range;
              return (
                <Button
                  key={range}
                  type="button"
                  variant="ghost"
                  onClick={() => setTimeRange(range)}
                  className={cn(
                    "h-auto shrink-0 rounded-full border px-3.5 py-1.5 text-[11px] normal-case transition-colors",
                    active
                      ? "border-border/70 text-foreground hover:bg-transparent hover:text-foreground"
                      : "border-border/15 text-muted-foreground hover:border-border/30 hover:bg-transparent hover:text-muted-foreground"
                  )}
                >
                  {labels[range]}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="relative h-[260px] w-full sm:h-[320px]">
          {isLoading && !hasData ? (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
              {t("sc_loading")}
            </div>
          ) : !hasData ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center">
              <p className="text-xs text-muted-foreground">{t("sc_empty")}</p>
              <p className="text-[11px] text-muted-foreground">{t("sc_emptyHint")}</p>
            </div>
          ) : (
            <>
              {isError && (
                <div className="absolute right-2 top-1 z-10 rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1 text-[10px] text-red-400">
                  {t("sc_failed")}
                </div>
              )}
              <ChartContainer
                config={{}}
                className="h-full w-full"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
              >
                <AreaChart
                  data={chartData}
                  margin={{ top: 14, right: 12, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="scoreFillMinimal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
                      <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="hsl(var(--foreground) / 0.04)" strokeDasharray="2 6" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    tickMargin={8}
                    minTickGap={32}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    domain={[0, (dataMax: number) => Math.max(dataMax * 1.2, 1)]}
                    tickFormatter={(value) => Number(value).toFixed(0)}
                    width={32}
                    tickCount={4}
                  />
                  <Tooltip
                    active={forceHideTooltip ? false : undefined}
                    cursor={{ stroke: "hsl(var(--foreground) / 0.2)", strokeWidth: 1, strokeDasharray: "3 3" }}
                    content={renderTooltip}
                  />
                  <Area
                    type="monotone"
                    dataKey="score"
                    stroke="hsl(var(--foreground))"
                    strokeWidth={1.75}
                    fill="url(#scoreFillMinimal)"
                    dot={false}
                    activeDot={{ r: 4, fill: "hsl(var(--foreground))", stroke: "hsl(var(--background))", strokeWidth: 2 }}
                    isAnimationActive
                    animationDuration={500}
                  />
                </AreaChart>
              </ChartContainer>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ScoreEvolutionSection;