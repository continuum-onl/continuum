import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheAdaptivePrice,
  clearCachedAdaptivePrice,
  readCachedAdaptivePrice,
} from "@/lib/adaptive-price-cache";

describe("adaptive price cache", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T20:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores the last confirmed price separately by app language", () => {
    cacheAdaptivePrice("pt", "R$ 7,90");

    expect(readCachedAdaptivePrice("pt")).toBe("R$ 7,90");
    expect(readCachedAdaptivePrice("en")).toBeNull();
  });

  it("expires prices after twenty hours", () => {
    cacheAdaptivePrice("en", "$7.90");
    vi.advanceTimersByTime(20 * 60 * 60 * 1000 + 1);

    expect(readCachedAdaptivePrice("en")).toBeNull();
  });

  it("replaces a cached price with the fresh response and clears it on request failure", () => {
    cacheAdaptivePrice("pt", "R$ 7,90");
    cacheAdaptivePrice("pt", "€7.90");
    expect(readCachedAdaptivePrice("pt")).toBe("€7.90");

    clearCachedAdaptivePrice("pt");
    expect(readCachedAdaptivePrice("pt")).toBeNull();
  });
});
