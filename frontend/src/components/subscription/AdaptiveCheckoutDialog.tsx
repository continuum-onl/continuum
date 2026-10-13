import { useEffect, useRef, useState } from "react";
import type { useAdaptiveCheckout } from "@/hooks/useAdaptiveCheckout";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SmoothDrawer from "@/components/ui/smooth-drawer";
import { ArrowPathIcon } from "@heroicons/react/24/outline";

type CheckoutState = ReturnType<typeof useAdaptiveCheckout>;
type CheckoutSdk = NonNullable<CheckoutState["checkout"]>;

interface CheckoutElements {
  checkout: CheckoutSdk;
  payment: ReturnType<CheckoutSdk["createPaymentElement"]>;
  currencySelector: ReturnType<CheckoutSdk["createCurrencySelectorElement"]>;
}

interface ActiveCheckoutMount {
  elements: CheckoutElements;
  readinessTimeout?: number;
}

function PaymentForm({ state, onClose }: { state: CheckoutState; onClose: () => void }) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const translateRef = useRef(t);
  translateRef.current = t;
  const checkout = state.checkout;
  const isOpen = state.open;
  const paymentRef = useRef<HTMLDivElement>(null);
  const currencySelectorRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef<CheckoutElements | null>(null);
  const activeMountRef = useRef<ActiveCheckoutMount | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [paymentReady, setPaymentReady] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState("");
  const [applyingPromoCode, setApplyingPromoCode] = useState(false);

  useEffect(() => {
    if (!isOpen || !checkout || !paymentRef.current || !currencySelectorRef.current) return;

    let active = true;
    let readinessTimeout: number | undefined;
    let elements: CheckoutElements | null = null;
    setPaymentError(null);

    const mountElements = () => {
      if (!active || !paymentRef.current || !currencySelectorRef.current) return;
      try {
        elements = elementsRef.current;
        if (!elements || elements.checkout !== checkout) {
          elements?.payment.destroy();
          elements?.currencySelector.destroy();

          const payment = checkout.createPaymentElement({ layout: "tabs" });
          let currencySelector: ReturnType<CheckoutSdk["createCurrencySelectorElement"]>;
          try {
            currencySelector = checkout.createCurrencySelectorElement();
          } catch (cause) {
            payment.destroy();
            throw cause;
          }

          elements = { checkout, payment, currencySelector };
          elementsRef.current = elements;
          setPaymentReady(false);

          payment.on("ready", () => {
            const currentMount = activeMountRef.current;
            if (currentMount?.elements !== elements) return;
            window.clearTimeout(currentMount.readinessTimeout);
            setPaymentReady(true);
          });
          payment.on("loaderror", ({ error }) => {
            const currentMount = activeMountRef.current;
            if (currentMount?.elements !== elements) return;
            window.clearTimeout(currentMount.readinessTimeout);
            setPaymentError(error.message);
          });
        }

        const mountedElements = elements;
        const currentMount: ActiveCheckoutMount = { elements: mountedElements };
        activeMountRef.current = currentMount;
        if (!paymentReady) {
          readinessTimeout = window.setTimeout(() => {
            if (activeMountRef.current === currentMount) {
              setPaymentError(translateRef.current("bill_payment_fields_error"));
            }
          }, 12000);
          currentMount.readinessTimeout = readinessTimeout;
        }

        mountedElements.payment.mount(paymentRef.current);
        mountedElements.currencySelector.mount(currencySelectorRef.current);
      } catch (cause) {
        setPaymentError(cause instanceof Error ? cause.message : translateRef.current("bill_payment_fields_error"));
      }
    };

    // Mount on the next frame instead of a fixed delay.
    const mountFrame = window.requestAnimationFrame(mountElements);

    return () => {
      active = false;
      window.cancelAnimationFrame(mountFrame);
      window.clearTimeout(readinessTimeout);
      if (elements && activeMountRef.current?.elements === elements) {
        activeMountRef.current = null;
        elements.payment.unmount();
        elements.currencySelector.unmount();
      }
    };
  }, [checkout, isOpen]);

  useEffect(() => () => {
    const elements = elementsRef.current;
    if (!elements) return;
    const activeMount = activeMountRef.current;
    if (activeMount?.elements === elements) {
      window.clearTimeout(activeMount.readinessTimeout);
      activeMountRef.current = null;
      elements.payment.unmount();
      elements.currencySelector.unmount();
    }
    elements.payment.destroy();
    elements.currencySelector.destroy();
    elementsRef.current = null;
  }, []);

  const confirmPayment = async () => {
    if (!state.actions) return;
    setConfirming(true);
    try {
      const result = await state.actions.confirm({
        redirect: "always",
      });
      if (result.type === "error") {
        toast({ title: t("bill_error"), description: result.error.message, variant: "destructive" });
        return;
      }
      const returnUrl = new URL("/settings", window.location.origin);
      returnUrl.searchParams.set("status", "success");
      window.location.assign(returnUrl.toString());
    } catch (cause) {
      toast({
        title: t("bill_error"),
        description: cause instanceof Error ? cause.message : t("bill_try_again"),
        variant: "destructive",
      });
    } finally {
      setConfirming(false);
    }
  };

  const applyPromoCode = async () => {
    if (!state.actions) return;
    const code = promoCode.trim();
    if (!code) {
      toast({ title: t("bill_promo_code_required"), variant: "destructive" });
      return;
    }

    setApplyingPromoCode(true);
    try {
      const result = await state.actions.applyPromotionCode(code);
      if (result.type === "error") {
        toast({ title: t("bill_error"), description: result.error.message, variant: "destructive" });
      }
    } catch (cause) {
      toast({
        title: t("bill_error"),
        description: cause instanceof Error ? cause.message : t("bill_try_again"),
        variant: "destructive",
      });
    } finally {
      setApplyingPromoCode(false);
    }
  };

  return (
    <SmoothDrawer
      open={state.open}
      onOpenChange={(open) => { if (!confirming) state.setOpen(open); }}
      title="VISION"
      description={t("bill_cancel_secure")}
      className="z-[110] h-[92dvh] max-h-[92dvh] overflow-hidden"
      overlayClassName="z-[105]"
      bodyClassName="px-5 pb-5"
      repositionInputs={false}
    >
      {state.loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground" role="status">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          {t("bill_preparing_checkout")}
        </div>
      ) : state.error ? (
        <div className="space-y-4 py-4">
          <p className="text-sm text-destructive" role="alert">{state.error}</p>
          <Button className="w-full" onClick={state.retry}>{t("bill_try_again")}</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={promoCode}
              onChange={(event) => setPromoCode(event.target.value)}
              placeholder={t("bill_promo_code")}
              autoComplete="off"
            />
            <Button
              type="button"
              variant="outline"
              onClick={applyPromoCode}
              disabled={applyingPromoCode || !state.actions}
            >
              {t("bill_apply")}
            </Button>
          </div>
          <div ref={currencySelectorRef} />
          <p className="text-center font-serif text-3xl text-foreground">{state.price}</p>
          <p className="text-center text-xs text-muted-foreground">{t("bill_per_month")}</p>
          <div className="min-h-40" ref={paymentRef} aria-busy={!paymentReady} />
          {!paymentReady && !paymentError && (
            <p className="text-center text-sm text-muted-foreground" role="status">
              <ArrowPathIcon className="mr-2 inline h-4 w-4 animate-spin" />
              {t("bill_payment_fields_loading")}
            </p>
          )}
          {paymentError && (
            <div className="space-y-2" role="alert">
              <p className="text-sm text-destructive">{paymentError}</p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={state.retry}
              >
                {t("bill_try_again")}
              </Button>
            </div>
          )}
          <Button className="w-full" onClick={confirmPayment} disabled={confirming || !state.actions || !paymentReady || !!paymentError}>
            {confirming && <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />}
            {confirming ? t("bill_opening") : t("bill_upgrade_to_vision")}
          </Button>
          <Button type="button" variant="quiet" className="w-full" onClick={onClose} disabled={confirming}>
            {t("common_cancel")}
          </Button>
        </div>
      )}
    </SmoothDrawer>
  );
}

export function AdaptiveCheckoutDialog({ state }: { state: CheckoutState }) {
  return <PaymentForm state={state} onClose={() => state.setOpen(false)} />;
}
