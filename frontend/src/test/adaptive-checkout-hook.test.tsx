import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkoutEmbedded: vi.fn(),
  loadStripe: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@stripe/stripe-js", () => ({ loadStripe: mocks.loadStripe }));
vi.mock("@/lib/api", () => ({
  subscriptionApi: {
    checkoutConfig: vi.fn().mockResolvedValue({ data: { publishableKey: "pk_test" } }),
    checkoutEmbedded: mocks.checkoutEmbedded,
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ language: "en", t: (key: string) => key }),
}));
vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "DARK" }),
}));

import { useAdaptiveCheckout } from "@/hooks/useAdaptiveCheckout";

afterEach(() => {
  vi.clearAllMocks();
});

describe("useAdaptiveCheckout", () => {
  it("creates a fresh Stripe checkout session after the drawer is closed and reopened", async () => {
    let sessionNumber = 0;
    const stripe = {
      initCheckoutElementsSdk: vi.fn(() => {
        sessionNumber += 1;
        return {
          loadActions: vi.fn().mockResolvedValue({
            type: "success",
            actions: {
              getSession: () => ({
                recurring: { dueNext: { total: { amount: `€${sessionNumber}.90` } } },
                lineItems: [],
              }),
            },
          }),
          on: vi.fn(),
        };
      }),
    };
    mocks.loadStripe.mockResolvedValue(stripe);
    mocks.checkoutEmbedded.mockImplementation(async () => ({
      data: { clientSecret: `secret-${mocks.checkoutEmbedded.mock.calls.length}` },
    }));

    const { result } = renderHook(() => useAdaptiveCheckout());
    await waitFor(() => expect(mocks.checkoutEmbedded).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.checkoutEmbedded).toHaveBeenCalledTimes(1);
    expect(result.current.price).toBe("€1.90");

    act(() => result.current.openCheckout());
    expect(result.current.open).toBe(true);
    act(() => result.current.setOpen(false));
    act(() => result.current.openCheckout());

    await waitFor(() => {
      expect(mocks.checkoutEmbedded).toHaveBeenCalledTimes(2);
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.open).toBe(true);
    expect(result.current.price).toBe("€2.90");
  });
});
