import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { cacheGet, enqueue, readCachedGet } from "./sync";

/** API paths that are safe to cache and replay offline. */
const CACHEABLE_PREFIXES = [
  "/api/notes",
  "/api/folders",
  "/api/entities",
  "/api/graph",
  "/api/tracking",
  "/api/time-tracking",
  "/api/activities",
  "/api/account/preferences",
  "/api/account/me",
  "/api/auth/me",
  "/api/dashboard",
  "/api/metrics",
  "/api/insights",
  "/api/vault/files",
];

/** Paths that should never be queued offline (auth-critical, server-only). */
const NON_QUEUEABLE_PREFIXES = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/refresh",
  "/api/auth/google",
  "/api/auth/logout",
  "/api/auth/verify-email",
  "/api/auth/resend-verification",
  "/api/account/password",
  "/api/account/export",
  "/api/subscriptions",
  "/api/import",
  "/api/vault/files", // file uploads (multipart) — not safely replayable as JSON
];

function pathOf(url?: string): string {
  if (!url) return "";
  try {
    if (url.startsWith("http")) return new URL(url).pathname;
  } catch {
    /* ignore */
  }
  return url.split("?")[0] || "";
}

function isCacheable(url?: string): boolean {
  const p = pathOf(url);
  return CACHEABLE_PREFIXES.some((prefix) => p.startsWith(prefix));
}

function isQueueable(url?: string): boolean {
  const p = pathOf(url);
  return !NON_QUEUEABLE_PREFIXES.some((prefix) => p.startsWith(prefix));
}

function fullKey(config: InternalAxiosRequestConfig): string {
  const url = config.url ?? "";
  if (!config.params) return url;
  try {
    const qs = new URLSearchParams(
      Object.entries(config.params as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")])
    ).toString();
    return qs ? `${url}?${qs}` : url;
  } catch {
    return url;
  }
}

function synthesizeOptimisticResponse(
  config: InternalAxiosRequestConfig
): AxiosResponse {
  const method = (config.method || "get").toUpperCase();
  const data = config.data ? safeParse(config.data) : null;
  return {
    data: method === "DELETE" ? { ok: true, offline: true } : { ...((data as object) ?? {}), offline: true },
    status: 202,
    statusText: "Accepted (offline)",
    headers: {},
    config,
    request: undefined,
  } as AxiosResponse;
}

function safeParse(data: unknown): unknown {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

/**
 * Installs offline-first behavior on an existing axios instance:
 *  - GETs: on success, cache the response. On network failure, return cached.
 *  - Writes (POST/PUT/PATCH/DELETE): on network failure, enqueue and return
 *    an optimistic 202 response so the UI doesn't break.
 */
export function installOfflineLayer(api: AxiosInstance) {
  api.interceptors.response.use(
    async (response) => {
      const cfg = response.config as InternalAxiosRequestConfig;
      const method = (cfg.method || "get").toUpperCase();
      if (method === "GET" && isCacheable(cfg.url)) {
        // Fire-and-forget: never make the UI wait on the offline cache write.
        void cacheGet(fullKey(cfg), response.status, response.data).catch(() => undefined);
      }
      return response;
    },
    async (error) => {
      const cfg = error?.config as InternalAxiosRequestConfig | undefined;
      // Only handle network errors (no response). Let HTTP errors pass through.
      const isNetworkError = !error?.response;
      if (!cfg || !isNetworkError) {
        return Promise.reject(error);
      }
      const method = (cfg.method || "get").toUpperCase();

      if (method === "GET") {
        if (!isCacheable(cfg.url)) return Promise.reject(error);
        const cached = await readCachedGet(fullKey(cfg));
        if (cached) {
          return {
            data: cached.data,
            status: 200,
            statusText: "OK (cached)",
            headers: { "x-from-cache": "1" },
            config: cfg,
            request: undefined,
          } as AxiosResponse;
        }
        return Promise.reject(error);
      }

      // Mutating verb — queue it if eligible.
      if (!isQueueable(cfg.url)) return Promise.reject(error);
      // Skip multipart/form-data — we can't safely re-serialize FormData.
      const contentType = (cfg.headers?.["Content-Type"] as string | undefined) ?? "";
      if (contentType.includes("multipart/form-data")) {
        return Promise.reject(error);
      }
      try {
        await enqueue({
          method: method as "POST" | "PUT" | "PATCH" | "DELETE",
          url: cfg.url ?? "",
          data: safeParse(cfg.data),
          headers: cfg.headers as Record<string, string> | undefined,
        });
      } catch (e) {
        console.warn("[offline] enqueue failed", e);
        return Promise.reject(error);
      }
      return synthesizeOptimisticResponse(cfg);
    }
  );
}
