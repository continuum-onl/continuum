import { useEffect, useId, useRef, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "@/lib/heroicons";
import { cn } from "@/lib/utils";

interface ExpandableEntityDescriptionProps {
  description: string;
  className?: string;
  onEdit?: () => void;
}

export function ExpandableEntityDescription({ description, className, onEdit }: ExpandableEntityDescriptionProps) {
  const { t } = useLanguage();
  const paragraphId = useId();
  const paragraphRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const visibleDescription = description;

  useEffect(() => {
    setExpanded(false);
  }, [visibleDescription]);

  useEffect(() => {
    if (expanded) return;
    const paragraph = paragraphRef.current;
    if (!paragraph) return;

    const measureOverflow = () => setOverflows(paragraph.scrollHeight > paragraph.clientHeight + 1);
    measureOverflow();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measureOverflow);
      return () => window.removeEventListener("resize", measureOverflow);
    }

    const observer = new ResizeObserver(measureOverflow);
    observer.observe(paragraph);
    return () => observer.disconnect();
  }, [visibleDescription, expanded]);

  return (
    <div className="flex min-w-0 items-start gap-1">
      <p
        id={paragraphId}
        ref={paragraphRef}
        className={cn(
          "min-w-0 flex-1 whitespace-pre-wrap break-words",
          onEdit && "cursor-text",
          className,
        )}
        style={!expanded ? {
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflow: "hidden",
        } : undefined}
        onClick={onEdit}
        onKeyDown={onEdit ? (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onEdit();
          }
        } : undefined}
        role={onEdit ? "button" : undefined}
        tabIndex={onEdit ? 0 : undefined}
        aria-label={onEdit ? t("ent_edit_description") : undefined}
      >
        {visibleDescription}
      </p>
      {overflows && (
        <Button
          type="button"
          variant="quiet"
          size="iconSm"
          className="mt-[-3px] shrink-0 rounded-full"
          aria-label={t(expanded ? "ent_show_less" : "ent_show_more")}
          title={t(expanded ? "ent_show_less" : "ent_show_more")}
          aria-expanded={expanded}
          aria-controls={paragraphId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? <ChevronUp /> : <ChevronDown />}
        </Button>
      )}
    </div>
  );
}
