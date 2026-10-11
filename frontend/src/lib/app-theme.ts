export const DEFAULT_APP_THEME = "CLASSIC" as const;
export const APP_THEMES = ["CLASSIC", "CHARCOAL", "LIGHT"] as const;

export type AppTheme = (typeof APP_THEMES)[number];

export function isAppTheme(value: unknown): value is AppTheme {
  return value === "CLASSIC" || value === "CHARCOAL" || value === "LIGHT";
}

export function readCachedAppTheme(): AppTheme {
  if (typeof window === "undefined") return DEFAULT_APP_THEME;
  try {
    const cached = localStorage.getItem("auth_user");
    if (cached) {
      const user: unknown = JSON.parse(cached);
      if (typeof user === "object" && user !== null && "theme" in user) {
        if (user.theme === "AMOLED") return "CLASSIC";
        if (isAppTheme(user.theme)) return user.theme;
      }
    }
    const stored = localStorage.getItem("continuum.app-theme");
    if (stored === "AMOLED") return "CLASSIC";
    return isAppTheme(stored) ? stored : DEFAULT_APP_THEME;
  } catch {
    return DEFAULT_APP_THEME;
  }
}

const APP_THEME_PATHS = [
  "/notes",
  "/entities",
  "/vault",
  "/activities",
  "/projects",
  "/graph",
  "/insights",
  "/trash",
  "/settings",
  "/editor",
];

export function shouldApplyAppTheme(pathname: string, isAuthenticated: boolean) {
  if (pathname === "/" || pathname === "/index") return isAuthenticated;
  return APP_THEME_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function applyAppTheme(theme: AppTheme, enabled = true) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("light", enabled && theme === "LIGHT");
  root.classList.toggle("dark", enabled && theme !== "LIGHT");
  root.classList.toggle("theme-charcoal", enabled && theme === "CHARCOAL");
  root.style.colorScheme = enabled && theme === "LIGHT" ? "light" : "dark";
}
