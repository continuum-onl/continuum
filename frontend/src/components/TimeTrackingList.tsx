import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { entitiesApi } from '@/lib/api';
import { useTimeTracking, type TimeEntitySummary } from '@/hooks/useTimeTracking';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Plus, ChevronDown, Loader2, Check, Trash2, Pin } from "@/lib/heroicons";
import { CreateEntityDialog } from '@/components/CreateEntityDialog';
import { ListRowContent } from '@/components/ui/list-row-content';
import { EntityTypeIcon } from '@/components/ui/entity-type-icon';
import { useLanguage } from '@/contexts/LanguageContext';
import { ActivityCompletionCalendar } from '@/components/ActivityCompletionCalendar';
import { InsightSignalBadge } from '@/components/InsightSignal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import type { Entity } from '@/types';
import { qk, STALE } from '@/lib/queries';
import { usePlanGate } from '@/hooks/usePlanGate';

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const isTrackedToday = (trackingDates?: string[]) => {
  if (!trackingDates?.length) return false;
  const key = todayKey();
  return trackingDates.some((d) => d.split('T')[0] === key);
};

/**
 * Responsive list of trackable entities (projects / activities).
 * Card-based layout that works well on mobile and desktop, with a
 * one-tap "Complete today" action for activities.
 */
