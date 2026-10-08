import { useVisionPrice } from "@/hooks/useVisionPrice";
import { useEffect, useMemo, useState } from "react";
import api, { plansApi, subscriptionApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { isUnlimited } from "@/lib/plan";
import { type Plan, type PlanLimits } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ArrowPathIcon,
  ArrowRightIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";

interface SubInfo {
  plan?: string;
  effectivePlan?: string;
  status: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Subscription surface rendered as a modal on top of the current screen.
 * Keeps the same visual identity as the rest of the app.
 */
export default function SubscriptionModal({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();
  const visionPrice = useVisionPrice();
  const [sub, setSub] = useState<SubInfo | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [plans, setPlans] = useState<Array<{ plan: Plan; limits: PlanLimits; priceId?: string }>>([]);
  const [prices, setPrices] = useState<{ monthly?: string }>({});

  const VISION_BENEFITS = [
    t("bill_benefit_unlimited_notes_entities"),
    t("bill_benefit_unlimited_history"),
    t("bill_benefit_storage"),
    t("bill_benefit_data_export"),
    t("bill_benefit_priority_support"),
  ];

  useEffect(() => {
    if (!open) return;
    subscriptionApi.me().then(({ data }) => setSub(data)).catch(() => {});
    api
      .get("/api/plans/prices")
      .then(({ data }) => setPrices({ monthly: data?.vision?.monthly }))
      .catch(() => {});
  }, [open]);

  const currentPlan = ((sub?.effectivePlan || user?.plan) as Plan | string) || "FREE";
  const normalizedPlan = currentPlan === "PRO" ? ("VISION" as Plan) : (currentPlan as Plan);
  const isPro = normalizedPlan === "VISION";


  const handleCheckout = async () => {
    setCheckoutLoading(true);
    try {
      const { data } = await subscriptionApi.checkout(prices.monthly || "VISION");
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      toast({
        title: t("bill_error"),
        description: err.response?.data?.message || t("bill_try_again"),
        variant: "destructive",
      });
      setCheckoutLoading(false);
    }
  };

  const handlePortal = async () => {
    setPortalLoading(true);
    try {
      const { data } = await subscriptionApi.portal();
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      toast({
        title: t("bill_error"),
        description: err.response?.data?.message || t("bill_portal_error"),
        variant: "destructive",
      });
    } finally {
      setPortalLoading(false);
    }
  };

  const formatLimit = (val?: number, suffix = "") =>
    val === undefined ? "—" : isUnlimited(val) ? "∞" : `${val}${suffix}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-y-auto p-0">
        <div className="px-6 pb-6 pt-8 sm:px-8">
          <DialogHeader className="space-y-0 text-left">
            <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
              {t("bill_plans_billing")}
            </p>
            <div className="mt-2 flex items-start justify-between gap-4">
              <DialogTitle className="font-serif text-4xl tracking-tight text-foreground">
                VISION
              </DialogTitle>
              <div className="text-right">
                <p className="font-serif text-3xl text-foreground">{visionPrice}</p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
                  {t("bill_per_month")}
                </p>
              </div>
            </div>
            <DialogDescription className="mt-4 text-sm leading-relaxed text-muted-foreground">
              {t("bill_vision_tagline")}
            </DialogDescription>
          </DialogHeader>

          {/* Current status */}
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-border/10 pt-4">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
                {t("bill_current")}
              </span>
              <span className="text-sm text-foreground">{isPro ? "VISION" : "FREE"}</span>
              {sub?.status && (
                <span className="text-xs text-muted-foreground">· {sub.status.toLowerCase()}</span>
              )}
            </div>
            {isPro && (
              <Button
                variant="quiet"
                size="xs"
                onClick={handlePortal}
                disabled={portalLoading}
                className="normal-case"
              >
                {portalLoading ? t("bill_opening") : t("bill_manage_billing")}
              </Button>
            )}
          </div>

          <ul className="mt-5 space-y-3 border-t border-border/10 pt-5">
            {VISION_BENEFITS.map((b) => (
              <li key={b} className="flex items-start gap-3 text-sm text-foreground/80">
                <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <div className="mt-5 border-t border-border/10 pt-5">
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{t("bill_your_limits")}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-4">
              {[
                { k: t("bill_notes"), v: formatLimit(user?.maxNotes) },
                { k: t("bill_entities"), v: formatLimit(user?.maxEntities) },
                { k: t("bill_vault"), v: formatLimit(user?.maxVaultSizeMB, " MB") },
                { k: t("bill_history"), v: formatLimit(user?.historyDays, "d") },
              ].map((row) => (
                <div key={row.k}>
                  <dt className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{row.k}</dt>
                  <dd className="mt-1 font-serif text-lg tabular-nums text-foreground/90">{row.v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="mt-6 space-y-3">
            {isPro ? (
              <div className="flex h-11 items-center justify-center rounded-sm border border-dashed border-border/10 text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
                {t("bill_active")}
              </div>
            ) : (
              <Button
                type="button"
                variant="white"
                size="lg"
                onClick={handleCheckout}
                disabled={checkoutLoading}
                className="group w-full justify-center gap-2"
              >
                {checkoutLoading ? (
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    {t("bill_upgrade_to_vision")}
                    <ArrowRightIcon className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </Button>
            )}
            <p className="text-center text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              {t("bill_cancel_secure")}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
