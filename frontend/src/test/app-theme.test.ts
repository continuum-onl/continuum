import { beforeEach, describe, expect, it } from "vitest";
import {
  applyAppTheme,
  DEFAULT_APP_THEME,
  isAppTheme,
  readCachedAppTheme,
  shouldApplyAppTheme,
} from "@/lib/app-theme";

describe("app theme preference", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });

  it("defaults to CLASSIC", () => {
    expect(readCachedAppTheme()).toBe(DEFAULT_APP_THEME);
  });

  it("reads only named themes from the cached user", () => {
    localStorage.setItem("auth_user", JSON.stringify({ theme: "CHARCOAL" }));
    expect(readCachedAppTheme()).toBe("CHARCOAL");

    localStorage.setItem("auth_user", JSON.stringify({ theme: "#080808" }));
    expect(readCachedAppTheme()).toBe(DEFAULT_APP_THEME);
    expect(isAppTheme("#080808")).toBe(false);

    localStorage.setItem("auth_user", JSON.stringify({ theme: "AMOLED" }));
    expect(readCachedAppTheme()).toBe("CLASSIC");
  });

  it("applies CHARCOAL as a dark theme and resets to CLASSIC", () => {
    applyAppTheme("CHARCOAL");
    expect(document.documentElement).toHaveClass("dark", "theme-charcoal");

    applyAppTheme("CLASSIC");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).not.toHaveClass("theme-charcoal");
  });

  it("applies the light theme without retaining dark theme classes", () => {
    applyAppTheme("LIGHT");
    expect(document.documentElement).toHaveClass("light");
    expect(document.documentElement).not.toHaveClass("dark", "theme-charcoal");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("does not enable app themes on public routes", () => {
    expect(shouldApplyAppTheme("/", false)).toBe(false);
    expect(shouldApplyAppTheme("/about", false)).toBe(false);
    expect(shouldApplyAppTheme("/", true)).toBe(true);
    expect(shouldApplyAppTheme("/notes/123", false)).toBe(true);
  });

  it("removes app theme classes when disabled", () => {
    applyAppTheme("LIGHT");
    applyAppTheme("LIGHT", false);

    expect(document.documentElement).not.toHaveClass("light", "dark", "theme-charcoal");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});
