import { enUS, es, fr, ptBR } from "date-fns/locale";
import type { Locale } from "date-fns";
import type { UserLanguage } from "@/types";

const dateLocales: Record<UserLanguage, string> = {
  en: "en-US",
  es: "es-ES",
  pt: "pt-BR",
  fr: "fr-FR",
};

const dateFnsLocales: Record<UserLanguage, Locale> = {
  en: enUS,
  es,
  pt: ptBR,
  fr,
};

export function getDateLocale(language: UserLanguage): string {
  return dateLocales[language];
}

export function getDateFnsLocale(language: UserLanguage): Locale {
  return dateFnsLocales[language];
}

function parseDate(value: Date | string | number): Date {
  if (typeof value === "string") {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  return value instanceof Date ? value : new Date(value);
}

export function formatLocalizedDate(
  value: Date | string | number,
  language: UserLanguage,
  options: Intl.DateTimeFormatOptions = { dateStyle: "short" },
): string {
  return new Intl.DateTimeFormat(getDateLocale(language), options).format(parseDate(value));
}

export function formatLocalizedRelativeDate(value: Date | string | number, language: UserLanguage): string {
  const date = parseDate(value);
  const daysAgo = (Date.now() - date.getTime()) / 86_400_000;
  const relative = new Intl.RelativeTimeFormat(getDateLocale(language), { numeric: "auto" });

  if (daysAgo < 1) return relative.format(0, "day");
  if (daysAgo < 2) return relative.format(-1, "day");
  if (daysAgo < 7) return relative.format(-Math.floor(daysAgo), "day");
  if (daysAgo < 30) return relative.format(-Math.floor(daysAgo / 7), "week");
  return formatLocalizedDate(date, language, { month: "short", day: "numeric" });
}
