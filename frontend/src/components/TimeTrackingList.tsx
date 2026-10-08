import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { entitiesApi } from '@/lib/api';
import { useTimeTracking, type TimeEntitySummary } from '@/hooks/useTimeTracking';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Plus, ChevronDown, FolderOpen, Loader2, Check } from "@/lib/heroicons";
import { CreateEntityDialog } from '@/components/CreateEntityDialog';
import { ListRowContent } from '@/components/ui/list-row-content';
import { EntityTypeIcon } from '@/components/ui/entity-type-icon';
import { useLanguage } from '@/contexts/LanguageContext';
import { ActivityCompletionCalendar } from '@/components/ActivityCompletionCalendar';
import type { Entity } from '@/types';
import { qk, STALE } from '@/lib/queries';

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
}: {
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
  const [internalCreateOpen, setInternalCreateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
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
    if (!lower) return all;
    return all.filter((e) =>
      [e.title, e.description, e.type].filter(Boolean).some((v) => String(v).toLowerCase().includes(lower)),
    );
  }, [lower, all]);

  useEffect(() => {
    onCountChange?.(all.length, visible.length);
  }, [all.length, visible.length, onCountChange]);

  const placeholder = filterType === 'PROJECT' ? t('tm_search_projects') : filterType === 'ACTIVITY' ? t('tm_search_activities') : t('tm_search_entities');


  const handleQuickComplete = async (entity: Entity) => {
    const key = qk.entities();
    const previous = queryClient.getQueryData<Entity[]>(key);
    const today = todayKey();
    // Optimistic: mark as done instantly, roll back on failure.
    queryClient.setQueryData<Entity[]>(key, (old) =>
      old?.map((e) => (e.id === entity.id ? { ...e, trackingDates: [...(e.trackingDates ?? []), today] } : e)),
    );
    toast({ title: t('tm_marked_done_title'), description: entity.title || t('tm_activity') });
    try {
      await entitiesApi.track(entity.id);
      void queryClient.invalidateQueries({ queryKey: ['entities'] });
    } catch {
      queryClient.setQueryData(key, previous);
      toast({ title: t('tm_could_not_mark_title'), variant: 'destructive' });
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
        <div className="flex justify-center py-24">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : visible.length === 0 ? (
        <div className="border border-dashed border-border/10 rounded-md py-16 text-center">
          <FolderOpen className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {filterType === 'PROJECT' ? t('tm_no_projects_yet') : filterType === 'ACTIVITY' ? t('tm_no_activities_yet') : t('tm_no_entities_yet')}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((entity) => {
            const summary = getSummaryForEntity(entity.id);
            const isOpen = openId === entity.id;
            const isProject = entity.type === 'PROJECT';
            const doneToday = isTrackedToday(entity.trackingDates);
            const marking = markingId === entity.id;

            return (
              <li
                key={entity.id}
                className="overflow-hidden rounded-2xl border border-border/10 bg-foreground/[0.02] transition-colors hover:border-border/20"
              >
                {/* Row header */}
                <div className="flex items-center gap-3 p-3 sm:p-4">
                  <button
                    onClick={() => setOpenId(isOpen ? null : entity.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    aria-expanded={isOpen}
                  >
                    <ListRowContent
                      icon={<EntityTypeIcon type={entity.type} className="h-5 w-5" />}
                      title={entity.title || t('tm_untitled')}
                      meta={
                        <>
                          {typeLabels[entity.type] ?? entity.type}
                          {' · '}
                          {isProject
                            ? summary?.formattedTotal || '00:00:00'
                            : t('tm_done_count', { count: entity.trackingDates?.length ?? 0 })}
                        </>
                      }
                      trailing={
                        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                      }
                    />
                  </button>


                  {/* Quick action: complete today for activities */}
                  {!isProject && (
                    <button
                      onClick={() => !doneToday && handleQuickComplete(entity)}
                      disabled={doneToday || marking}
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                        doneToday
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
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

                {/* Expanded detail */}
                {isOpen && (
                  <div className="border-t border-border/[0.06] bg-background/30 p-4 sm:p-6">
                    <div className="grid gap-4">
                      {isProject ? (
                        <div className="grid grid-cols-2 gap-3 max-w-md">
                          <div className="rounded-xl border border-border/10 bg-foreground/5 p-4">
                            <p className="label-caps text-muted-foreground">{t('tm_total_time')}</p>
                            <p className="mt-2 font-mono text-muted-foreground">{summary?.formattedTotal || '00:00:00'}</p>
                          </div>
                          <div className="rounded-xl border border-border/10 bg-foreground/5 p-4">
                            <p className="label-caps text-muted-foreground">{t('tm_sessions_cap')}</p>
                            <p className="mt-2 text-muted-foreground">{summary?.entriesCount ?? 0}</p>
                          </div>
                        </div>
                      ) : (
                        <ActivityCompletionCalendar
                          entityId={entity.id}
                          trackingDates={entity.trackingDates}
                          onMarkComplete={() => queryClient.invalidateQueries({ queryKey: ['entities'] })}
                          onOpenDetail={() => navigate(`/entities/${entity.id}`)}
                        />
                      )}
                      {entity.type !== 'ACTIVITY' && (
                        <div>
                          <button
                            onClick={() => navigate(`/entities/${entity.id}`)}
                            className="text-xs px-3 py-1.5 rounded-md border border-border/10 text-muted-foreground hover:text-foreground hover:border-border/30 transition-colors"
                          >
                            {t('tm_open_detail')}
                          </button>
                        </div>
                      )}
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
    </>
  );
}