import { useMemo, useState, useEffect, useRef, useId } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { timeTrackingApi } from '@/lib/api';
import { useTimeTracking, type TimeEntry } from '@/hooks/useTimeTracking';
import { useTimerGoal } from '@/hooks/useTimerGoal';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  /** Optional entityId filter; when omitted, aggregates across user. */
  entityId?: string;
  /** Number of weeks to show (default 52 — full year). */
  weeks?: number;
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function intensity(seconds: number, goalSeconds: number): number {
  if (!seconds || goalSeconds <= 0) return 0;
  const ratio = seconds / goalSeconds;
  if (ratio >= 1) return 4;
  if (ratio >= 0.66) return 3;
  if (ratio >= 0.33) return 2;
  if (ratio > 0) return 1;
  return 0;
}

function fmtHM(s: number) {
  if (!s) return '0m';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

const LEVEL_BG = [
  'bg-foreground/[0.05]',
  'bg-foreground/20',
  'bg-foreground/40',
  'bg-foreground/65',
  'bg-foreground/90',
];

const DURATION_WHEEL_ROW_HEIGHT = 48;

function DurationWheel({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const wheelId = useId();
  const initialValue = useRef(value);
  const values = useMemo(() => Array.from({ length: max + 1 }, (_, index) => index), [max]);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = initialValue.current * DURATION_WHEEL_ROW_HEIGHT;
  }, []);

  const syncValue = () => {
    if (!ref.current) return;
    const next = Math.max(0, Math.min(max, Math.round(ref.current.scrollTop / DURATION_WHEEL_ROW_HEIGHT)));
    onChange(next);
  };

  return (
    <div className="min-w-0 flex-1 text-center">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <div
        ref={ref}
        role="listbox"
        aria-label={label}
        aria-activedescendant={`${wheelId}-${value}`}
        onScroll={syncValue}
        className="h-36 snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div aria-hidden="true" className="h-12" />
        {values.map((option) => (
          <button
            key={option}
            id={`${wheelId}-${option}`}
            type="button"
            role="option"
            aria-selected={option === value}
            onClick={() => ref.current?.scrollTo({ top: option * DURATION_WHEEL_ROW_HEIGHT, behavior: "smooth" })}
            className={`flex h-12 w-full snap-center items-center justify-center border-y text-2xl tabular-nums transition-colors ${
              option === value
                ? "border-foreground/30 font-semibold text-foreground"
                : "border-transparent text-muted-foreground/50"
            }`}
          >
            {String(option).padStart(2, "0")}
          </button>
        ))}
        <div aria-hidden="true" className="h-12" />
      </div>
    </div>
  );
}

interface HoverCell {
  key: string;
  seconds: number;
  count: number;
  x: number;
  y: number;
}

interface YearBlock {
  year: number;
  cols: { date: Date; key: string; seconds: number; count: number }[][];
}

