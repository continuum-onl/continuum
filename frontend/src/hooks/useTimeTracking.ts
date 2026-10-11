import { useEffect, useState, useCallback, useSyncExternalStore } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { timeTrackingApi } from '@/lib/api';

export interface TimeEntry {
  id: string;
  entityId: string;
  date: string;
  durationSeconds: number;
  formattedDuration: string;
  note?: string;
  source: 'TIMER' | 'MANUAL' | 'RECOVERED';
  createdAt: string;
  updatedAt: string;
}

export interface TimerSession {
  id: string;
  entityId: string;
  startedAt: string;
  stoppedAt?: string;
  status: 'RUNNING' | 'COMPLETED' | 'ABANDONED';
  elapsedSeconds: number;
  formattedElapsed: string;
  createdAt: string;
}

export interface TimeEntitySummary {
  entityId: string;
  entityTitle?: string;
  totalSeconds: number;
  formattedTotal: string;
  totalHours: number;
  entriesCount: number;
  activeSessionDuration?: number;
  hasActiveTimer: boolean;
}

interface PersistedTimer {
  timerId: string;
  entityId: string;
  startTime: number;        // ms epoch when this run started
  initialElapsed: number;   // seconds accumulated before startTime
  pausedAt?: number;        // ms epoch — if set, timer is paused and frozen at this instant
}


const STORAGE_KEY = 'continuum.activeTimers.v2';
const LEGACY_KEYS = ['activeTimerId', 'activeEntityId', 'timerStartTime', 'timerInitialElapsed'];

/**
 * Singleton TimerManager.
 * Source of truth for all running timers. Survives route changes & component
 * unmounts. Persists state to localStorage so reloads can recover.
 */
class TimerManager {
  private static instance: TimerManager;
  private timers = new Map<string, PersistedTimer>();
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private snapshotCache: ReadonlyMap<string, PersistedTimer> = new Map();
  private swReady = false;
  private timerWorker: ServiceWorker | null = null;

  static getInstance(): TimerManager {
    if (!TimerManager.instance) TimerManager.instance = new TimerManager();
    return TimerManager.instance;
  }

