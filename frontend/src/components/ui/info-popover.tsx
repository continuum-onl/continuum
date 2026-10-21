import type { MouseEventHandler, ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface InfoPopoverProps {
  description: string;
  icon?: ReactNode;
  iconColor?: string;
  className?: string;
  onTriggerClick?: MouseEventHandler<HTMLButtonElement>;
}

export function InfoPopover({ description, icon, iconColor, className, onTriggerClick }: InfoPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={description}
          onClick={onTriggerClick}
          className={cn(
            "inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <span aria-hidden="true" className="inline-flex items-center justify-center" style={{ color: iconColor }}>
            {icon ?? <span className="text-xs font-semibold italic">i</span>}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-64 border-border/10 bg-muted/60 p-3 text-xs font-mono backdrop-blur-[6px] supports-[backdrop-filter]:bg-muted/60">
        {description}
      </PopoverContent>
    </Popover>
  );
}
