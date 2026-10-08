import { getQueryCacheEpoch, queryClient } from "@/lib/query-client";
import { qk, STALE } from "@/lib/queries";
import {
  notesApi,
  foldersApi,
  entitiesApi,
  preferencesApi,
  dashboardApi,
  subscriptionApi,
  timeTrackingApi,
} from "@/lib/api";
import type { Entity } from "@/types";
import type { QueryKey } from "@tanstack/react-query";

/**
 * Prefetches all note and entity details after the persisted query cache has
 * been restored. All jobs share one bounded worker pool.
 */
export const PREFETCH_CONCURRENCY = 4;
const ENTITY_LIST_PAGINATION_MARKER = ["entities", "list", "all-pages-v1"] as const;

interface PrefetchJob {
  key: QueryKey;
  label: string;
  staleTime: number;
  run: () => Promise<unknown>;
}

let activePrefetch: Promise<void> | null = null;
let activePrefetchEpoch: number | null = null;
let rerunRequested = false;

export function prefetchPrimaryLists(): Promise<void> {
  const epoch = getQueryCacheEpoch();
  if (activePrefetch && activePrefetchEpoch === epoch) {
    rerunRequested = true;
    return activePrefetch;
  }
  if (activePrefetch) return activePrefetch.then(() => prefetchPrimaryLists());

  const run = runPrimaryPrefetch(epoch);
  activePrefetch = run.finally(() => {
    if (activePrefetch === run || activePrefetchEpoch === epoch) {
      activePrefetch = null;
      activePrefetchEpoch = null;
      const rerun = rerunRequested;
      rerunRequested = false;
      if (rerun && epoch === getQueryCacheEpoch()) void prefetchPrimaryLists();
    }
  });
  activePrefetchEpoch = epoch;
  return activePrefetch;
}

async function fetchFresh<T>(
  key: QueryKey,
  label: string,
  staleTime: number,
  queryFn: () => Promise<T>,
  epoch: number,
): Promise<T | undefined> {
  if (epoch !== getQueryCacheEpoch()) return undefined;
  try {
    const data = await queryClient.fetchQuery({ queryKey: key, queryFn, staleTime });
    return epoch === getQueryCacheEpoch() ? data : undefined;
  } catch (error) {
    if (epoch !== getQueryCacheEpoch()) return undefined;
    console.warn(`[prefetch] ${label} failed; it will be retried on a later sync`, error);
    return undefined;
  }
}

async function runPrimaryPrefetch(epoch: number) {
  const hasCompleteEntityList = queryClient.getQueryData<boolean>(ENTITY_LIST_PAGINATION_MARKER) === true;
  const [notes, entities] = await Promise.all([
    fetchFresh(qk.notes(), "notes list", STALE.list, async () => {
      const response = await notesApi.list();
      return Array.isArray(response.data) ? response.data : [];
    }, epoch),
    fetchFresh(qk.entities(), "entities list", hasCompleteEntityList ? STALE.list : 0, async () => {
        const response = await entitiesApi.list();
        return Array.isArray(response.data) ? response.data as Entity[] : [];
      }, epoch),
  ]);

  if (epoch !== getQueryCacheEpoch()) return;
  if (entities !== undefined && !hasCompleteEntityList) {
    queryClient.setQueryData(ENTITY_LIST_PAGINATION_MARKER, true);
  }
  const cachedNotes = notes ?? queryClient.getQueryData<Array<{ id: string }>>(qk.notes()) ?? [];
  const cachedEntities = entities ?? queryClient.getQueryData<Entity[]>(qk.entities()) ?? [];
  await runJobs(createJobs(cachedNotes, cachedEntities), epoch);
}

function* createJobs(
  notes: Array<{ id: string }>,
  entities: Entity[],
): Generator<PrefetchJob> {
  yield {
    key: qk.noteTypes(),
    label: "note types",
    staleTime: STALE.list,
    run: () => notesApi.getTypes().then((response) => response.data),
  };
  yield {
    key: qk.folders(),
    label: "folders",
    staleTime: STALE.list,
    run: () => foldersApi.list().then((response) => response.data),
  };
  yield {
    key: ["account", "preferences"],
    label: "account preferences",
    staleTime: STALE.preferences,
    run: () => preferencesApi.get().then((response) => response.data),
  };
  yield {
    key: ["subscription", "me"],
    label: "subscription",
    staleTime: STALE.preferences,
    run: () => subscriptionApi.me().then((response) => response.data),
  };
  yield {
    key: qk.dashboard(),
    label: "dashboard summary",
    staleTime: STALE.insights,
    run: () => dashboardApi.summary().then((response) => response.data),
  };

  for (const note of notes) {
    if (note.id) yield* noteJobs(note.id);
  }
  for (const entity of entities) {
    if (entity.id) yield* entityJobs(entity);
  }
}

async function runJobs(jobs: Iterable<PrefetchJob>, epoch: number) {
  const iterator = jobs[Symbol.iterator]();
  while (epoch === getQueryCacheEpoch()) {
    const batch: PrefetchJob[] = [];
    while (batch.length < PREFETCH_CONCURRENCY * 2) {
      const next = iterator.next();
      if (next.done) break;
      batch.push(next.value);
    }
    if (batch.length === 0) return;

    let nextJob = 0;
    const workerCount = Math.min(PREFETCH_CONCURRENCY, batch.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextJob < batch.length) {
          if (epoch !== getQueryCacheEpoch()) return;
          const job = batch[nextJob++];
          await fetchFresh(job.key, job.label, job.staleTime, job.run, epoch);
        }
      }),
    );
  }
}

function noteJobs(id: string): PrefetchJob[] {
  return [
    {
      key: qk.note(id),
      label: `note ${id}`,
      staleTime: STALE.detail,
      run: () => notesApi.get(id).then((response) => response.data),
    },
    {
      key: ["notes", "backlinks", id],
      label: `note backlinks ${id}`,
      staleTime: STALE.detail,
      run: () => notesApi.getBacklinks(id).then((response) => response.data),
    },
  ];
}

function entityJobs(entity: Entity): PrefetchJob[] {
  const id = entity.id;
  const jobs: PrefetchJob[] = [
    {
      key: qk.entity(id),
      label: `entity ${id}`,
      staleTime: STALE.detail,
      run: () => entitiesApi.get(id).then((response) => response.data),
    },
    {
      key: qk.entityNotes(id),
      label: `entity notes ${id}`,
      staleTime: STALE.detail,
      run: () => entitiesApi.getNotes(id).then((response) => response.data),
    },
    {
      key: qk.entityConnections(id),
      label: `entity connections ${id}`,
      staleTime: STALE.detail,
      run: () => entitiesApi.getConnections(id).then((response) => response.data),
    },
    {
      key: ["timeTracking", "total", id],
      label: `entity time summary ${id}`,
      staleTime: 10_000,
      run: () => timeTrackingApi.getTotalTime(id).then((response) => response.data),
    },
  ];

  if (entity.type === "ACTIVITY") {
    jobs.push(
      {
        key: qk.entityStats(id),
        label: `entity stats ${id}`,
        staleTime: STALE.detail,
        run: () => entitiesApi.stats(id).then((response) => response.data),
      },
      {
        key: qk.entityHeatmap(id),
        label: `entity heatmap ${id}`,
        staleTime: STALE.detail,
        run: () => entitiesApi.heatmap(id).then((response) => response.data),
      },
    );
  }

  return jobs;
}
