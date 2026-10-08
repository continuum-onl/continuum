import axios from "axios";
import {
  idbAdd,
  idbAll,
  idbDelete,
  idbCount,
  idbPut,
  idbGet,
  metaGet,
  metaSet,
  STORES,
} from "./db";
import type { CachedGetEntry, OfflineStatus, QueuedRequest } from "./types";

const LAST_SYNC_KEY = "lastSyncAt";
const STATUS_EVENT = "continuum-offline:status";
const QUEUE_EVENT = "continuum-offline:queue";

let currentStatus: OfflineStatus = navigator.onLine ? "online" : "offline";
let pendingCount = 0;
let syncing = false;
let syncManagerInitialized = false;

function emitStatus(next?: OfflineStatus) {
  if (next) currentStatus = next;
  window.dispatchEvent(
    new CustomEvent(STATUS_EVENT, {
      detail: { status: currentStatus, pending: pendingCount, syncing },
    })
  );
}

async function refreshPendingCount() {
  try {
    pendingCount = await idbCount(STORES.SYNC_QUEUE);
  } catch {
    pendingCount = 0;
  }
  window.dispatchEvent(new CustomEvent(QUEUE_EVENT, { detail: { pending: pendingCount } }));
  emitStatus();
}

export function getOfflineSnapshot() {
  return { status: currentStatus, pending: pendingCount, syncing };
}

// ---- GET cache ----
export async function cacheGet(url: string, status: number, data: unknown) {
  if (status < 200 || status >= 300) return;
  const entry: CachedGetEntry = { url, status, data, savedAt: Date.now() };
  try {
    await idbPut(STORES.GET_CACHE, entry);
  } catch {
    /* quota */
  }
}

export async function readCachedGet(url: string): Promise<CachedGetEntry | undefined> {
  try {
    return await idbGet<CachedGetEntry>(STORES.GET_CACHE, url);
  } catch {
    return undefined;
  }
}

// ---- Queue ----
export async function enqueue(req: Omit<QueuedRequest, "id" | "createdAt" | "status" | "retryCount" | "clientUpdatedAt"> & Partial<Pick<QueuedRequest, "clientUpdatedAt">>) {
  const item: QueuedRequest = {
    method: req.method,
    url: req.url,
    data: req.data,
    resourceKey: req.resourceKey,
    entityId: req.entityId,
    clientUpdatedAt: req.clientUpdatedAt ?? Date.now(),
    createdAt: Date.now(),
    status: "pending",
    retryCount: 0,
  };
  await idbAdd(STORES.SYNC_QUEUE, item);
  await refreshPendingCount();
}

async function listQueue(): Promise<QueuedRequest[]> {
  const items = await idbAll<QueuedRequest>(STORES.SYNC_QUEUE);
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

let bareClient: ReturnType<typeof axios.create> | null = null;
function getBareClient(baseURL: string) {
  if (!bareClient) {
    bareClient = axios.create({ baseURL, withCredentials: true, timeout: 30000 });
  }
  return bareClient;
}

function getAuthToken(): string | null {
  try {
    return (
      sessionStorage.getItem("access_token") ??
      localStorage.getItem("access_token") ??
      null
    );
  } catch {
    return null;
  }
}

let baseURLRef = "";
export function setSyncBaseURL(url: string) {
  baseURLRef = url;
}

export async function flushQueue(): Promise<{ sent: number; failed: number }> {
  if (syncing) return { sent: 0, failed: 0 };
  if (!navigator.onLine) return { sent: 0, failed: 0 };
  syncing = true;
  emitStatus("syncing");
  let sent = 0;
  let failed = 0;
  try {
    const items = await listQueue();
    const client = getBareClient(baseURLRef);
    for (const item of items) {
      try {
        const token = getAuthToken();
        // Merge stored headers (which may include old auth token) with current auth
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Client-Updated-At": String(item.clientUpdatedAt),
          ...(item.headers ?? {}), // Preserve any stored headers (e.g., from when request was queued)
        };
        // Use current token if available, overriding any old one
        if (token) headers.Authorization = `Bearer ${token}`;
        await client.request({
          method: item.method,
          url: item.url,
          data: item.data,
          headers,
        });
        if (item.id != null) await idbDelete(STORES.SYNC_QUEUE, item.id);
        sent++;
      } catch (err: unknown) {
        const e = err as { response?: { status?: number }; message?: string };
        const status = e.response?.status;
        // 4xx (except 408/429) — operation is invalid, drop to avoid forever-failing queue.
        if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          if (item.id != null) await idbDelete(STORES.SYNC_QUEUE, item.id);
          failed++;
        } else {
          // network / 5xx — keep and increment retry
          item.retryCount += 1;
          item.lastError = e.message ?? String(err);
          item.status = "failed";
          if (item.id != null) await idbPut(STORES.SYNC_QUEUE, item);
          failed++;
          // Stop draining on first network failure; we'll retry on next tick.
          if (!status) break;
        }
      }
    }
    await metaSet(LAST_SYNC_KEY, Date.now());
  } finally {
    syncing = false;
    await refreshPendingCount();
    emitStatus(navigator.onLine ? (failed > 0 ? "error" : "online") : "offline");
  }
  return { sent, failed };
}

export async function getLastSyncAt(): Promise<number | undefined> {
  return metaGet<number>(LAST_SYNC_KEY);
}

let backoffTimer: number | null = null;
function scheduleRetry(delayMs: number) {
  if (backoffTimer != null) return;
  backoffTimer = window.setTimeout(() => {
    backoffTimer = null;
    if (navigator.onLine) {
      void flushQueue();
    }
  }, delayMs);
}

export function initSyncManager(baseURL: string) {
  setSyncBaseURL(baseURL);
  if (syncManagerInitialized) return;
  syncManagerInitialized = true;

  // Initial state
  refreshPendingCount().then(() => {
    if (navigator.onLine) void flushQueue();
  });

  window.addEventListener("online", () => {
    emitStatus("online");
    void flushQueue();
  });
  window.addEventListener("offline", () => {
    emitStatus("offline");
  });

  // Periodic flush attempt every 60s.
  setInterval(() => {
    if (navigator.onLine && !syncing) {
      void flushQueue().then((r) => {
        if (r.failed > 0) scheduleRetry(15000);
      });
    }
  }, 60000);
}

export const OFFLINE_EVENTS = { STATUS: STATUS_EVENT, QUEUE: QUEUE_EVENT };
