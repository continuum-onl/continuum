import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Settings-style titled group used across the entity detail screen. */
export function EntitySection({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.24em] text-muted-foreground">{title}</h2>
        {aside && <span className="text-xs text-muted-foreground/70 tabular-nums">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** Compact row of headline numbers under the title. */
export function EntityStatRow({ stats }: { stats: { label: string; value: ReactNode }[] }) {
  return (
    <div className="grid grid-cols-3 divide-x divide-border/10 rounded-2xl border border-border/10 bg-secondary/40">
      {stats.map((s) => (
        <div key={s.label} className="min-w-0 px-3 py-3 sm:px-4">
          <div className="truncate font-serif text-lg leading-tight text-foreground tabular-nums sm:text-xl">{s.value}</div>
          <div className="mt-1 truncate text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Notes-list style row linking to a note or another entity. */
export function EntityLinkRow({ icon, title, meta, onClick }: { icon: ReactNode; title: string; meta?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-border/10 px-1 py-3 text-left transition-colors last:border-b-0 hover:bg-foreground/[0.03]"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-secondary/60 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{title}</span>
        {meta && <span className="block truncate text-xs text-muted-foreground">{meta}</span>}
      </span>
    </button>
  );
}

/** Consecutive tracked days ending today (or yesterday, if today isn't tracked yet). */
export function currentStreak(dates: string[] | undefined, today: string): number {
  const set = new Set((dates ?? []).map((d) => d.slice(0, 10)));
  const cursor = new Date(`${today}T00:00:00Z`);
  if (!set.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let n = 0;
  while (set.has(cursor.toISOString().slice(0, 10))) {
    n++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return n;
}
