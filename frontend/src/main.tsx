import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerContinuumSW } from "./lib/pwa-register";

// Apply persisted theme synchronously to avoid flash.
if (typeof document !== "undefined") {
  try {
    const stored = window.localStorage.getItem("continuum.theme");
    const theme = stored === "light" ? "light" : "dark";
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(theme);
    document.documentElement.style.colorScheme = theme;
  } catch {
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
  }
}

void registerContinuumSW();

createRoot(document.getElementById("root")!).render(<App />);