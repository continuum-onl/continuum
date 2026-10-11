import { useRef, useState } from "react";
import { AVAILABLE_LANGUAGES, useLanguage, Language } from "@/contexts/LanguageContext";
import { GlobeAltIcon } from "@heroicons/react/24/outline";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  compact?: boolean;
}

export function LanguageSelector({ compact = false }: Props) {
  const { language, setLanguage, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const selectingLanguage = useRef(false);

  const handleValueChange = (value: string) => {
    selectingLanguage.current = true;
    void setLanguage(value as Language);
    queueMicrotask(() => {
      selectingLanguage.current = false;
    });
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && selectingLanguage.current) return;
    setOpen(nextOpen);
  };

  if (compact) {
    return (
      <Select
        value={language}
        open={open}
        onOpenChange={handleOpenChange}
        onValueChange={handleValueChange}
      >
        <SelectTrigger
          aria-label={t("common_chooseLanguage")}
          className="h-7 w-7 border-0 bg-transparent px-0 py-0 text-muted-foreground shadow-none transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus:ring-0 focus:ring-offset-0 data-[state=open]:bg-foreground/[0.08]"
        >
          <GlobeAltIcon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden="true" />
        </SelectTrigger>
        <SelectContent className="border border-border/10 bg-background/50 text-foreground backdrop-blur-md shadow-2xl">
          {AVAILABLE_LANGUAGES.map((l) => (
            <SelectItem
              key={l.code}
              value={l.code}
              className="text-xs text-muted-foreground focus:bg-foreground/10 focus:text-foreground"
              onSelect={(event) => event.preventDefault()}
            >
              {l.nativeLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <div className="flex h-16 items-center gap-4 border-b border-border/10 py-0 transition-colors last:border-b-0 hover:text-foreground">
      <GlobeAltIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 text-left">
        <p className="text-sm font-medium text-foreground/80">{t("profile_language")}</p>
      </div>
      <Select
        value={language}
        open={open}
        onOpenChange={handleOpenChange}
        onValueChange={handleValueChange}
      >
        <SelectTrigger className="h-8 w-[140px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AVAILABLE_LANGUAGES.map((l) => (
            <SelectItem
              key={l.code}
              value={l.code}
              className="text-xs"
              onSelect={(event) => event.preventDefault()}
            >
              {l.nativeLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
