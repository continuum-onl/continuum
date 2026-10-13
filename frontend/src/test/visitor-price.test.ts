import { describe, expect, it } from "vitest";
import { getVisitorPrice } from "@/lib/visitor-price";

describe("getVisitorPrice", () => {
  it("prefers Brazilian region over an earlier US language preference", () => {
    expect(getVisitorPrice(["en-US", "pt-BR"])).toBe(
      new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(7.9),
    );
  });

  it("formats supported US and euro-region prices using the matching locale", () => {
    expect(getVisitorPrice(["en-US"])).toBe(
      new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(7.9),
    );
    expect(getVisitorPrice(["de-DE"])).toBe(
      new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(7.9),
    );
  });

  it("returns no estimate for unsupported regions", () => {
    expect(getVisitorPrice(["en-GB"])).toBeNull();
  });
});
