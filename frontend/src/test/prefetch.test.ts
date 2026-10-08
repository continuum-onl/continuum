import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient, resetAllCaches } from "@/lib/query-client";
import { qk } from "@/lib/queries";

const api = vi.hoisted(() => ({
  notesList: vi.fn(),
  noteGet: vi.fn(),
  noteTypes: vi.fn(),
  noteBacklinks: vi.fn(),
  folders: vi.fn(),
  entitiesList: vi.fn(),
  entityGet: vi.fn(),
  entityNotes: vi.fn(),
  entityConnections: vi.fn(),
  entityStats: vi.fn(),
  entityHeatmap: vi.fn(),
  timeTotal: vi.fn(),
  preferences: vi.fn(),
  subscription: vi.fn(),
  dashboard: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  notesApi: {
    list: api.notesList,
    get: api.noteGet,
    getTypes: api.noteTypes,
    getBacklinks: api.noteBacklinks,
  },
  foldersApi: { list: api.folders },
  entitiesApi: {
    list: api.entitiesList,
    get: api.entityGet,
    getNotes: api.entityNotes,
    getConnections: api.entityConnections,
    stats: api.entityStats,
    heatmap: api.entityHeatmap,
  },
  timeTrackingApi: { getTotalTime: api.timeTotal },
  preferencesApi: { get: api.preferences },
  subscriptionApi: { me: api.subscription },
  dashboardApi: { summary: api.dashboard },
}));

import { prefetchPrimaryLists, PREFETCH_CONCURRENCY } from "@/lib/prefetch";

function response<T>(data: T) {
  return Promise.resolve({ data });
}

function resetMocks() {
  for (const mock of Object.values(api)) mock.mockReset();
  api.notesList.mockImplementation(() => response([]));
  api.noteGet.mockImplementation((id: string) => response({ id, content: { type: "doc" } }));
  api.noteTypes.mockImplementation(() => response([]));
  api.noteBacklinks.mockImplementation(() => response({ linkedMentions: [], unlinkedMentions: [] }));
  api.folders.mockImplementation(() => response([]));
  api.entitiesList.mockImplementation(() => response([]));
  api.entityGet.mockImplementation((id: string) => response({ id, title: id, type: "TOPIC" }));
  api.entityNotes.mockImplementation(() => response([]));
  api.entityConnections.mockImplementation(() => response([]));
  api.entityStats.mockImplementation(() => response({ totalCompletions: 1 }));
  api.entityHeatmap.mockImplementation(() => response({}));
  api.timeTotal.mockImplementation(() => response({ totalSeconds: 0 }));
  api.preferences.mockImplementation(() => response({}));
  api.subscription.mockImplementation(() => response({}));
  api.dashboard.mockImplementation(() => response({}));
}

describe("background primary-data prefetch", () => {
  beforeEach(() => {
    queryClient.clear();
    resetMocks();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("stores complete note and entity detail queries with bounded concurrency", async () => {
    api.notesList.mockImplementation(() => response([{ id: "n1" }, { id: "n2" }]));
    api.entitiesList.mockImplementation(() => response([
      { id: "e1", type: "TOPIC" },
      { id: "e2", type: "ACTIVITY" },
    ]));

    let active = 0;
    let maxActive = 0;
    const delayedResponse = async (data: unknown) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return { data };
    };
    api.noteGet.mockImplementation((id: string) => delayedResponse({ id, content: { type: "doc" } }));
    api.noteBacklinks.mockImplementation((id: string) => delayedResponse({ id, linkedMentions: [], unlinkedMentions: [] }));
    api.entityGet.mockImplementation((id: string) => delayedResponse({ id, type: id === "e2" ? "ACTIVITY" : "TOPIC" }));
    api.entityNotes.mockImplementation((id: string) => delayedResponse([{ id: `n-${id}` }]));
    api.entityConnections.mockImplementation((id: string) => delayedResponse([{ id: `e-${id}` }]));
    api.entityStats.mockImplementation((id: string) => delayedResponse({ id, totalCompletions: 1 }));
    api.entityHeatmap.mockImplementation((id: string) => delayedResponse({ [id]: 1 }));
    api.timeTotal.mockImplementation((id: string) => delayedResponse({ id, totalSeconds: 10 }));

    await prefetchPrimaryLists();

    expect(queryClient.getQueryData(qk.note("n1"))).toMatchObject({ id: "n1", content: { type: "doc" } });
    expect(queryClient.getQueryData(["notes", "backlinks", "n2"])).toMatchObject({ id: "n2" });
    expect(queryClient.getQueryData(qk.entity("e1"))).toMatchObject({ id: "e1" });
    expect(queryClient.getQueryData(qk.entityNotes("e1"))).toEqual([{ id: "n-e1" }]);
    expect(queryClient.getQueryData(qk.entityConnections("e2"))).toEqual([{ id: "e-e2" }]);
    expect(queryClient.getQueryData(qk.entityStats("e2"))).toMatchObject({ totalCompletions: 1 });
    expect(queryClient.getQueryData(qk.entityHeatmap("e2"))).toEqual({ e2: 1 });
    expect(queryClient.getQueryData(["timeTracking", "total", "e1"])).toMatchObject({ totalSeconds: 10 });
    expect(queryClient.getQueryData(["entities", "list", "all-pages-v1"])).toBe(true);
    expect(api.entityStats).not.toHaveBeenCalledWith("e1");
    expect(api.entityHeatmap).not.toHaveBeenCalledWith("e1");
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(PREFETCH_CONCURRENCY);

    await prefetchPrimaryLists();
    expect(api.notesList).toHaveBeenCalledTimes(1);
    expect(api.entitiesList).toHaveBeenCalledTimes(1);
    expect(api.noteGet).toHaveBeenCalledTimes(2);
  });

  it("skips fresh cached details and continues after an individual request fails", async () => {
    const cachedNote = { id: "n1", title: "Cached", content: { type: "doc" } };
    queryClient.setQueryData(qk.note("n1"), cachedNote);
    api.notesList.mockImplementation(() => response([{ id: "n1" }]));
    api.entitiesList.mockImplementation(() => response([
      { id: "e1", type: "TOPIC" },
      { id: "e2", type: "TOPIC" },
    ]));
    api.entityGet.mockImplementation((id: string) => id === "e1"
      ? Promise.reject(new Error("temporary failure"))
      : response({ id, title: "Entity", type: "TOPIC" }));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await prefetchPrimaryLists();

    expect(api.noteGet).not.toHaveBeenCalledWith("n1");
    expect(queryClient.getQueryData(qk.note("n1"))).toEqual(cachedNote);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("entity e1 failed"),
      expect.any(Error),
    );
    expect(api.entityGet).toHaveBeenCalledWith("e2");
    expect(queryClient.getQueryData(qk.entity("e2"))).toMatchObject({ id: "e2" });
    warning.mockRestore();
  });

  it("cancels pending prefetches when the authenticated cache is cleared", async () => {
    let resolveNotes!: (value: { data: Array<{ id: string }> }) => void;
    api.notesList.mockImplementation(() => new Promise((resolve) => { resolveNotes = resolve; }));
    api.entitiesList.mockImplementation(() => response([]));

    const pendingPrefetch = prefetchPrimaryLists();
    await Promise.resolve();
    await resetAllCaches();
    await pendingPrefetch;
    resolveNotes({ data: [{ id: "old-user-note" }] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(api.noteGet).not.toHaveBeenCalled();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});