export function TimeHeatmap({ entityId, weeks = 52 }: Props) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const to = useMemo(() => new Date(), []);
  const minYear = to.getFullYear() - Math.ceil(weeks / 52);

  const { activeTimers, addTimeAsync, isAdding } = useTimeTracking();
  const [hover, setHover] = useState<HoverCell | null>(null);
  const hoverRef = useRef<HoverCell | null>(null);
  hoverRef.current = hover;

  const { goalMinutes, setGoal } = useTimerGoal(entityId);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState<string>(String(goalMinutes));

  const [adding, setAdding] = useState(false);
  const [entryDate, setEntryDate] = useState<string>(() => dateKey(new Date()));
  const [entryHours, setEntryHours] = useState(0);
  const [entryMinutes, setEntryMinutes] = useState(30);
  const [entrySeconds, setEntrySeconds] = useState(0);
  const [entryError, setEntryError] = useState<string | null>(null);

  const goalSeconds = goalMinutes * 60;

  // Fetch full range from earliest year to today
  const from = useMemo(() => new Date(minYear, 0, 1), [minYear]);

  const { data, isLoading } = useQuery({
    queryKey: ['timeTracking', 'heatmap', dateKey(from), dateKey(to), entityId || 'all'],
    queryFn: () =>
      timeTrackingApi
        .getAllInRange(dateKey(from), dateKey(to))
        .then((r) => r.data as TimeEntry[]),
    staleTime: 60_000,
    refetchInterval: 30_000,
  });

  const todayKey = dateKey(to);

  const liveTodaySeconds = useMemo(() => {
    if (!activeTimers || activeTimers.size === 0) return 0;
    if (entityId) return activeTimers.get(entityId)?.elapsedSeconds || 0;
    let total = 0;
    activeTimers.forEach((t) => (total += t.elapsedSeconds || 0));
    return total;
  }, [activeTimers, entityId]);

  const { byDay, countByDay } = useMemo(() => {
    const sec = new Map<string, number>();
    const cnt = new Map<string, number>();
    (data || []).forEach((e) => {
      if (entityId && e.entityId !== entityId) return;
      sec.set(e.date, (sec.get(e.date) || 0) + (e.durationSeconds || 0));
      cnt.set(e.date, (cnt.get(e.date) || 0) + 1);
    });
    if (liveTodaySeconds > 0) {
      sec.set(todayKey, (sec.get(todayKey) || 0) + liveTodaySeconds);
    }
    return { byDay: sec, countByDay: cnt };
  }, [data, entityId, liveTodaySeconds, todayKey]);

  // Build per-year column groups. Years shown: from earliestActivityYear..currentYear.
  // If no data, just show the current year.
  const yearBlocks: YearBlock[] = useMemo(() => {
    const years = new Set<number>([to.getFullYear()]);
    byDay.forEach((_, k) => years.add(parseInt(k.slice(0, 4), 10)));
    const sorted = [...years].sort((a, b) => b - a);

    return sorted.map((year) => {
      const start = new Date(year, 0, 1);
      start.setDate(start.getDate() - start.getDay()); // align to Sunday
      const end = new Date(year, 11, 31);
      const numWeeks = Math.ceil((end.getTime() - start.getTime()) / (7 * 86400 * 1000)) + 1;
      const cols: YearBlock['cols'] = [];
      for (let w = 0; w < numWeeks; w++) {
        const col: YearBlock['cols'][number] = [];
        for (let d = 0; d < 7; d++) {
          const day = new Date(start);
          day.setDate(start.getDate() + w * 7 + d);
          const key = dateKey(day);
          col.push({
            date: day,
            key,
            seconds: byDay.get(key) || 0,
            count: countByDay.get(key) || 0,
          });
        }
        cols.push(col);
      }
      return { year, cols };
    });
  }, [byDay, countByDay, to]);

  const totalSeconds = useMemo(() => {
    let t = 0;
    byDay.forEach((v) => (t += v));
    return t;
  }, [byDay]);

  const activeDays = byDay.size;

  const commitGoal = () => {
    const n = parseInt(goalDraft, 10);
    if (Number.isFinite(n) && n > 0) setGoal(n);
    setEditingGoal(false);
  };

  const submitEntry = async () => {
    setEntryError(null);
    if (!entityId) return;
    const durationSeconds = entryHours * 3600 + entryMinutes * 60 + entrySeconds;
    if (durationSeconds <= 0) {
      setEntryError(t('tm_duration_must_be_positive'));
      return;
    }
    const maxDate = dateKey(new Date());
    if (!entryDate || entryDate > maxDate) {
      setEntryError(t('tm_future_dates_not_allowed'));
      return;
    }
    try {
      await addTimeAsync({
        entityId,
        date: entryDate,
        durationSeconds,
      });
      await qc.invalidateQueries({ queryKey: ['timeTracking'] });
      setAdding(false);
      setEntryHours(0);
      setEntryMinutes(30);
      setEntrySeconds(0);
      setEntryDate(dateKey(new Date()));
    } catch (err: unknown) {
      console.error('Failed to add entry:', err);
      const serverMessage = isAxiosError<{ message?: string }>(err) ? err.response?.data?.message : undefined;
      setEntryError(serverMessage || (err instanceof Error ? err.message : t('tm_failed_to_add_entry')));
    }
  };

  // Dismiss tap-tooltip when tapping outside
  useEffect(() => {
    if (!hover) return;
    const close = (e: Event) => {
      const tgt = e.target as HTMLElement;
      if (!tgt.closest?.('[data-heatmap-cell]')) setHover(null);
    };
    document.addEventListener('touchstart', close, { passive: true });
    document.addEventListener('mousedown', close);
    return () => {
      document.removeEventListener('touchstart', close);
      document.removeEventListener('mousedown', close);
    };
  }, [hover]);

  const openCell = (
    el: HTMLElement,
    cell: { key: string; seconds: number; count: number; date: Date },
  ) => {
    if (cell.date > to) return;
    const rect = el.getBoundingClientRect();
    setHover({
      key: cell.key,
      seconds: cell.seconds,
      count: cell.count,
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  };

  return (
    <section className="relative py-5 sm:py-6">
      <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground font-mono">
          {t('tm_activity_heatmap')}
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="whitespace-normal text-[10px] text-muted-foreground font-mono">
            {t('tm_active_days_summary', { count: activeDays, time: fmtHM(totalSeconds) })}
          </span>
          {editingGoal ? (
            <span className="inline-flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                value={goalDraft}
                onChange={(e) => setGoalDraft(e.target.value)}
                onBlur={commitGoal}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitGoal();
                  if (e.key === 'Escape') {
                    setGoalDraft(String(goalMinutes));
                    setEditingGoal(false);
                  }
                }}
                autoFocus
                className="w-14 px-1.5 py-0.5 text-[10px] font-mono bg-foreground/[0.04] border border-border/15 rounded text-foreground text-right focus:outline-none focus:border-border/30"
              />
              <span className="text-[10px] text-muted-foreground font-mono">{t('tm_min_per_day')}</span>
            </span>
          ) : (
            <button
              onClick={() => {
                setGoalDraft(String(goalMinutes));
                setEditingGoal(true);
              }}
              className="max-w-full whitespace-normal rounded-md bg-secondary px-2 py-1 text-left text-[10px] font-mono text-secondary-foreground/70 transition hover:bg-secondary/75 hover:text-secondary-foreground"
              title={t('tm_set_daily_goal')}
            >
              {t('tm_goal_label', { time: fmtHM(goalSeconds) })}
            </button>
          )}
          {entityId && (
            <button
              onClick={() => {
                setEntryError(null);
                setEntryDate(dateKey(new Date()));
                setEntryHours(0);
                setEntryMinutes(30);
                setEntrySeconds(0);
                setAdding(true);
              }}
              className="whitespace-normal rounded-md bg-secondary px-2 py-1 text-[10px] font-mono text-secondary-foreground/70 transition hover:bg-secondary/75 hover:text-secondary-foreground"
              title={t('tm_add_manual_entry_title')}
            >
              {t('tm_add_entry_short')}
            </button>
          )}
        </div>
      </div>

      <Dialog open={adding && !!entityId} onOpenChange={(open) => {
        setAdding(open);
        if (!open) setEntryError(null);
      }}>
        <DialogContent
          viewportAware={false}
          className="!left-0 !top-auto !bottom-0 !translate-x-0 !translate-y-0 max-h-[min(82dvh,620px)] w-full max-w-none gap-0 overflow-y-auto rounded-b-none rounded-t-3xl border-x-0 border-b-0 p-0 pb-[env(safe-area-inset-bottom)]"
          style={{ top: "auto", bottom: 0, transform: "none" }}
        >
          <DialogHeader className="border-b border-border/10 px-5 py-4 text-center">
            <DialogTitle className="text-lg">{t('tm_add_manual_entry_title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 px-5 py-5">
            <label className="block space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{t('tm_date')}</span>
              <input
                type="date"
                value={entryDate}
                max={dateKey(new Date())}
                onChange={(event) => setEntryDate(event.target.value)}
                aria-label={t('tm_date')}
                className="h-12 w-full rounded-xl border border-border/15 bg-foreground/[0.03] px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <fieldset>
              <legend className="mb-2 text-xs font-medium text-muted-foreground">{t('tm_duration')}</legend>
              <div className="flex items-center gap-2">
                <DurationWheel label={t('tm_hours_short')} value={entryHours} max={99} onChange={setEntryHours} />
                <DurationWheel label={t('tm_minutes_short')} value={entryMinutes} max={59} onChange={setEntryMinutes} />
                <DurationWheel label={t('tm_seconds_short')} value={entrySeconds} max={59} onChange={setEntrySeconds} />
              </div>
            </fieldset>
            {entryError && <p role="alert" className="text-sm text-destructive">{entryError}</p>}
            <Button type="button" onClick={submitEntry} disabled={isAdding} className="h-12 w-full rounded-xl">
              {isAdding ? t('tm_saving_entry') : t('tm_add')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="h-32" />
      ) : (
        <div className="relative space-y-5">
          {yearBlocks.map((block) => (
            <div key={block.year}>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  {block.year}
                </span>
                <span className="h-px flex-1 bg-foreground/[0.06]" />
              </div>
              <div className="overflow-x-auto -mx-1 px-1">
                <div className="flex gap-[4px] min-w-fit">
                  {block.cols.map((col, i) => (
                    <div key={i} className="flex flex-col gap-[4px]">
                      {col.map((cell) => {
                        const isFuture = cell.date > to;
                        const inYear = cell.date.getFullYear() === block.year;
                        const lvl = intensity(cell.seconds, goalSeconds);
                        const isToday = cell.key === todayKey;
                        if (!inYear) {
                          return <div key={cell.key} className="w-[14px] h-[14px]" />;
                        }
                        return (
                          <button
                            type="button"
                            key={cell.key}
                            data-heatmap-cell
                            onMouseEnter={(e) => openCell(e.currentTarget, cell)}
                            onMouseLeave={() => setHover(null)}
                            onClick={(e) => {
                              e.stopPropagation();
                              openCell(e.currentTarget, cell);
                            }}
                            disabled={isFuture}
                            className={`w-[14px] h-[14px] sm:w-[13px] sm:h-[13px] rounded-[3px] ${
                              isFuture ? 'bg-transparent' : LEVEL_BG[lvl]
                            } border ${
                              isToday ? 'border-border/60' : 'border-border/[0.04]'
                            } ${isFuture ? '' : 'hover:ring-1 hover:ring-ring active:scale-110'} transition-transform`}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {hover && (() => {
            const W = 180;
            const margin = 8;
            const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
            const left = Math.max(margin + W / 2, Math.min(vw - margin - W / 2, hover.x));
            return (
              <div
                className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-md border border-border/15 bg-background/95 px-2.5 py-1.5 shadow-xl backdrop-blur"
                style={{ left, top: hover.y - 6, width: W }}
              >
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  {hover.key}
                  {hover.key === todayKey && ` ${t('tm_today_suffix')}`}
                </p>
                <p className="text-xs font-mono text-foreground mt-0.5">
                  {fmtHM(hover.seconds)} · {t('tm_entry_count', { count: hover.count, word: hover.count === 1 ? t('tm_entry_singular') : t('tm_entry_plural') })}
                </p>
                {goalSeconds > 0 && (
                  <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                    {t('tm_percent_of_goal', { pct: Math.min(999, Math.round((hover.seconds / goalSeconds) * 100)) })}
                  </p>
                )}
              </div>
            );
          })()}

          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
            <span>{t('tm_less')}</span>
            {LEVEL_BG.map((c, i) => (
              <span key={i} className={`w-[10px] h-[10px] rounded-[2px] ${c}`} />
            ))}
            <span>{t('tm_more')}</span>
          </div>
        </div>
      )}
    </section>
  );
}
