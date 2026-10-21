import { cn } from "@/lib/utils";

export interface FilterChipOption {
  value: string;
  label: string;
}

interface FilterChipsProps {
  options: FilterChipOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Horizontal, scrollable pill filters used on the mobile list screens.
 * Purely presentational — no data logic.
 */
export function FilterChips({ options, value, onChange, className }: FilterChipsProps) {
  return (
    <div
      className={cn(
        "relative z-20 -mx-4 flex gap-2 overflow-x-auto px-4 py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}

    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full px-4 text-[13px] transition-colors",
              active
                ? "bg-accent text-primary ring-1 ring-primary/60"
                : "bg-accent/60 text-muted-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
