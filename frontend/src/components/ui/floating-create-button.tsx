import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface FloatingCreateButtonProps {
  label: string;
  onClick: () => void;
  onLongPress?: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Mobile-only floating pill action (e.g. "New note").
 * Auto-hides while the user scrolls down and returns on scroll up.
 */
export function FloatingCreateButton({
  label,
  onClick,
  onLongPress,
  icon,
  disabled,
  className,
}: FloatingCreateButtonProps) {
  const [visible, setVisible] = useState(true);
  const [pressing, setPressing] = useState(false);
  const lastY = useRef(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  useEffect(() => {
    const handler = (e: Event) => {
      const target = e.target as HTMLElement | Document;
      const y =
        target instanceof HTMLElement ? target.scrollTop : window.scrollY || 0;
      const delta = y - lastY.current;
      if (Math.abs(delta) < 6) return;
      setVisible(delta < 0 || y < 40);
      lastY.current = y;
    };
    document.addEventListener("scroll", handler, true);
    window.addEventListener("scroll", handler, { passive: true });
    return () => {
      document.removeEventListener("scroll", handler, true);
      window.removeEventListener("scroll", handler);
      clearLongPress();
    };
  }, []);

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 z-30 flex justify-end px-4 transition-all duration-300 lg:hidden",
        visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        className,
      )}
      style={{ bottom: "calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) + 5.25rem)" }}
    >
      <button
        type="button"
        onPointerDown={(event) => {
          clearLongPress();
          longPressTriggered.current = false;
          if (
            disabled ||
            !onLongPress ||
            event.button > 0 ||
            typeof window.matchMedia !== "function" ||
            !window.matchMedia("(max-width: 1023px)").matches
          ) {
            setPressing(false);
            return;
          }
          setPressing(true);
          longPressTimer.current = setTimeout(() => {
            longPressTriggered.current = true;
            onLongPress();
          }, 700);
        }}
        onPointerUp={() => {
          clearLongPress();
          setPressing(false);
        }}
        onPointerCancel={() => {
          clearLongPress();
          setPressing(false);
        }}
        onPointerLeave={() => {
          clearLongPress();
          setPressing(false);
        }}
        onContextMenu={(event) => {
          if (longPressTriggered.current) event.preventDefault();
        }}
        onClick={() => {
          if (longPressTriggered.current) {
            longPressTriggered.current = false;
            return;
          }
          onClick();
        }}
        disabled={disabled}
        className="pointer-events-auto relative isolate inline-flex items-center gap-2 overflow-hidden rounded-full bg-foreground px-6 py-3 text-[15px] font-medium text-background shadow-[0_10px_30px_rgba(0,0,0,0.45)] transition active:scale-95 disabled:opacity-60"
      >
        {onLongPress && (
          <span
            aria-hidden="true"
            data-press-progress
            className="pointer-events-none absolute inset-0 origin-left bg-background/20"
            style={{
              transform: pressing ? "scaleX(1)" : "scaleX(0)",
              transition: pressing ? "transform 700ms linear" : "none",
            }}
          />
        )}
        <span className="relative z-10 inline-flex items-center gap-2">
          {icon}
          {label}
        </span>
      </button>
    </div>
  );
}
