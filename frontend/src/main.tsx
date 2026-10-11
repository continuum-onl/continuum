import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerContinuumSW } from "./lib/pwa-register";
import { applyAppTheme, readCachedAppTheme, shouldApplyAppTheme } from "./lib/app-theme";

// Apply persisted theme synchronously to avoid flash.
if (typeof document !== "undefined") {
  try {
    const hasCachedSession = Boolean(
      (sessionStorage.getItem("access_token") ?? localStorage.getItem("access_token")) &&
      localStorage.getItem("auth_user"),
    );
    applyAppTheme(
      readCachedAppTheme(),
      shouldApplyAppTheme(window.location.pathname, hasCachedSession),
    );
  } catch {
    applyAppTheme("CLASSIC", false);
  }
}

void registerContinuumSW();

createRoot(document.getElementById("root")!).render(<App />);