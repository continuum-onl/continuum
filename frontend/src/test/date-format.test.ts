import { afterEach, describe, expect, it, vi } from "vitest";
import { formatLocalizedDate, formatLocalizedRelativeDate, getDateLocale, getDateFnsLocale } from "@/lib/date-format";

afterEach(() => {
  vi.useRealTimers();
});

describe("localized date formatting", () => {
  it("uses the locale associated with the selected app language", () => {
    expect(getDateLocale("en")).toBe("en-US");
    expect(getDateLocale("es")).toBe("es-ES");
    expect(getDateLocale("pt")).toBe("pt-BR");
    expect(getDateLocale("fr")).toBe("fr-FR");
  });

  it("formats dates in the selected language's ordering", () => {
    expect(formatLocalizedDate("2026-10-23", "en")).toBe("10/23/26");
    expect(formatLocalizedDate("2026-10-23", "pt")).toBe("23/10/2026");
    expect(formatLocalizedDate("2026-10-23", "fr")).toBe("23/10/2026");
  });

  it("provides localized date-fns calendars", () => {
    expect(getDateFnsLocale("en").code).toBe("en-US");
    expect(getDateFnsLocale("es").code).toBe("es");
    expect(getDateFnsLocale("pt").code).toBe("pt-BR");
    expect(getDateFnsLocale("fr").code).toBe("fr");
  });

  it("localizes relative date labels", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00"));

    expect(formatLocalizedRelativeDate("2026-10-23T10:00:00", "es")).toBe("hoy");
    expect(formatLocalizedRelativeDate("2026-10-22T10:00:00", "pt")).toBe("ontem");
  });
});
