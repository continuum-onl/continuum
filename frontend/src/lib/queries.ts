/**
 * Shared query keys + per-resource freshness windows.
 *
 * Every screen reads through these keys so the cache is reused across routes
 * (stale-while-revalidate: cached data paints instantly, network refreshes it).
 */

export const STALE = {
  list: 60_000, // notes/entities/vault lists
  detail: 30_000, // single note/entity
  insights: 5 * 60_000, // insights, metrics, dashboard score
  HOUR: 60 * 60_000,
  preferences: 10 * 60_000, // account preferences, plan
} as const;

export const qk = {
  notes: () => ["notes", "list"] as const,
  noteTypes: () => ["notes", "types"] as const,
  note: (id: string) => ["notes", "detail", id] as const,
  folders: () => ["folders", "list"] as const,
  entities: (type?: string) => ["entities", "list", type ?? "all"] as const,
  entity: (id: string) => ["entities", "detail", id] as const,
  entityHeatmap: (id: string) => ["entities", "heatmap", id] as const,
  entityStats: (id: string) => ["entities", "stats", id] as const,
  entityNotes: (id: string) => ["entities", "notes", id] as const,
  entityConnections: (id: string) => ["entities", "connections", id] as const,
  graph: () => ["graph", "data"] as const,
  vaultFiles: () => ["vault", "files"] as const,
  insights: (kind: string, limit?: number) => ["insights", kind, limit ?? 0] as const,
  metrics: () => ["metrics", "summary"] as const,
  dashboard: () => ["dashboard", "summary"] as const,
  preferences: () => ["account", "preferences"] as const,
} as const;
