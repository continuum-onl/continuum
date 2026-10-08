import fs from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { componentTagger } from "lovable-tagger";

const loadBuildEnv = (): Record<string, string> => {
  const buildEnvPath = path.resolve(__dirname, ".env.build");
  if (!fs.existsSync(buildEnvPath)) return {};
  return Object.fromEntries(
    fs.readFileSync(buildEnvPath, "utf-8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith("#"))
      .map((line) => {
        const [key, ...value] = line.split("=");
        return [key, value.join("=")];
      }),
  );
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const buildEnv = loadBuildEnv();
  const buildVersion = buildEnv.VITE_BUILD_VERSION || process.env.VITE_BUILD_VERSION || "";

  return {
    define: {
      "import.meta.env.VITE_BUILD_VERSION": JSON.stringify(buildVersion),
    },
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
        },
      },
    },
    server: {
      host: "::",
      port: Number(process.env.PORT) || Number(process.env.VITE_DEV_PORT) || 5173,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        manifest: false,
        workbox: {
          globPatterns: [
            "**/*.{html,js,mjs,css,ico,png,jpg,jpeg,svg,webp,avif,woff,woff2,ttf,json,webmanifest}",
          ],
          importScripts: ["/timer-service-worker.js"],
          navigateFallback: "/index.html",
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "google-fonts-stylesheets",
                expiration: {
                  maxEntries: 4,
                  maxAgeSeconds: 7 * 24 * 60 * 60,
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "google-fonts-webfonts",
                expiration: {
                  maxEntries: 12,
                  maxAgeSeconds: 365 * 24 * 60 * 60,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
      }),
      mode === "development" && componentTagger(),
    ].filter(Boolean),
    resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "lucide-react": path.resolve(__dirname, "./src/lib/heroicons.ts"),
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "prosemirror-model",
      "prosemirror-state",
      "prosemirror-view",
      "prosemirror-transform",
      "prosemirror-commands",
      "prosemirror-keymap",
      "prosemirror-schema-list",
      "prosemirror-gapcursor",
      "prosemirror-tables",
      "@tiptap/pm",
    ],
  },
  optimizeDeps: {
    include: [
      "prosemirror-model",
      "prosemirror-state",
      "prosemirror-view",
      "prosemirror-transform",
    ],
  },
}});