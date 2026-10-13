const EUR_REGIONS = new Set([
  "AD", "AT", "BE", "BG", "BL", "CY", "DE", "EE", "ES", "FI", "FR", "GF",
  "GP", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MC", "MF", "MQ", "MT",
  "NL", "PM", "PT", "RE", "SI", "SK", "SM", "VA", "XK", "YT",
]);

export function getVisitorPrice(locales: readonly string[]): string | null {
  const preferences = locales.flatMap((rawLocale) => {
    const locale = rawLocale.replace(/_/g, "-");
    const region = locale.split("-").slice(1).find((part) => /^[a-z]{2}$/i.test(part))?.toUpperCase();
    const currency = region === "BR"
      ? "BRL"
      : region && EUR_REGIONS.has(region)
        ? "EUR"
        : region === "US"
          ? "USD"
          : null;

    return currency ? [{ locale, currency }] : [];
  });
  const preference = preferences.find(({ currency }) => currency === "BRL")
    ?? preferences.find(({ currency }) => currency === "EUR")
    ?? preferences.find(({ currency }) => currency === "USD");

  if (!preference) return null;

  return new Intl.NumberFormat(preference.locale, {
    style: "currency",
    currency: preference.currency,
  }).format(7.9);
}
