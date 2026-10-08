import { useEffect, useState } from "react";
import api from "@/lib/api";

/** Price text read from Stripe via backend. Never converts currencies locally. */
export function useVisionPrice() {
  const [label, setLabel] = useState<string>("—");
  useEffect(() => {
    api.get("/api/plans/prices").then(({ data }) => {
      const d = data?.vision?.monthlyDisplay;
      if (!d?.currency || d.unitAmount == null) return;
      const fmt = (cur: string, amt: number) =>
        new Intl.NumberFormat(undefined, { style: "currency", currency: cur.toUpperCase() }).format(amt / 100);
      const parts = [fmt(d.currency, d.unitAmount)];
      for (const cur of ["brl", "eur"]) {
        const amt = d.currencyOptions?.[cur];
        if (amt != null && d.currency !== cur) parts.push(fmt(cur, amt));
      }
      setLabel(parts.join(" · "));
    }).catch(() => {});
  }, []);
  return label;
}