  private constructor() {
    if (typeof window === 'undefined') return;
    this.hydrate();
    this.initServiceWorker();
    navigator.serviceWorker?.addEventListener('controllerchange', () => {
      this.timerWorker = navigator.serviceWorker.controller;
      this.swReady = this.timerWorker !== null;
      if (this.swReady) {
        this.timers.forEach((timer) => this.swSend('START_TIMER', timer));
      }
    });

    // Recompute / re-broadcast when tab becomes visible or window focuses again.
    const refresh = () => this.notify();
    window.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) {
        this.hydrate();
        this.notify();
      }
    });

    if (this.timers.size > 0) this.ensureTick();
  }

  // ─── persistence ───────────────────────────────────────────────────────────
  private hydrate() {
    try {
      // Migrate legacy single-timer keys
      const legacyId = localStorage.getItem('activeTimerId');
      const legacyEntity = localStorage.getItem('activeEntityId');
      const legacyStart = localStorage.getItem('timerStartTime');
      const legacyInit = localStorage.getItem('timerInitialElapsed');
      if (legacyId && legacyEntity && legacyStart && !localStorage.getItem(STORAGE_KEY)) {
        this.timers.set(legacyEntity, {
          timerId: legacyId,
          entityId: legacyEntity,
          startTime: parseInt(legacyStart, 10),
          initialElapsed: parseInt(legacyInit || '0', 10),
        });
        this.persist();
        LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
        return;
      }

      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw) as PersistedTimer[];
      this.timers = new Map(arr.map((t) => [t.entityId, t]));
    } catch (err) {
      console.warn('TimerManager hydrate failed:', err);
    }
  }

  private persist() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Array.from(this.timers.values()))
      );
    } catch {
      /* ignore quota errors */
    }
  }

  // ─── service worker ────────────────────────────────────────────────────────
  private async initServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      this.timerWorker = navigator.serviceWorker.controller ?? registration.active;
      this.swReady = this.timerWorker !== null;
      this.timers.forEach((t) => this.swSend('START_TIMER', t));
    } catch (err) {
      console.warn('Timer service worker initialization failed:', err);
    }
  }

  private swSend(type: string, data: unknown) {
    if (!this.swReady) return;
    (navigator.serviceWorker.controller ?? this.timerWorker)?.postMessage({ type, data });
  }

  // ─── tick ──────────────────────────────────────────────────────────────────
  private ensureTick() {
    if (this.tickInterval) return;
    this.tickInterval = setInterval(() => {
      if (this.timers.size === 0) {
        clearInterval(this.tickInterval!);
        this.tickInterval = null;
        return;
      }
      this.notify();
    }, 1000);
  }

  // ─── subscription api ──────────────────────────────────────────────────────
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Stable snapshot for useSyncExternalStore. Re-created on notify(). */
  getSnapshot = (): ReadonlyMap<string, PersistedTimer> => this.snapshotCache;

  private notify() {
    this.snapshotCache = new Map(this.timers);
    this.listeners.forEach((l) => l());
  }

  // ─── public ops ────────────────────────────────────────────────────────────
  startTimer(timerId: string, entityId: string, initialElapsed = 0, syncWorker = true) {
    // Replace any existing timer for this entity
    const record: PersistedTimer = {
      timerId,
      entityId,
      startTime: Date.now(),
      initialElapsed,
    };
    this.timers.set(entityId, record);
    this.persist();
    if (syncWorker) this.swSend('START_TIMER', record);
    this.ensureTick();
    this.notify();
  }

  confirmTimerStart(entityId: string, optimisticTimerId: string, timerId: string, initialElapsed = 0) {
    const timer = this.timers.get(entityId);
    if (!timer || timer.timerId !== optimisticTimerId) return;

    timer.timerId = timerId;
    timer.startTime = Date.now();
    timer.initialElapsed = initialElapsed;
    this.timers.set(entityId, timer);
    this.persist();
    this.swSend('START_TIMER', timer);
    this.notify();
  }

  rollbackTimerStart(entityId: string, optimisticTimerId: string) {
    const timer = this.timers.get(entityId);
    if (!timer || timer.timerId !== optimisticTimerId) return;

    this.timers.delete(entityId);
    this.persist();
    this.notify();
  }

  stopTimer(entityId: string): { elapsed: number; timerId: string | null } {
    const t = this.timers.get(entityId);
    if (!t) return { elapsed: 0, timerId: null };
    const elapsed = this.getElapsedSeconds(entityId);
    this.timers.delete(entityId);
    this.persist();
    this.swSend('STOP_TIMER', { entityId });
    this.notify();
    return { elapsed, timerId: t.timerId };
  }

  getElapsedSeconds(entityId: string): number {
    const t = this.timers.get(entityId);
    if (!t) return 0;
    const reference = t.pausedAt ?? Date.now();
    return Math.floor((reference - t.startTime) / 1000) + (t.initialElapsed || 0);
  }

  pauseTimer(entityId: string) {
    const t = this.timers.get(entityId);
    if (!t || t.pausedAt) return;
    t.pausedAt = Date.now();
    this.timers.set(entityId, t);
    this.persist();
    this.swSend('PAUSE_TIMER', { entityId });
    this.notify();
  }

  resumeTimer(entityId: string) {
    const t = this.timers.get(entityId);
    if (!t || !t.pausedAt) return;
    // Shift startTime forward by the paused duration so elapsed stays continuous.
    const pausedFor = Date.now() - t.pausedAt;
    t.startTime += pausedFor;
    t.pausedAt = undefined;
    this.timers.set(entityId, t);
    this.persist();
    this.swSend('RESUME_TIMER', t);
    this.notify();
  }

  isPaused(entityId: string): boolean {
    return !!this.timers.get(entityId)?.pausedAt;
  }

  isActive(entityId: string): boolean {
    return this.timers.has(entityId);
  }

  getTimerId(entityId: string): string | null {
    return this.timers.get(entityId)?.timerId ?? null;
  }

  getActiveEntityIds(): string[] {
    return Array.from(this.timers.keys());
  }
}


export const timerManager =
  typeof window !== 'undefined' ? TimerManager.getInstance() : (null as unknown as TimerManager);

/** React hook subscribing to the manager. */
function useTimerSnapshot() {
  return useSyncExternalStore(
    (cb) => (timerManager ? timerManager.subscribe(cb) : () => {}),
    () => (timerManager ? timerManager.getSnapshot() : (new Map() as ReadonlyMap<string, PersistedTimer>)),
    () => new Map() as ReadonlyMap<string, PersistedTimer>
  );
}

/**
 * Hook for managing time tracking operations.
 */
