import { useEffect, useId, useRef, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { MAX_ENTITY_DESCRIPTION_LENGTH } from "@/lib/entity-description";
import { cn } from "@/lib/utils";

interface ExpandableEntityDescriptionProps {
  description: string;
  className?: string;
}

export function ExpandableEntityDescription({ description, className }: ExpandableEntityDescriptionProps) {
  const { t } = useLanguage();
  const paragraphId = useId();
  const paragraphRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const visibleDescription = description.slice(0, MAX_ENTITY_DESCRIPTION_LENGTH);

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
    <div className="min-w-0">
      <p
        id={paragraphId}
        ref={paragraphRef}
        className={cn(
          "whitespace-pre-wrap break-words",
          !expanded && "line-clamp-2",
          className,
        )}
      >
        {visibleDescription}
      </p>
      {overflows && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0 py-1 text-xs"
          aria-expanded={expanded}
          aria-controls={paragraphId}
          onClick={() => setExpanded((current) => !current)}
        >
          {t(expanded ? "ent_show_less" : "ent_show_more")}
        </Button>
      )}
    </div>
  );
}
