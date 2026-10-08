import { useMemo } from "react";
import { Calendar as Cal, CalendarCell, CalendarGrid, CalendarGridBody, CalendarGridHeader, CalendarHeaderCell, Heading, Button as RACButton } from "react-aria-components";
import { getLocalTimeZone, today } from "@internationalized/date";
import { ChevronLeftIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

interface ActivityAnalyticsCalendarProps {
  trackingDates?: string[];
  historyDays?: number;
}

export function ActivityAnalyticsCalendar({ trackingDates = [] }: ActivityAnalyticsCalendarProps) {
  const { t } = useLanguage();
  const completionSet = useMemo(() => {
    const s = new Set<string>();
    trackingDates.forEach((d) => s.add(d.split("T")[0]));
    return s;
  }, [trackingDates]);

  const now = today(getLocalTimeZone());

  const stats = useMemo(() => {
    const ymCurrent = `${now.year}-${String(now.month).padStart(2, "0")}`;
    let monthActive = 0;
    completionSet.forEach((d) => {
      if (d.startsWith(ymCurrent)) monthActive += 1;
    });
    const daysInMonth = now.calendar.getDaysInMonth(now);
    return {
      total: trackingDates.length,
      monthActive,
      monthPct: daysInMonth ? Math.round((monthActive / daysInMonth) * 100) : 0,
    };
  }, [completionSet, trackingDates.length, now]);

  return (
    <div className="space-y-6">
      {/* Completion Summary — minimal, app-aligned */}
      <div className="py-5">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground font-mono">{t("tm_completion")}</p>
            <h3 className="mt-1 font-serif text-xl text-foreground">{t("tm_summary")}</h3>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {now.toDate(getLocalTimeZone()).toLocaleString(undefined, { month: "short", year: "numeric" })}
          </span>
        </div>

        <div className="grid grid-cols-3 divide-x divide-border/10 border-y border-border/10">
          <SummaryStat label={t("tm_total")} value={stats.total} />
          <SummaryStat label={t("tm_this_month")} value={stats.monthActive} />
          <SummaryStat label={t("tm_month_rate")} value={`${stats.monthPct}%`} />
        </div>
      </div>


      {/* Calendar */}
      <div className="py-5">
        <Cal aria-label={t("tm_activity_calendar_label")} className="w-full">
          <header className="flex items-center gap-1 pb-3 sm:pb-4">
            <RACButton
              slot="previous"
              className="flex size-8 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </RACButton>
            <Heading className="grow px-2 text-center font-mono text-[10px] uppercase leading-snug tracking-[0.18em] text-muted-foreground sm:text-[11px] sm:tracking-[0.28em]" />
            <RACButton
              slot="next"
              className="flex size-8 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </RACButton>
          </header>

          <CalendarGrid className="w-full [&_table]:w-full [&_table]:border-collapse">
            <CalendarGridHeader>
              {(day) => (
                <CalendarHeaderCell className="pb-2 sm:pb-2 md:pb-3 font-mono text-[8px] sm:text-[9px] md:text-[9px] uppercase tracking-widest text-muted-foreground">
                  {day}
                </CalendarHeaderCell>
              )}
            </CalendarGridHeader>
            <CalendarGridBody className="[&_td]:p-0.5 [&_tr:not(:last-child)]:mb-1">
              {(date) => {
                const dateStr = date.toString();
                const isCompleted = completionSet.has(dateStr);
                const isToday = date.compare(now) === 0;
                return (
                  <CalendarCell
                    date={date}
                    className={cn(
                      "relative mx-auto flex aspect-square w-full max-w-9 sm:max-w-10 md:max-w-11 items-center justify-center rounded-sm border text-xs outline-none transition-colors",
                      "data-[outside-month]:opacity-30 data-[focus-visible]:ring-1 data-[focus-visible]:ring-ring",
                      isCompleted
                        ? "border-border/30 bg-foreground/15 text-foreground"
                        : "border-border/5 bg-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                      isToday && !isCompleted && "border-border/40 text-foreground",
                    )}
                  />
                );
              }}
            </CalendarGridBody>
          </CalendarGrid>
        </Cal>

        {/* Legend */}
        <div className="mt-5 flex flex-wrap items-center justify-start gap-x-4 gap-y-2 border-t border-border/10 pt-4 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground sm:justify-end sm:text-[10px] sm:tracking-widest">
          <div className="flex items-center gap-2">
            <span className="block size-3 rounded-sm border border-border/5 bg-transparent" />
            <span>{t("tm_empty")}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="block size-3 rounded-sm border border-border/40" />
            <span>{t("tm_today_cap")}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="block size-3 rounded-sm border border-border/30 bg-foreground/20" />
            <span>{t("tm_done")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value, suffix }: { label: string; value: string | number; suffix?: string }) {
  return (
    <div className="min-w-0 px-3 py-3 sm:px-4 sm:py-4">
      <p className="whitespace-normal break-words font-mono text-[8px] uppercase leading-snug tracking-[0.1em] text-muted-foreground sm:text-[9px] sm:tracking-[0.22em]">{label}</p>
      <p className="mt-2 break-words font-serif text-xl text-foreground tabular-nums sm:text-2xl">
        {value}
        {suffix ? <span className="ml-1 text-xs text-muted-foreground font-sans">{suffix}</span> : null}
      </p>
    </div>
  );
}