export const useTimeTracking = () => {
  const queryClient = useQueryClient();
  const snapshot = useTimerSnapshot();

  // Derive activeTimers map (entityId -> { timerId, elapsedSeconds })
  const [, force] = useState(0);
  useEffect(() => {
    // Tick local renders once per second so derived elapsed stays fresh
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const activeTimers = new Map<string, { timerId: string; elapsedSeconds: number }>();
  snapshot.forEach((t, entityId) => {
    activeTimers.set(entityId, {
      timerId: t.timerId,
      elapsedSeconds: timerManager.getElapsedSeconds(entityId),
    });
  });

  // ─── queries ─────────────────────────────────────────────────────────────
  const getTotalTime = (entityId: string) =>
    useQuery({
      queryKey: ['timeTracking', 'total', entityId],
      queryFn: () => timeTrackingApi.getTotalTime(entityId).then((r) => r.data),
      staleTime: 10000,
    });

  const getDailyBreakdown = (entityId: string) =>
    useQuery({
      queryKey: ['timeTracking', 'daily', entityId],
      queryFn: () => timeTrackingApi.getDailyBreakdown(entityId).then((r) => r.data),
      staleTime: 30000,
    });

  const getAllSummaries = () =>
    useQuery({
      queryKey: ['timeTracking', 'summaries'],
      queryFn: () => timeTrackingApi.getAllSummaries().then((r) => r.data),
      staleTime: 5000,
    });

  const getActiveTimer = (entityId: string) =>
    useQuery({
      queryKey: ['timeTracking', 'activeTimer', entityId],
      queryFn: () => timeTrackingApi.getActiveTimer(entityId).then((r) => r.data),
      staleTime: 2000,
    });

  // ─── mutations ───────────────────────────────────────────────────────────
  const startTimerMutation = useMutation({
    mutationFn: (entityId: string) =>
      timeTrackingApi.startTimer(entityId).then((r) => r.data as TimerSession),
    onMutate: (entityId) => {
      const optimisticTimerId = `optimistic-${entityId}-${Date.now()}`;
      timerManager.startTimer(optimisticTimerId, entityId, 0, false);
      return { entityId, optimisticTimerId };
    },
    onSuccess: (data, _entityId, context) => {
      const initialElapsed = Math.floor(data.elapsedSeconds || 0);
      if (context) {
        timerManager.confirmTimerStart(context.entityId, context.optimisticTimerId, data.id, initialElapsed);
      }
      queryClient.invalidateQueries({ queryKey: ['timeTracking'] });
    },
    onError: (e, _entityId, context) => {
      if (context) {
        timerManager.rollbackTimerStart(context.entityId, context.optimisticTimerId);
      }
      console.error('Failed to start timer:', e);
    },
  });

  const stopTimerMutation = useMutation({
    mutationFn: async (data: { sessionId: string; note?: string }) => {
      // Find entity for this session
      let entityId: string | null = null;
      snapshot.forEach((t, eid) => {
        if (t.timerId === data.sessionId) entityId = eid;
      });
      if (entityId) timerManager.stopTimer(entityId);
      return timeTrackingApi.stopTimer(data.sessionId, data.note || '').then((r) => r.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeTracking'] });
    },
    onError: (e) => console.error('Failed to stop timer:', e),
  });

  const addTimeMutation = useMutation({
    mutationFn: (data: { entityId: string; date: string; durationSeconds: number; note?: string }) =>
      timeTrackingApi.addTime(data.entityId, data.date, data.durationSeconds, data.note).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['timeTracking'] }),
  });

  const deleteEntryMutation = useMutation({
    mutationFn: (entryId: string) => timeTrackingApi.deleteEntry(entryId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['timeTracking'] }),
  });

  const formatSeconds = useCallback((seconds: number): string => {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }, []);

  return {
    getTotalTime,
    getDailyBreakdown,
    getAllSummaries,
    getActiveTimer,

    startTimer: startTimerMutation.mutateAsync,
    startTimerAsync: startTimerMutation.mutateAsync,
    stopTimer: stopTimerMutation.mutate,
    stopTimerAsync: stopTimerMutation.mutateAsync,
    addTime: addTimeMutation.mutate,
    addTimeAsync: addTimeMutation.mutateAsync,
    deleteEntry: deleteEntryMutation.mutate,

    activeTimers,
    isTimerActive: (entityId: string) => snapshot.has(entityId),
    isTimerPaused: (entityId: string) => timerManager?.isPaused(entityId) ?? false,
    pauseTimer: (entityId: string) => {
      timerManager?.pauseTimer(entityId);
      const sessionId = timerManager?.getTimerId(entityId);
      if (sessionId) timeTrackingApi.pauseTimer(sessionId).catch(() => {});
    },
    resumeTimer: (entityId: string) => {
      timerManager?.resumeTimer(entityId);
      const sessionId = timerManager?.getTimerId(entityId);
      if (sessionId) timeTrackingApi.resumeTimer(sessionId).catch(() => {});
    },
    getElapsedSeconds: (entityId: string) => timerManager?.getElapsedSeconds(entityId) ?? 0,
    isStarting: startTimerMutation.isPending,
    isStopping: stopTimerMutation.isPending,
    isAdding: addTimeMutation.isPending,
    isDeleting: deleteEntryMutation.isPending,


    formatSeconds,
  };
};