export function TimeTrackingList({
  filterType,
  search,
  hideInternalSearch,
  createOpen,
  onCreateOpenChange,
  onCreated,
  onCountChange,
  sortMode = 'recent',
  quickFilter = 'all',
}: {
  sortMode?: 'recent' | 'oldest' | 'az' | 'za';
  quickFilter?: 'all' | 'yes' | 'no';
  filterType?: string;
  search?: string;
  sortBy?: "createdAt" | "updatedAt";
  sortOrder?: "asc" | "desc";
  hideInternalSearch?: boolean;
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
  onCreated?: (entity: Entity) => void;
  onCountChange?: (total: number, visible: number) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { refresh: refreshUsage, applyUsageDelta } = usePlanGate();
  const [internalCreateOpen, setInternalCreateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [pendingDeleteEntity, setPendingDeleteEntity] = useState<Entity | null>(null);
  const createDialogOpen = onCreateOpenChange ? createOpen ?? false : internalCreateOpen;
  const setCreateDialogOpen = onCreateOpenChange ? onCreateOpenChange : setInternalCreateOpen;
  const { getAllSummaries } = useTimeTracking();

  const lower = hideInternalSearch ? (search ?? '').trim().toLowerCase() : query.trim().toLowerCase();

  const { data: trackableEntities, isLoading: entitiesLoading } = useQuery({
    queryKey: qk.entities(),
    queryFn: async () => {
      const response = await entitiesApi.list();
      return response.data as Entity[];
    },
    staleTime: STALE.list,
  });

  const { data: summaries, isLoading: summariesLoading } = getAllSummaries();
  const getSummaryForEntity = (entityId: string): TimeEntitySummary | undefined =>
    summaries?.find((s: TimeEntitySummary) => s.entityId === entityId);

  const isLoading = entitiesLoading || summariesLoading;
  const typeLabels: Record<string, string> = { PROJECT: t('tm_project'), ACTIVITY: t('tm_activity') };

  const all = useMemo(() => {
    const entities = trackableEntities ?? [];
    if (filterType) return entities.filter((entity) => entity.type === filterType);
    return entities.filter((entity) => entity.type === 'PROJECT' || entity.type === 'ACTIVITY');
  }, [filterType, trackableEntities]);
  const visible = useMemo(() => {
    let list = lower
      ? all.filter((e) => [e.title, e.description, e.type].filter(Boolean).some((v) => String(v).toLowerCase().includes(lower)))
      : [...all];
    if (quickFilter !== 'all') {
      list = list.filter((e) => {
        const hit = e.type === 'PROJECT'
          ? (summaries?.find((s: TimeEntitySummary) => s.entityId === e.id)?.entriesCount ?? 0) > 0
          : isTrackedToday(e.trackingDates);
        return quickFilter === 'yes' ? hit : !hit;
      });
    }
    return list.sort((a, b) => {
      if (filterType === 'PROJECT' && !!a.pinned !== !!b.pinned) {
        return a.pinned ? -1 : 1;
      }
      if (sortMode === 'az' || sortMode === 'za') {
        const o = (a.title ?? '').localeCompare(b.title ?? '');
        return sortMode === 'az' ? o : -o;
      }
      const da = new Date((a as any).updatedAt ?? (a as any).createdAt ?? 0).getTime();
      const db = new Date((b as any).updatedAt ?? (b as any).createdAt ?? 0).getTime();
      return sortMode === 'recent' ? db - da : da - db;
    });
  }, [lower, all, quickFilter, sortMode, summaries, filterType]);

  useEffect(() => {
    onCountChange?.(all.length, visible.length);
  }, [all.length, visible.length, onCountChange]);

  const placeholder = filterType === 'PROJECT' ? t('tm_search_projects') : filterType === 'ACTIVITY' ? t('tm_search_activities') : t('tm_search_entities');


  const handleQuickToggle = async (entity: Entity, currentlyDone: boolean) => {
    const key = qk.entities();
    const previous = queryClient.getQueryData<Entity[]>(key);
    const today = todayKey();
    // Optimistic: toggle done instantly, roll back on failure.
    queryClient.setQueryData<Entity[]>(key, (old) =>
      old?.map((e) =>
        e.id === entity.id
          ? {
              ...e,
              trackingDates: currentlyDone
                ? (e.trackingDates ?? []).filter((d) => d.split('T')[0] !== today)
                : [...(e.trackingDates ?? []), today],
            }
          : e,
      ),
    );
    toast({
      title: currentlyDone ? t('tm_unmarked_title') : t('tm_marked_done_title'),
      description: entity.title || t('tm_activity'),
    });
    try {
      if (currentlyDone) await entitiesApi.untrack(entity.id, today);
      else await entitiesApi.track(entity.id);
      void queryClient.invalidateQueries({ queryKey: ['entities'] });
    } catch {
      queryClient.setQueryData(key, previous);
      toast({ title: currentlyDone ? t('tm_could_not_unmark_title') : t('tm_could_not_mark_title'), variant: 'destructive' });
    }
  };

  const togglePinned = async (entity: Entity, event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    const previousPinned = !!entity.pinned;
    const updatePinned = (entities: Entity[] | undefined) =>
      entities?.map((item) =>
        item.id === entity.id ? { ...item, pinned: !previousPinned } : item,
      );
    queryClient.setQueryData<Entity[]>(qk.entities(), updatePinned);
    try {
      const { data } = await entitiesApi.togglePinned(entity.id);
      queryClient.setQueryData<Entity[]>(qk.entities(), (entities) =>
        entities?.map((item) =>
          item.id === entity.id ? { ...item, pinned: !!data.pinned } : item,
        ),
      );
    } catch {
      queryClient.setQueryData<Entity[]>(qk.entities(), (entities) =>
        entities?.map((item) =>
          item.id === entity.id ? { ...item, pinned: previousPinned } : item,
        ),
      );
      toast({ title: t('ls_entities_error_pin'), variant: 'destructive' });
    }
  };

  const confirmDelete = async () => {
    if (!pendingDeleteEntity) return;
    const deletedEntity = pendingDeleteEntity;
    const previousEntities = queryClient.getQueryData<Entity[]>(qk.entities());
    queryClient.setQueryData<Entity[]>(qk.entities(), (entities) =>
      entities?.filter((entity) => entity.id !== deletedEntity.id),
    );
    try {
      await entitiesApi.delete(deletedEntity.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.entities() }),
        queryClient.invalidateQueries({ queryKey: ['trash'] }),
      ]);
      applyUsageDelta({ entitiesCount: -1 });
      void refreshUsage();
    } catch {
      if (previousEntities) queryClient.setQueryData(qk.entities(), previousEntities);
      toast({ title: t('ls_entities_error_deleting'), variant: 'destructive' });
    } finally {
      setPendingDeleteEntity(null);
    }
  };

  return (
    <>
      {!hideInternalSearch && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="w-full max-w-sm bg-transparent border-0 border-b border-border/15 focus:border-border/10 pb-2 text-sm outline-none transition-colors placeholder:text-muted-foreground"
          />
          <button onClick={() => setCreateDialogOpen(true)} className="btn-primary shrink-0">
            <Plus className="w-4 h-4" /> {filterType === 'PROJECT' ? t('tm_new_project') : filterType === 'ACTIVITY' ? t('tm_new_activity') : t('tm_new_entity')}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="divide-y divide-border/10">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-4">
              <div className="h-9 w-9 animate-pulse rounded-xl bg-muted" />
              <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="py-20 text-center">
          <p className="font-serif text-2xl italic text-muted-foreground">
            {filterType === 'PROJECT' ? t('tm_no_projects_yet') : filterType === 'ACTIVITY' ? t('tm_no_activities_yet') : t('tm_no_entities_yet')}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border/10">
          {visible.map((entity) => {
            const summary = getSummaryForEntity(entity.id);
            const isOpen = openId === entity.id;
            const isProject = entity.type === 'PROJECT';
            const doneToday = isTrackedToday(entity.trackingDates);
            const marking = markingId === entity.id;

            return (
              <li
                key={entity.id}
                className="overflow-hidden transition-colors hover:bg-foreground/[0.02]"
              >
                {/* Linha principal */}
                <div className="flex items-center gap-3 px-1 py-5">
                  <button
                    onClick={() => {
                      if (isProject) {
                        navigate(`/entities/${entity.id}`);
                      } else {
                        setOpenId(isOpen ? null : entity.id);
                      }
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    aria-expanded={isProject ? undefined : isOpen}
                  >
                    <ListRowContent
                      icon={<EntityTypeIcon type={entity.type} className="h-5 w-5" />}
                      title={entity.title || t('tm_untitled')}
                      meta={
                        <>
                          {typeLabels[entity.type] ?? entity.type}
                          {' · '}
                          {isProject ? (
                            <>
                              <span className="font-mono">{summary?.formattedTotal || '00:00:00'}</span>
                              {' · '}
                              <span>
                                {summary?.entriesCount ?? 0} {t('tm_sessions').toLowerCase()}
                              </span>
                            </>
                          ) : (
                            t('tm_done_count', { count: entity.trackingDates?.length ?? 0 })
                          )}
                        </>
                      }
                      trailing={
                        isProject ? (
                          <div className="hidden sm:flex items-center gap-2">
                            <span className="font-mono text-xs rounded-lg bg-accent px-2.5 py-1 text-foreground">
                              {summary?.formattedTotal || '00:00:00'}
                            </span>
                          </div>
                        ) : (
                          <ChevronDown
                            className={cn(
                              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                              isOpen && 'rotate-180',
                            )}
                          />
                        )
                      }
                    />
                  </button>

                  {isProject && (
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center">
                        <InsightSignalBadge kind="entity" id={entity.id} className="h-5 w-5" />
                      </span>
                      <span className="flex h-5 w-5 items-center justify-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="iconSm"
                          className={cn(
                            'h-5 w-5 rounded-full p-0 opacity-70 transition-colors hover:opacity-100',
                            entity.pinned && 'text-foreground opacity-100',
                          )}
                          onClick={(event) => void togglePinned(entity, event)}
                          aria-label={entity.pinned ? t('ls_project_unpin') : t('ls_project_pin')}
                          title={entity.pinned ? t('ls_project_unpin') : t('ls_project_pin')}
                          aria-pressed={!!entity.pinned}
                        >
                          <Pin className={cn('h-3 w-3', entity.pinned && 'fill-current')} />
                        </Button>
                      </span>
                      <span className="flex h-5 w-5 items-center justify-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="iconSm"
                          className="h-5 w-5 rounded-full p-0 text-foreground opacity-70 transition hover:opacity-100"
                          onClick={(event) => {
                            event.stopPropagation();
                            event.preventDefault();
                            setPendingDeleteEntity(entity);
                          }}
                          aria-label={t('common_delete')}
                          title={t('common_delete')}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </span>
                    </div>
                  )}

                  {/* Ação rápida apenas para atividades */}
                  {!isProject && (
                    <button
                      onClick={() => handleQuickToggle(entity, doneToday)}
                      disabled={marking}
                      title={doneToday ? t('tm_unmark_done') : t('tm_complete')}
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                        doneToday
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-300'
                          : 'border-border/15 text-muted-foreground hover:border-border/40 hover:bg-foreground/[0.06]',
                      )}
                    >
                      {marking ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      <span>{doneToday ? t('tm_done_today') : t('tm_complete')}</span>
                    </button>
                  )}
                </div>

                {/* Gaveta apenas para atividades */}
                {!isProject && isOpen && (
                  <div className="mb-3 rounded-2xl bg-card/40 p-4 sm:p-6">
                    <div className="grid gap-4">
                      <ActivityCompletionCalendar
                        entityId={entity.id}
                        trackingDates={entity.trackingDates}
                        onMarkComplete={() => queryClient.invalidateQueries({ queryKey: ['entities'] })}
                        onOpenDetail={() => navigate(`/entities/${entity.id}`)}
                      />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <CreateEntityDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        defaultType={filterType || 'PROJECT'}
        lockType={!!filterType}
        onCreated={(entity) => {
          queryClient.invalidateQueries({ queryKey: ['entities'] });
          onCreated?.(entity);
          const createdEntity = entity as Entity & { _optimisticId?: string };
          if (!createdEntity._optimisticId) return;
          queryClient.setQueryData(qk.entity(createdEntity.id), createdEntity);
          navigate(`/entities/${createdEntity.id}`);
        }}
      />
      <ConfirmDialog
        open={!!pendingDeleteEntity}
        onOpenChange={(open) => !open && setPendingDeleteEntity(null)}
        title={t('entities_delete_one_title')}
        description={
          pendingDeleteEntity
            ? t('entities_delete_one_desc', { title: pendingDeleteEntity.title || t('notes_untitled') })
            : ''
        }
        confirmText={t('common_delete')}
        destructive
        onConfirm={confirmDelete}
      />
    </>
  );
}
