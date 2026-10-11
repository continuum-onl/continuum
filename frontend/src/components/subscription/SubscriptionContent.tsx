import { useVisionPrice } from "@/hooks/useVisionPrice";
import { useEffect, useState } from "react";
import api, { subscriptionApi } from "@/lib/api";
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

export default function SubscriptionContent() {
  const { user } = useAuth();
  const { usage } = useUsage();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const visionPrice = useVisionPrice();
  const [sub, setSub] = useState<SubInfo | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [prices, setPrices] = useState<{ monthly?: string }>({});

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

  useEffect(() => {
    api.get("/api/plans/prices")
      .then(({ data }) => setPrices({ monthly: data?.vision?.monthly }))
      .catch(() => {});
  }, []);

  const currentPlan = ((sub?.effectivePlan || user?.plan) as Plan | string) || "FREE";
  const isPro = (currentPlan === "PRO" ? "VISION" : currentPlan) === "VISION";
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

  const handleCheckout = async () => {
    if (!prices.monthly || !prices.monthly.startsWith("price_")) {
      toast({ title: t("bill_error"), description: "Subscription pricing is not configured yet.", variant: "destructive" });
      return;
    }
    setCheckoutLoading(true);
    try {
      const { data } = await subscriptionApi.checkout(prices.monthly);
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      toast({ title: t("bill_error"), description: err.response?.data?.message || t("bill_try_again"), variant: "destructive" });
      setCheckoutLoading(false);
    }
  };

  const handlePortal = async () => {
    setPortalLoading(true);
    try {
      const { data } = await subscriptionApi.portal();
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      toast({ title: t("bill_error"), description: err.response?.data?.message || t("bill_portal_error"), variant: "destructive" });
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] w-full items-end justify-center">
      <SubscriptionScreen
        headerImageSrc={theme === "LIGHT" ? "/vision-symbol-light.png" : "/vision-symbol.png"}
        appName="Continuum"
        planType="VISION"
        features={visionBenefits.map((text) => ({ text }))}
        pricingOptions={[{ id: "monthly", price: visionPrice, period: t("bill_per_month") }]}
        defaultPlanId="monthly"
        subscribeButtonText={isPro ? (portalLoading ? t("bill_opening") : t("bill_manage_billing")) : checkoutLoading ? t("bill_opening") : t("bill_upgrade_to_vision")}
        footerText={syncing ? "Confirming your payment with Stripe…" : t("bill_cancel_secure")}
        currentPlanText={`${t("bill_current")}: ${isPro ? "VISION" : "FREE"}${sub?.status ? ` · ${sub.status.toLowerCase()}` : ""}`}
        planDetails={planDetails}
        onSubscribe={isPro ? handlePortal : handleCheckout}
      />
    </div>
  );
}
