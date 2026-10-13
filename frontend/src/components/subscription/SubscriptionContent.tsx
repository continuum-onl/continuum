import { AdaptiveCheckoutDialog } from "@/components/subscription/AdaptiveCheckoutDialog";
import { useAdaptiveCheckout } from "@/hooks/useAdaptiveCheckout";
import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { subscriptionApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useUsage } from "@/contexts/UsageContext";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
import { SubscriptionScreen } from "@/components/ui/subscription-screen";
import type { Plan } from "@/types";
import { isUnlimited } from "@/lib/plan";

interface SubInfo {
  plan?: string;
  effectivePlan?: string;
  status: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
}

interface SubscriptionContentProps {
  open: boolean;
  onClose: () => void;
}

export default function SubscriptionContent({ open, onClose }: SubscriptionContentProps) {
  const { user } = useAuth();
  const { usage } = useUsage();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const [sub, setSub] = useState<SubInfo | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [checkoutMode, setCheckoutMode] = useState(false);
  const currentPlan = ((sub?.effectivePlan || user?.plan) as Plan | string) || "FREE";
  const isPro = (currentPlan === "PRO" ? "VISION" : currentPlan) === "VISION";
  const adaptiveCheckout = useAdaptiveCheckout((open || checkoutMode) && !isPro);

  useEffect(() => {
    if (open) setCheckoutMode(false);
  }, [open]);

  const visionBenefits = [
    t("bill_benefit_unlimited_notes_entities"),
    t("bill_benefit_unlimited_history"),
    t("bill_benefit_storage"),
    t("bill_benefit_data_export"),
    t("bill_benefit_priority_support"),
  ];

  useEffect(() => {
    subscriptionApi.me().then(({ data }) => setSub(data)).catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("status") !== "success") return;

    let cancelled = false;
    setSyncing(true);

    const attempt = async (tries: number): Promise<void> => {
      if (cancelled) return;
      try {
        const { data } = await subscriptionApi.sync();
        if (cancelled) return;
        setSub(data);
        if (data?.effectivePlan && data.effectivePlan !== "FREE") {
          setSyncing(false);
          toast({ title: t("bill_success") || "Plan activated" });
          return;
        }
      } catch {
        // Keep retrying while Stripe and the webhook settle.
      }
      if (tries <= 1) {
        setSyncing(false);
        return;
      }
      setTimeout(() => attempt(tries - 1), 2500);
    };

    attempt(5);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatLimit = (value?: number, suffix = "") => {
    if (value === undefined) return "—";
    return isUnlimited(value) ? "∞" : `${value}${suffix}`;
  };
  const formatUsageLimit = (used: number | undefined, limit: number | undefined, suffix = "") => {
    if (limit === undefined) return "—";
    const formattedUsed = used === undefined ? "—" : suffix === " MB" ? used.toFixed(1) : String(Math.round(used));
    return `${formattedUsed}/${formatLimit(limit)}${suffix}`;
  };
  const planDetails = !isPro ? [
    { label: t("bill_notes"), value: formatUsageLimit(usage?.notesCount, user?.maxNotes) },
    { label: t("bill_entities"), value: formatUsageLimit(usage?.entitiesCount, user?.maxEntities) },
    { label: t("bill_history"), value: formatLimit(user?.historyDays, "d") },
    { label: t("bill_vault"), value: formatUsageLimit(usage?.vaultSizeMB, user?.maxVaultSizeMB, " MB") },
  ] : undefined;

  const handleCheckout = () => {
    setCheckoutMode(true);
    onClose();
    adaptiveCheckout.openCheckout();
  };

  const handlePortal = async () => {
    setPortalLoading(true);
    try {
      const { data } = await subscriptionApi.portal();
      if (data?.url) window.location.href = data.url;
    } catch (err: unknown) {
      const message = isAxiosError<{ message?: string }>(err)
        ? err.response?.data?.message || t("bill_portal_error")
        : t("bill_portal_error");
      toast({ title: t("bill_error"), description: message, variant: "destructive" });
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex min-h-[100dvh] w-full items-end justify-center overflow-y-auto bg-black/70 p-0 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            const target = event.target as HTMLElement;
            if (!target.closest("[data-subscription-panel]")) onClose();
          }}
        >
          <SubscriptionScreen
            headerImageSrc={theme === "LIGHT" ? "/vision-symbol-light.png" : "/vision-symbol.png"}
            appName="Continuum"
            planType="VISION"
            features={visionBenefits.map((text) => ({ text }))}
            pricingOptions={[{
              id: "monthly",
              price: adaptiveCheckout.price === "…" ? t("bill_price_localized_in_checkout") : adaptiveCheckout.price,
              period: t("bill_per_month"),
              loading: adaptiveCheckout.loading && adaptiveCheckout.price === "…",
              loadingLabel: t("bill_price_refreshing"),
            }]}
            defaultPlanId="monthly"
            subscribeButtonText={isPro ? (portalLoading ? t("bill_opening") : t("bill_manage_billing")) : t("bill_upgrade_to_vision")}
            footerText={syncing ? "Confirming your payment with Stripe…" : t("bill_cancel_secure")}
            currentPlanText={`${t("bill_current")}: ${isPro ? "VISION" : "FREE"}${sub?.status ? ` · ${sub.status.toLowerCase()}` : ""}`}
            planDetails={planDetails}
            onSubscribe={isPro ? handlePortal : handleCheckout}
          />
        </div>
      )}
      <AdaptiveCheckoutDialog state={adaptiveCheckout} />
    </>
  );
}
