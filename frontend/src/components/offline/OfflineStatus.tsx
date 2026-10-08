import { useState } from "react";
import { Cloud, CloudOff, RefreshCw, AlertCircle } from "@/lib/heroicons";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOfflineStatus } from "@/hooks/use-offline-status";
import { useLanguage } from "@/contexts/LanguageContext";
import { flushQueue } from "@/lib/offline/sync";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface OfflineStatusProps {
  className?: string;
  compact?: boolean;
}

export function OfflineStatus({ className, compact = false }: OfflineStatusProps) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const { status, pending, syncing } = useOfflineStatus();
  const [forcing, setForcing] = useState(false);

  const effectiveStatus = syncing ? "syncing" : status;

  const handleSyncNow = async () => {
    if (!navigator.onLine) {
      toast({ title: t("gr_toast_offline"), variant: "destructive" });
      return;
    }
    setForcing(true);
    try {
      const result = await flushQueue();
      if (result.sent === 0 && result.failed === 0) {
        toast({ title: t("gr_toast_uptodate"), variant: "info" });
      } else if (result.failed === 0) {
        toast({ title: t("gr_toast_synced", { count: result.sent, plural: result.sent === 1 ? "" : "s" }) });
      } else {
        toast({ title: t("gr_toast_partial", { sent: result.sent, failed: result.failed }), variant: "destructive" });
      }
    } catch {
      toast({ title: t("gr_toast_sync_failed"), variant: "destructive" });
    } finally {
      setForcing(false);
    }
  };

  const label =
    effectiveStatus === "offline"
      ? pending > 0
        ? t("gr_offline_pending", { count: pending })
        : t("gr_offline")
      : effectiveStatus === "syncing"
        ? t("gr_syncing")
        : effectiveStatus === "error"
          ? pending > 0
            ? t("gr_sync_issue", { count: pending })
            : t("gr_sync_issue_nopending")
          : pending > 0
            ? t("gr_pending", { count: pending })
            : t("gr_online");

  const Icon =
    effectiveStatus === "offline"
      ? CloudOff
      : effectiveStatus === "error"
        ? AlertCircle
        : effectiveStatus === "syncing"
          ? RefreshCw
          : Cloud;

  // Hide pill when fully online with nothing pending and no error (compact mode).
  if (compact && effectiveStatus === "online" && pending === 0) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleSyncNow}
          disabled={forcing || syncing}
          className={cn(
            "h-7 gap-1.5 rounded-full px-2.5 text-xs font-normal",
            effectiveStatus === "offline" && "text-amber-500",
            effectiveStatus === "error" && "text-destructive",
            effectiveStatus === "syncing" && "text-muted-foreground",
            className
          )}
        >
          <Icon className={cn("h-3.5 w-3.5", (syncing || forcing) && "animate-spin")} />
          <span className="hidden sm:inline">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <div className="text-xs">
          {effectiveStatus === "offline"
            ? t("gr_tooltip_offline")
            : t("gr_tooltip_click_sync")}
          {pending > 0 && (
            <div className="mt-1 text-muted-foreground">{t("gr_tooltip_pending", { count: pending, plural: pending === 1 ? "" : "s" })}</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export default OfflineStatus;
