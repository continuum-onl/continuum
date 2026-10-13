import { useCallback, useEffect, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { isAxiosError } from "axios";
import { subscriptionApi } from "@/lib/api";
import {
  cacheAdaptivePrice,
  clearCachedAdaptivePrice,
  readCachedAdaptivePrice,
} from "@/lib/adaptive-price-cache";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import type { Language } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";

type StripeInstance = NonNullable<Awaited<ReturnType<typeof loadStripe>>>;
type CheckoutSdk = ReturnType<StripeInstance["initCheckoutElementsSdk"]>;
type LoadActionsResult = Awaited<ReturnType<CheckoutSdk["loadActions"]>>;
type CheckoutActions = Extract<LoadActionsResult, { type: "success" }>["actions"];
type CheckoutSession = ReturnType<CheckoutActions["getSession"]>;

let stripeConfigPromise: Promise<string> | null = null;
const stripeClientPromises = new Map<Language, Promise<StripeInstance | null>>();

function getStripeLocale(language: Language) {
  switch (language) {
    case "en": return "en";
    case "es": return "es";
    case "pt": return "pt-BR";
    case "fr": return "fr";
  }
}

async function getStripeClient(language: Language): Promise<StripeInstance | null> {
  const cached = stripeClientPromises.get(language);
  if (cached) return cached;

  if (!stripeConfigPromise) {
    stripeConfigPromise = subscriptionApi.checkoutConfig().then(({ data }) => {
      if (!data.publishableKey) {
        throw new Error("Stripe did not return the publishable key needed for checkout.");
      }
      return data.publishableKey;
    });
  }

  const pending = stripeConfigPromise.then((publishableKey) =>
    loadStripe(publishableKey, { locale: getStripeLocale(language) }),
  );
  stripeClientPromises.set(language, pending);
  try {
    const client = await pending;
    if (!client) throw new Error("Stripe.js could not be initialized.");
    return client;
  } catch (error) {
    if (stripeClientPromises.get(language) === pending) stripeClientPromises.delete(language);
    if (stripeClientPromises.size === 0) stripeConfigPromise = null;
    throw error;
  }
}

function getStripeAppearance(theme: string) {
  const rootStyles = getComputedStyle(document.documentElement);
  const bodyStyles = getComputedStyle(document.body);
  const token = (name: string, fallback: string) => rootStyles.getPropertyValue(name).trim() || fallback;

  return {
    theme: theme === "LIGHT" ? "stripe" as const : "night" as const,
    variables: {
      fontFamily: bodyStyles.fontFamily,
      colorPrimary: token("--accent-solid", "#F3F1EB"),
      colorBackground: token("--bg-surface", "#0D0D0D"),
      colorText: token("--text-primary", "#EAE8E2"),
      colorTextSecondary: token("--text-secondary", "#A3A19B"),
      colorTextPlaceholder: token("--text-tertiary", "#726F69"),
      colorBorder: token("--bg-active", "#292929"),
      colorDanger: token("--danger-color", "#F0616D"),
      borderRadius: token("--radius-md", "8px"),
    },
  };
}

function getRecurringPrice(session: CheckoutSession): string {
  const amount = session.recurring?.dueNext.total.amount ?? session.lineItems[0]?.unitAmount.amount;
  if (!amount) throw new Error("Stripe did not return the localized subscription price.");
  return amount;
}

export function useAdaptiveCheckout(enabled = true) {
  const { toast } = useToast();
  const { language, t } = useLanguage();
  const { theme } = useTheme();
  const translateRef = useRef(t);
  translateRef.current = t;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const [price, setPrice] = useState(() => enabled ? readCachedAdaptivePrice(language) ?? "…" : "…");
  const [checkout, setCheckout] = useState<CheckoutSdk | null>(null);
  const [actions, setActions] = useState<CheckoutActions | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const hasOpenedCheckout = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let initializationTimedOut = false;
    setLoading(true);
    setError(null);
    setPrice(readCachedAdaptivePrice(language) ?? "…");
    setCheckout(null);
    setActions(null);

    const initialize = async () => {
      const [checkoutResponse, stripe] = await Promise.all([
        subscriptionApi.checkoutEmbedded("VISION"),
        getStripeClient(language),
      ]);
      const { data } = checkoutResponse;
      if (!data.clientSecret) {
        throw new Error("Stripe did not return the credentials needed for localized checkout.");
      }
      if (!stripe) throw new Error("Stripe.js could not be initialized.");

      const instance = stripe.initCheckoutElementsSdk({
        clientSecret: data.clientSecret,
        adaptivePricing: { allowed: true },
        elementsOptions: {
          appearance: getStripeAppearance(themeRef.current),
          loader: "always",
        },
      });
      const result = await instance.loadActions();
      if (result.type === "error") throw new Error(result.error.message);

      const initialSession = result.actions.getSession();
      const initialPrice = getRecurringPrice(initialSession);
      if (cancelled || initializationTimedOut) return;

      cacheAdaptivePrice(language, initialPrice);
      setPrice(initialPrice);
      setCheckout(instance);
      setActions(result.actions);
      instance.on("change", (session) => {
        if (!cancelled) {
          try {
            const updatedPrice = getRecurringPrice(session);
            cacheAdaptivePrice(language, updatedPrice);
            setPrice(updatedPrice);
            setError(null);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Stripe could not update the localized price.");
          }
        }
      });
    };

    let timeoutId: number | undefined;
    const initializationTimeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        initializationTimedOut = true;
        reject(new Error(translateRef.current("bill_checkout_load_error")));
      }, 30000);
    });
    Promise.race([
      initialize(),
      initializationTimeout,
    ])
      .catch((cause: unknown) => {
        if (!cancelled) {
          clearCachedAdaptivePrice(language);
          setPrice("…");
          const message = isAxiosError<{ message?: string }>(cause)
            ? cause.response?.data?.message ?? cause.message
            : cause instanceof Error
              ? cause.message
              : "Could not load localized Stripe pricing.";
          setError(message);
          toast({ title: translateRef.current("bill_error"), description: message, variant: "destructive" });
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [attempt, enabled, language, toast]);

  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    setPrice(readCachedAdaptivePrice(language) ?? "…");
    setCheckout(null);
    setActions(null);
    setAttempt((current) => current + 1);
  }, [language]);

  const openCheckout = useCallback(() => {
    const hasExistingCheckout = hasOpenedCheckout.current;
    hasOpenedCheckout.current = true;
    setOpen(true);
    if (error || hasExistingCheckout) retry();
  }, [error, retry]);

  return {
    price,
    checkout,
    actions,
    loading,
    error,
    retry,
    open,
    setOpen,
    openCheckout,
  };
}
