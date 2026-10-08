import * as React from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Feature {
  icon?: React.ReactNode;
  text: string;
}

interface PricingOption {
  id: string;
  price: string;
  period: string;
  badge?: string;
}

interface PlanDetail {
  label: string;
  value: string;
}

interface SubscriptionScreenProps {
  backgroundImageSrc?: string;
  headerImageSrc: string;
  appName: string;
  planType: string;
  features: Feature[];
  pricingOptions: PricingOption[];
  defaultPlanId: string;
  subscribeButtonText: string;
  footerText: string;
  currentPlanText?: string;
  planDetails?: PlanDetail[];
  onSubscribe: (planId: string) => void;
}

export function SubscriptionScreen({
  backgroundImageSrc,
  headerImageSrc,
  appName,
  planType,
  features,
  pricingOptions,
  defaultPlanId,
  subscribeButtonText,
  footerText,
  currentPlanText,
  planDetails,
  onSubscribe,
}: SubscriptionScreenProps) {
  const pricing = pricingOptions.find((option) => option.id === defaultPlanId) ?? pricingOptions[0];

  return (
    <div className="relative flex w-[clamp(18rem,88vw,26rem)] flex-col items-center justify-end overflow-visible rounded-2xl bg-transparent shadow-2xl">
      {backgroundImageSrc && <img src={backgroundImageSrc} alt="" className="absolute inset-0 z-0 h-full w-full object-cover" />}
      {backgroundImageSrc && <div className="absolute inset-0 z-[1] bg-black/25" />}

      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ duration: 0.7, ease: [0.32, 0.72, 0, 1] }}
        data-subscription-panel
        className="relative z-10 flex w-[calc(100%+0.5rem)] flex-col items-center rounded-t-3xl bg-muted/60 px-6 pb-6 pt-12 backdrop-blur-xl sm:w-[calc(100%+1rem)] sm:px-8"
      >
        <motion.img
          src={headerImageSrc}
          alt=""
          className="absolute -top-16 h-32 w-32 rounded-full border-4 border-background/80 object-cover shadow-xl"
          initial={{ y: 32, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.35, ease: "easeOut" }}
        />

        <div className="mt-4 text-center">
          <h1 className="font-serif text-3xl tracking-tight text-foreground">
            {appName} <span className="text-primary">{planType}</span>
          </h1>
          {currentPlanText && <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{currentPlanText}</p>}
        </div>

        <ul className="mt-5 w-full space-y-2.5">
          {features.map((feature, index) => (
            <motion.li
              key={feature.text}
              className="flex items-center gap-3 text-sm text-muted-foreground"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.45 + index * 0.07, ease: "easeOut" }}
            >
              {feature.icon ?? <Check className="h-4 w-4 shrink-0 text-primary" />}
              <span>{feature.text}</span>
            </motion.li>
          ))}
        </ul>

        {pricing && (
          <div className="mt-6 flex w-full items-baseline justify-center gap-2 border-y border-border/20 py-5 text-center">
            <span className="font-serif text-2xl text-foreground">{pricing.price}</span>
            <span className="text-sm text-muted-foreground">{pricing.period}</span>
            {pricing.badge && <span className="text-xs font-semibold text-primary">{pricing.badge}</span>}
          </div>
        )}

        {planDetails && planDetails.length > 0 && (
          <dl className="mt-5 grid w-full grid-cols-2 gap-x-5 gap-y-4">
            {planDetails.map((detail) => (
              <div key={detail.label} className="min-w-0">
                <dt className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{detail.label}</dt>
                <dd className="mt-1 min-w-0 whitespace-normal break-words font-serif text-sm leading-tight tabular-nums text-foreground [overflow-wrap:anywhere] sm:text-base">{detail.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <Button size="lg" className="mt-6 w-full text-base" onClick={() => onSubscribe(defaultPlanId)}>
          {subscribeButtonText}
        </Button>
        <p className="mt-3 text-center text-xs text-muted-foreground">{footerText}</p>
      </motion.div>
    </div>
  );
}
