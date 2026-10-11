import { useRef, useState } from "react";
import { SwatchIcon } from "@heroicons/react/24/outline";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useToast } from "@/hooks/use-toast";
import { APP_THEMES } from "@/lib/app-theme";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function AppThemeSelector() {
  const { theme, setTheme } = useTheme();
  const { t } = useLanguage();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const selectingTheme = useRef(false);

  const handleChange = async (value: string) => {
    if (!APP_THEMES.some((themeOption) => themeOption === value)) return;
    try {
      await setTheme(value === "CHARCOAL" || value === "LIGHT" ? value : "CLASSIC");
    } catch {
      toast({
        title: t("profile_updateFailed"),
        description: t("common_tryAgain"),
        variant: "destructive",
      });
    }
  };

  const handleValueChange = (value: string) => {
    selectingTheme.current = true;
    void handleChange(value);
    queueMicrotask(() => {
      selectingTheme.current = false;
    });
  };

  return (
    <div className="group -mx-3 flex h-16 w-[calc(100%+1.5rem)] items-center gap-4 rounded-md px-3 transition-colors hover:bg-secondary/75">
      <SwatchIcon className="h-5 w-5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-medium text-foreground/80 group-hover:text-foreground">
          {t("profile_theme")}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {t("profile_themeDesc")}
        </span>
      </span>
      <Select
        value={theme}
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && selectingTheme.current) return;
          setOpen(nextOpen);
        }}
        onValueChange={handleValueChange}
      >
        <SelectTrigger className="h-8 w-[140px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="CLASSIC" className="text-xs" onSelect={(event) => event.preventDefault()}>
            {t("profile_themeClassic")}
          </SelectItem>
          <SelectItem value="CHARCOAL" className="text-xs" onSelect={(event) => event.preventDefault()}>
            {t("profile_themeCharcoal")}
          </SelectItem>
          <SelectItem value="LIGHT" className="text-xs" onSelect={(event) => event.preventDefault()}>
            {t("profile_themeLight")}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
