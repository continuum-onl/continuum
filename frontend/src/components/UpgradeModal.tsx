import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAdaptiveCheckout } from "@/hooks/useAdaptiveCheckout";
import { AdaptiveCheckoutDialog } from "@/components/subscription/AdaptiveCheckoutDialog";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

interface UpgradeModalProps { open: boolean; onOpenChange: (open: boolean) => void; reason?: string; }

export default function UpgradeModal({ open, onOpenChange, reason }: UpgradeModalProps) {
  const { t } = useLanguage();
  const [checkoutMode, setCheckoutMode] = useState(false);
  const adaptiveCheckout = useAdaptiveCheckout(open || checkoutMode);
  const priceLoading = adaptiveCheckout.loading && adaptiveCheckout.price === "…";
  const displayedPrice = adaptiveCheckout.price === "…"
    ? t("bill_price_localized_in_checkout")
    : adaptiveCheckout.price;

  useEffect(() => {
    if (open) setCheckoutMode(false);
  }, [open]);

  const VISION_FEATURES = [
    t("bill_feature_unlimited_entities"),
    t("bill_feature_unlimited_notes"),
    t("bill_feature_unlimited_history"),
    t("bill_feature_vault_storage"),
    t("bill_feature_advanced_metrics"),
    t("bill_feature_export_calendar"),
  ];

  const handleCheckout = () => {
    setCheckoutMode(true);
    onOpenChange(false);
    adaptiveCheckout.openCheckout();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md border-border/10 bg-background/95 backdrop-blur-xl">
          <DialogHeader>
            <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">{t("bill_upgrade")}</p>
            <DialogTitle className="font-serif text-3xl tracking-tight text-foreground">
              {t("bill_unlock_vision")}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {reason || t("bill_free_limit_reached")}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 space-y-4 rounded-sm border border-border/15 bg-foreground/[0.02] p-5">
            <div>
              <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">Vision</p>
              <p className="mt-1 font-serif text-3xl text-foreground">
                {priceLoading ? (
                  <Loader2 className="inline h-6 w-6 animate-spin text-muted-foreground" aria-label={t("bill_price_refreshing")} />
                ) : (
                  displayedPrice
                )}
                <span className="text-xs text-muted-foreground">/{t("bill_per_month")}</span>
              </p>
            </div>
            <ul className="space-y-1.5 border-t border-border/10 pt-3">
              {VISION_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span aria-hidden className="mt-2 h-px w-2 bg-foreground/40" /> {f}
                </li>
              ))}
            </ul>
            <button
              onClick={handleCheckout}
              className="flex w-full items-center justify-center gap-2 rounded-sm border border-border/10 bg-foreground px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-background transition-colors hover:bg-foreground/90"
            >
              {t("bill_upgrade_to_vision")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <AdaptiveCheckoutDialog state={adaptiveCheckout} />
    </>
  );
}
