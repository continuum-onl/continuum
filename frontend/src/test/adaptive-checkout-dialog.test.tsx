import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock("@/components/ui/smooth-drawer", () => ({
  default: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) => (
    <div>
      {open && <button aria-label="close checkout" onClick={() => onOpenChange(false)}>Close</button>}
      {children}
    </div>
  ),
}));

import { AdaptiveCheckoutDialog } from "@/components/subscription/AdaptiveCheckoutDialog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AdaptiveCheckoutDialog", () => {
  it("unmounts and reuses Stripe elements when the checkout drawer is reopened", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    const listeners = new Map<string, (event?: { error: { message: string } }) => void>();
    const paymentElement = {
      on: vi.fn((event: string, callback: (event?: { error: { message: string } }) => void) => {
        listeners.set(event, callback);
      }),
      mount: vi.fn(),
      unmount: vi.fn(),
      destroy: vi.fn(),
    };
    const currencySelectorElement = {
      mount: vi.fn(),
      unmount: vi.fn(),
      destroy: vi.fn(),
    };
    const checkout = {
      createPaymentElement: vi.fn(() => paymentElement),
      createCurrencySelectorElement: vi.fn(() => currencySelectorElement),
    };

    function Harness() {
      const [open, setOpen] = useState(false);
      const state = {
        checkout,
        actions: null,
        price: "€7.90",
        loading: false,
        error: null,
        retry: vi.fn(),
        open,
        setOpen,
        openCheckout: vi.fn(),
      };

      return (
        <>
          <button onClick={() => setOpen(true)}>Open checkout</button>
          <AdaptiveCheckoutDialog state={state as never} />
        </>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByText("Open checkout"));
    expect(paymentElement.mount).toHaveBeenCalledTimes(1);
    expect(currencySelectorElement.mount).toHaveBeenCalledTimes(1);
    act(() => listeners.get("ready")?.());

    fireEvent.click(screen.getByLabelText("close checkout"));
    expect(paymentElement.unmount).toHaveBeenCalledTimes(1);
    expect(currencySelectorElement.unmount).toHaveBeenCalledTimes(1);
    expect(paymentElement.destroy).not.toHaveBeenCalled();
    expect(currencySelectorElement.destroy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Open checkout"));
    expect(checkout.createPaymentElement).toHaveBeenCalledTimes(1);
    expect(checkout.createCurrencySelectorElement).toHaveBeenCalledTimes(1);
    expect(paymentElement.mount).toHaveBeenCalledTimes(2);
    expect(currencySelectorElement.mount).toHaveBeenCalledTimes(2);
  });
});
