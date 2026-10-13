import type { Language } from "@/contexts/LanguageContext";

const CACHE_TTL_MS = 20 * 60 * 60 * 1000;

function getCacheKey(language: Language): string {
  const browserLocale = typeof navigator === "undefined" ? "unknown" : navigator.language.toLowerCase();
  let timeZone = "unknown";
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || timeZone;
  } catch (error) {
    console.warn("Could not determine timezone for localized price cache", error);
  }
  return `continuum:adaptive-price:v1:${language}:${browserLocale}:${timeZone}`;
}

export function readCachedAdaptivePrice(language: Language): string | null {
  if (typeof window === "undefined") return null;
  try {
    const key = getCacheKey(language);
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    const cached: unknown = JSON.parse(raw);
    if (
      typeof cached !== "object"
      || cached === null
      || !("price" in cached)
      || typeof cached.price !== "string"
      || !cached.price.trim()
      || !("savedAt" in cached)
      || typeof cached.savedAt !== "number"
      || Date.now() - cached.savedAt > CACHE_TTL_MS
      || cached.savedAt > Date.now() + 60_000
    ) {
      window.localStorage.removeItem(key);
      return null;
    }
    return cached.price;
  } catch (error) {
    console.warn("Could not read cached localized price", error);
    return null;
  }
}

export function cacheAdaptivePrice(language: Language, price: string): void {
  if (typeof window === "undefined" || !price.trim() || price === "…") return;
  try {
    window.localStorage.setItem(
      getCacheKey(language),
      JSON.stringify({ price, savedAt: Date.now() }),
    );
  } catch (error) {
    console.warn("Could not cache localized price", error);
  }
}

export function clearCachedAdaptivePrice(language: Language): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(getCacheKey(language));
  } catch (error) {
    console.warn("Could not clear cached localized price", error);
  }
}
