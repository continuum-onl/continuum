import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { usePwaInstall } from "@/hooks/usePwaInstall";

/** Manual install entry point (Profile page). */
export default function InstallAppButton() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const { available, canInstall, installed, isIos, promptInstall } = usePwaInstall();
  const [busy, setBusy] = useState(false);

  if (installed) {
    return (
      <p className="text-xs text-muted-foreground">{t("pwa_installed")}</p>
    );
  }

  const handle = async () => {
    if (isIos && !canInstall) {
      toast({ title: t("pwa_ios_title"), description: t("pwa_ios_desc"), variant: "info" });
      return;
    }

    setBusy(true);
    const outcome = await promptInstall();
    setBusy(false);
    if (outcome === "unavailable") {
      toast({
        title: t("pwa_unavailable"),
        description: t("pwa_unavailable"),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground/80">{t("pwa_profile_label")}</p>
        <p className="text-xs text-muted-foreground">{t("pwa_profile_hint")}</p>
      </div>
      <Button size="sm" variant="outline" onClick={handle} disabled={busy}>
        {busy ? t("pwa_installing") : t("pwa_install")}
      </Button>
    </div>
  );
}
