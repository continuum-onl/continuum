import { useEffect, useState } from "react";
import { useIsRestoring } from "@tanstack/react-query";
import { useLanguage } from "@/contexts/LanguageContext";
import { useParams, useNavigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { entitiesApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Loader2, Edit, StickyNote, Network, Calendar, Tag, Trash2 } from "@/lib/heroicons";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { InsightSignalBadge } from "@/components/InsightSignal";

import { useToast } from "@/hooks/use-toast";
import { ActivityAnalyticsCalendar } from "@/components/ActivityAnalyticsCalendar";
import { EntityTypeIcon } from "@/components/ui/entity-type-icon";
import { TimerWidget } from "@/components/TimerWidget";
import { TimeHeatmap } from "@/components/TimeHeatmap";
import type { HeatmapData, EntityStats } from "@/types";
import { useTimeTracking } from "@/hooks/useTimeTracking";
import { usePlanGate } from "@/hooks/usePlanGate";
import { queryClient } from "@/lib/query-client";
import { qk, STALE } from "@/lib/queries";


interface EntityData { id: string; title: string; type: string; description?: string; trackingDates?: string[]; createdAt: string; }

interface RelatedNote { id: string; title: string; createdAt: string; updatedAt: string; }

function DetailStat({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Calendar }) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md bg-secondary/60 px-3 py-2.5 sm:gap-2.5 sm:px-4">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block whitespace-normal break-words text-[9px] font-medium uppercase leading-snug tracking-[0.12em] text-muted-foreground sm:text-[10px] sm:tracking-[0.16em]">{label}</span>
        <span className="mt-1 block whitespace-normal break-words font-serif text-base leading-snug text-foreground tabular-nums sm:text-lg">{value}</span>
      </span>
    </div>
  );
}

export default function EntityDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const isRestoring = useIsRestoring();
  const { applyUsageDelta, refresh: refreshUsage } = usePlanGate();
  const [entity, setEntity] = useState<EntityData | null>(() => id ? queryClient.getQueryData<EntityData>(qk.entity(id)) ?? null : null);
  const [heatmap, setHeatmap] = useState<HeatmapData>({});
  const [stats, setStats] = useState<EntityStats | null>(() => id ? queryClient.getQueryData<EntityStats>(qk.entityStats(id)) ?? null : null);
  const [loading, setLoading] = useState(() => !id || !queryClient.getQueryData(qk.entity(id)));
  const [editingTitle, setEditingTitle] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [newDescription, setNewDescription] = useState("");
  const [editingType, setEditingType] = useState(false);
  const [newType, setNewType] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [relatedNotes, setRelatedNotes] = useState<RelatedNote[]>(() => id ? queryClient.getQueryData<RelatedNote[]>(qk.entityNotes(id)) ?? [] : []);
  const [relatedEntities, setRelatedEntities] = useState<EntityData[]>(() => id
    ? (queryClient.getQueryData<EntityData[]>(qk.entityConnections(id)) ?? []).filter((item) => item.id !== id)
    : []);

  // Time tracking
  const { formatSeconds } = useTimeTracking();

  useEffect(() => {
    if (isRestoring) return;
    if (!id) return;
    let cancelled = false;
    const cachedEntity = queryClient.getQueryData<EntityData>(qk.entity(id));
    const cachedNotes = queryClient.getQueryData<RelatedNote[]>(qk.entityNotes(id));
    const cachedConnections = queryClient.getQueryData<EntityData[]>(qk.entityConnections(id));

    if (cachedEntity) {
      setEntity(cachedEntity);
      setLoading(false);
    } else {
      setEntity(null);
      setLoading(true);
    }
    setRelatedNotes(cachedNotes ?? []);
    setRelatedEntities((cachedConnections ?? []).filter((item) => item.id !== id));
    if (cachedEntity?.type === "ACTIVITY") {
      const cachedHeatmap = queryClient.getQueryData<unknown>(qk.entityHeatmap(id));
      const cachedStats = queryClient.getQueryData<EntityStats>(qk.entityStats(id));
      if (cachedHeatmap !== undefined) {
        setHeatmap(normalizeHeatmapData(cachedHeatmap));
      } else {
        setHeatmap(buildHeatmapFromTrackingDates(cachedEntity.trackingDates || []));
      }
      if (cachedStats) setStats(cachedStats);
      else setStats(null);
    } else {
      setHeatmap({});
      setStats(null);
    }

    const loadEntity = async () => {
      try {
        let data: EntityData;
        try {
          data = await queryClient.fetchQuery({
            queryKey: qk.entity(id),
            queryFn: () => entitiesApi.get(id).then((response) => response.data as EntityData),
            staleTime: STALE.detail,
          });
        } catch (error) {
          if (!cachedEntity) throw error;
          console.warn(`[entity detail] Refresh failed for ${id}; showing cached entity`, error);
          data = cachedEntity;
        }

        if (cancelled) {
          return;
        }

        setEntity(data);
        setLoading(false);

        const fetchDetail = async <T,>(
          queryKey: readonly unknown[],
          queryFn: () => Promise<T>,
          label: string,
        ): Promise<T | undefined> => {
          try {
            return await queryClient.fetchQuery({ queryKey, queryFn, staleTime: STALE.detail });
          } catch (error) {
            console.warn(`[entity detail] ${label} refresh failed for ${id}`, error);
            return queryClient.getQueryData<T>(queryKey);
          }
        };

        const [notesData, connectionsData, heatmapData, statsData] = await Promise.all([
          fetchDetail(qk.entityNotes(id), () => entitiesApi.getNotes(id).then((response) => response.data), "connected notes"),
          fetchDetail(qk.entityConnections(id), () => entitiesApi.getConnections(id).then((response) => response.data), "connections"),
          data.type === "ACTIVITY"
            ? fetchDetail(qk.entityHeatmap(id), () => entitiesApi.heatmap(id).then((response) => response.data), "heatmap")
            : Promise.resolve(undefined),
          data.type === "ACTIVITY"
            ? fetchDetail(qk.entityStats(id), () => entitiesApi.stats(id).then((response) => response.data as EntityStats), "statistics")
            : Promise.resolve(undefined),
        ]);

        if (cancelled) {
          return;
        }

        if (Array.isArray(notesData)) setRelatedNotes(notesData);
        if (Array.isArray(connectionsData)) {
          setRelatedEntities(connectionsData.filter((item: EntityData) => item.id !== id));
        }
        if (data.type === "ACTIVITY") {
          const apiHeatmap = normalizeHeatmapData(heatmapData);
          const trackingHeatmap = buildHeatmapFromTrackingDates(data.trackingDates || []);
          setHeatmap(Object.keys(apiHeatmap).length > 0 ? apiHeatmap : trackingHeatmap);
          if (statsData) {
            setStats({
              ...statsData,
              totalCompletions: Array.isArray(data.trackingDates)
                ? data.trackingDates.length
                : statsData.totalCompletions,
            });
          }
        } else {
          setHeatmap({});
          setStats(null);
        }
      } catch {
        if (!cancelled) {
          if (cachedEntity) {
            console.warn(`[entity detail] Could not refresh ${id}; retaining cached entity`);
          } else {
            toast({ title: t("ent_not_found"), variant: "destructive" });
            navigate("/entities");
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadEntity();

    return () => {
      cancelled = true;
    };
  }, [id, isRestoring, navigate, t, toast]);

  const normalizeHeatmapData = (payload: unknown): HeatmapData => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
    return Object.entries(payload).reduce<HeatmapData>((normalized, [key, value]) => {
      // Handle both "2026-04-12" and "2026-04-12T00:00:00.000Z" formats
      const dateKey = key.includes("T") ? key.split("T")[0] : key;
      const count = typeof value === "number" ? value : parseInt(String(value), 10);
      if (!Number.isNaN(count) && count >= 0) {
        normalized[dateKey] = (normalized[dateKey] || 0) + count;
      }
      return normalized;
    }, {});
  };

  const buildHeatmapFromTrackingDates = (dates: unknown[]): HeatmapData => {
    if (!Array.isArray(dates)) return {};
    
    const heatmap: HeatmapData = {};
    dates.forEach((date) => {
      try {
        // Handle both Date objects and ISO strings
        const dateObj = typeof date === "string" ? new Date(date) : date instanceof Date ? date : new Date(String(date));
        const dateKey = dateObj.toISOString().split("T")[0];
        heatmap[dateKey] = (heatmap[dateKey] || 0) + 1;
      } catch {
        // Skip invalid dates
      }
    });
    return heatmap;
  };

  const localToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0]; };
  const [trackDate, setTrackDate] = useState(localToday);
  const handleTrack = async (pickedDate?: string) => {
    if (!id) return;
    const today = pickedDate || localToday();

    try {
      // Optimistically update tracking dates and heatmap
      setEntity((prev) => {
        if (!prev) return prev;
        const normalizedDates = Array.from(
          new Set([...(prev.trackingDates || []).map((date) => date.split("T")[0]), today])
        );
        return {
          ...prev,
          trackingDates: normalizedDates,
        };
      });

      setHeatmap((prev) => ({
        ...prev,
        [today]: (prev[today] || 0) + 1,
      }));

      await entitiesApi.track(id, today);

      const [eRes, sRes, hRes] = await Promise.all([
        entitiesApi.get(id),
        entitiesApi.stats(id),
        entitiesApi.heatmap(id),
      ]);

      const freshData = eRes.data;
      const freshHeatmap = normalizeHeatmapData(hRes.data);
      if (!freshHeatmap[today]) {
        freshHeatmap[today] = 1;
      }

      setEntity(freshData);
      setStats(sRes.data);
      setHeatmap(freshHeatmap);
      toast({ title: t("ent_registered") });
    } catch {
      toast({ title: t("ent_error"), variant: "destructive" });
    }
  };

  const handleSaveTitle = async () => {
    if (!id || !newTitle.trim()) return;
    try {
      const { data } = await entitiesApi.update(id, { title: newTitle.trim() });
      setEntity(data);
      queryClient.setQueryData(qk.entity(id), data);
      void queryClient.invalidateQueries({ queryKey: ["entities", "list"] });
      setEditingTitle(false);
      toast({ title: t("ent_name_updated") });
    } catch { toast({ title: t("ent_error_updating"), variant: "destructive" }); }
  };

  const handleSaveDescription = async () => {
    if (!id) return;
    try {
      const { data } = await entitiesApi.update(id, { description: newDescription.trim() });
      setEntity(data);
      queryClient.setQueryData(qk.entity(id), data);
      void queryClient.invalidateQueries({ queryKey: ["entities", "list"] });
      setEditingDescription(false);
      toast({ title: t("ent_description_updated") });
    } catch { toast({ title: t("ent_error_updating_description"), variant: "destructive" }); }
  };

  const handleSaveType = async () => {
    if (!id || !newType) return;
    try {
      const { data } = await entitiesApi.update(id, { type: newType });
      setEntity(data);
      queryClient.setQueryData(qk.entity(id), data);
      void queryClient.invalidateQueries({ queryKey: ["entities", "list"] });
      setEditingType(false);
      toast({ title: t("ent_type_updated") ?? "Entity type updated" });
    } catch { toast({ title: t("ent_error_updating"), variant: "destructive" }); }
  };

  const handleDeleteEntity = async () => {
    if (!id || !entity) return;
    try {
      await entitiesApi.delete(id);
      await queryClient.invalidateQueries({ queryKey: ["trash"] });
      applyUsageDelta({ entitiesCount: -1, activitiesCount: entity.type === "ACTIVITY" ? -1 : 0 });
      void refreshUsage();
      queryClient.removeQueries({ queryKey: qk.entity(id) });
      void queryClient.invalidateQueries({ queryKey: qk.entities() });
      navigate("/entities");
    } catch {
      toast({ title: t("ls_entities_error_deleting"), variant: "destructive" });
    }
  };

  if (loading)
    return (
      <AppLayout>
        <div className="mx-auto w-full max-w-5xl animate-fade-in px-4 py-8 sm:px-6">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-4 h-10 w-2/3 max-w-sm" />
          <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton className="h-44 w-full" />
            <Skeleton className="h-44 w-full" />
          </div>
          <Skeleton className="mt-4 h-56 w-full" />
        </div>
      </AppLayout>
    );
  if (!entity) return null;

  const isHabit = entity.type === "ACTIVITY";
  const isProject = entity.type === "PROJECT";
  const today = new Date().toISOString().split("T")[0];
  const trackedToday = entity.trackingDates?.some((date) => date.startsWith(today));
  const totalCompletions = entity.trackingDates?.length ?? stats?.totalCompletions ?? 0;


  const typeLabelKey = `ent_type_${entity.type.toLowerCase()}`;
  const typeLabel = t(typeLabelKey) === typeLabelKey ? entity.type.charAt(0) + entity.type.slice(1).toLowerCase() : t(typeLabelKey);
  const entityTypeOptions = [
    { value: "TOPIC", label: t("ent_type_topic") },
    { value: "PERSON", label: t("ent_type_person") },
    { value: "ORGANIZATION", label: t("ent_type_organization") },
    { value: "PROJECT", label: t("ent_type_project") },
    { value: "ACTIVITY", label: t("ent_type_activity") },
  ];

  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-12">
        <Button
          variant="quiet"
          size="sm"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/entities"))}
          className="mb-5 h-auto rounded-full px-3 py-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> {t("ent_back")}
        </Button>

        <header className="mb-7 border-b border-border/10 pb-6 sm:pb-8">
          <div>
            <div className="flex items-start gap-4">
              <div className="mt-1 grid h-10 w-10 shrink-0 place-items-center text-muted-foreground sm:h-12 sm:w-12">
                <EntityTypeIcon type={entity.type} className="h-5 w-5 sm:h-6 sm:w-6" />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{typeLabel}</span>
                  <InsightSignalBadge kind="entity" id={entity.id} />
                </div>
                {editingTitle ? (
                  <div className="flex flex-wrap gap-2">
                    <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={t("ent_new_name_placeholder")} className="min-w-0 flex-1" />
                    <Button size="sm" onClick={handleSaveTitle}>{t("ent_save")}</Button>
                    <Button size="sm" variant="outline" onClick={() => { setEditingTitle(false); setNewTitle(entity.title); }}>{t("ent_cancel")}</Button>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <h1 className="min-w-0 flex-1 break-words font-serif text-3xl leading-tight tracking-tight text-foreground sm:text-5xl">{entity.title}</h1>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="iconSm" onClick={() => { setEditingTitle(true); setNewTitle(entity.title); }} className="rounded-full text-muted-foreground hover:text-foreground" aria-label={t("ent_edit_name")}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="destructive" size="iconSm" onClick={() => setDeleteDialogOpen(true)} className="rounded-full" aria-label={t("common_delete")} title={t("common_delete")}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {editingDescription ? (
              <div className="mt-5 flex flex-col gap-2">
                <Textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder={t("ent_add_description_placeholder")} className="text-sm" rows={3} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSaveDescription}>{t("ent_save")}</Button>
                  <Button size="sm" variant="outline" onClick={() => { setEditingDescription(false); setNewDescription(entity.description || ""); }}>{t("ent_cancel")}</Button>
                </div>
              </div>
            ) : (
              <div className="group mt-4 flex items-start gap-2 sm:ml-[4.5rem]">
                <p className="min-w-0 flex-1 text-sm leading-6 text-muted-foreground">
                  {entity.description || <span className="italic text-muted-foreground/60">{t("ent_no_description")}</span>}
                </p>
                <Button variant="ghost" size="iconSm" onClick={() => { setEditingDescription(true); setNewDescription(entity.description || ""); }} className="shrink-0 rounded-full text-muted-foreground hover:text-foreground" aria-label={t("ent_edit_description")}>
                  <Edit className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {!isProject && (
              <div className="mt-6 grid grid-cols-2 gap-x-3 gap-y-4 sm:ml-[4.5rem] sm:gap-5">
              {isHabit ? (
                <>
                  <DetailStat label={t("ent_total_tracked")} value={totalCompletions} icon={Calendar} />
                  <DetailStat label={t("ent_connected_notes")} value={relatedNotes.length} icon={StickyNote} />
                </>
              ) : (
                <>
                  <DetailStat label={t("ent_connected_notes")} value={relatedNotes.length} icon={StickyNote} />
                  <DetailStat label={t("ent_created")} value={new Date(entity.createdAt).toLocaleDateString(language)} icon={Calendar} />
                </>
              )}
              </div>
            )}

            {isHabit && (
              <div className="mt-5 flex flex-col gap-2 border-t border-border/10 pt-4 sm:ml-[4.5rem] sm:flex-row sm:items-center">
                <Input type="date" value={trackDate} max={localToday()} onChange={(e) => setTrackDate(e.target.value)} className="h-10 w-full sm:w-auto" aria-label={t("tm_date")} />
                <Button size="sm" className="h-10 w-full rounded-xl sm:w-auto" onClick={() => handleTrack(trackDate)} disabled={!trackDate || trackDate > localToday()}>
                  {t("ent_save")}
                </Button>
                {trackedToday && <Badge variant="meta" className="self-center rounded-full px-3 py-1">{t("tm_done_today")}</Badge>}
              </div>
            )}
          </div>
        </header>

        {/* Type-specific primary block */}
        {isProject && (
          <div className="mb-7 space-y-4">
            <TimerWidget
              entityId={id!}
              entityName={entity.title}
              showSectionBorders={false}
              onTimerStart={() => toast({ title: t("ent_timer_started") })}
              onTimerStop={(duration) => toast({ title: t("ent_timer_stopped", { duration: formatSeconds(duration) }) })}
            />
            <TimeHeatmap entityId={id!} />
          </div>
        )}


        {isHabit && (
          <div className="mb-7">
            <ActivityAnalyticsCalendar trackingDates={entity.trackingDates} />
          </div>
        )}

        {/* Accordion sections */}
        <Accordion
          type="multiple"
          defaultValue={["metadata"]}
          className="border-t border-border/10"
        >
          <AccordionItem value="metadata" className="border-b border-border/10">
            <AccordionTrigger className="py-5 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground hover:no-underline">
              {t("ent_metadata")}
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-1 gap-3 pb-5 sm:grid-cols-3">
                <Card variant="faint" className="rounded-xl border border-border/10 bg-background/40 p-4">
                  <div className="label-caps text-muted-foreground mb-1.5 inline-flex items-center gap-1.5">
                    <Calendar className="h-3 w-3" /> {t("ent_created")}
                  </div>
                  <div className="text-sm text-foreground">{new Date(entity.createdAt).toLocaleDateString("en-US")}</div>
                </Card>
                <Card variant="faint" className="rounded-xl border border-border/10 bg-background/40 p-4">
                  <div className="label-caps text-muted-foreground mb-1.5 inline-flex items-center gap-1.5">
                    <Network className="h-3 w-3" /> {t("ent_connections")}
                  </div>
                  <div className="text-sm text-foreground">{relatedEntities.length}</div>
                </Card>
                <Card variant="faint" className="rounded-xl border border-border/10 bg-background/40 p-4">
                  <div className="label-caps text-muted-foreground mb-1.5 inline-flex items-center gap-1.5">
                    <Tag className="h-3 w-3" /> {t("ent_type")}
                  </div>
                  {editingType ? (
                    <div className="flex flex-col gap-2">
                      <select
                        value={newType}
                        onChange={(e) => setNewType(e.target.value)}
                        className="h-9 rounded-md border border-border/10 bg-background px-2 text-sm text-foreground"
                      >
                        {entityTypeOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleSaveType}>{t("ent_save")}</Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingType(false);
                            setNewType(entity.type);
                          }}
                        >
                          {t("ent_cancel")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm text-foreground">{typeLabel}</div>
                      <Button
                        variant="ghost"
                        size="iconSm"
                        onClick={() => {
                          setEditingType(true);
                          setNewType(entity.type);
                        }}
                        aria-label={t("ent_edit_type") ?? "Edit type"}
                      >
                        <Edit className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  )}
                </Card>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="notes" className="border-b border-border/10">
            <AccordionTrigger className="py-5 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground hover:no-underline">
              <span className="flex w-full items-center justify-between gap-3">
                <span>{t("ent_connected_notes")}</span>
                <span className="text-muted-foreground/60 normal-case tracking-normal">({relatedNotes.length})</span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-1 pb-5">
                {relatedNotes.length > 0 ? (
                  relatedNotes.map((note) => (
                    <Button
                      key={note.id}
                      variant="ghost"
                      onClick={() => navigate(`/notes/${note.id}`)}
                      className="flex h-auto w-full items-start justify-start gap-3 rounded-md border border-transparent px-3 py-3 text-left normal-case tracking-normal font-normal hover:bg-foreground/[0.035]"
                    >
                      <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">{note.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("ent_updated", { date: new Date(note.updatedAt).toLocaleDateString("en-US") })}
                        </p>
                      </div>
                    </Button>
                  ))
                ) : (
                  <p className="px-3 py-4 text-sm text-muted-foreground">{t("ent_no_connected_notes")}</p>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="entities" className="border-b border-border/10">
            <AccordionTrigger className="py-5 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground hover:no-underline">
              <span className="flex w-full items-center justify-between gap-3">
                <span>{t("ent_connected_entities")}</span>
                <span className="text-muted-foreground/60 normal-case tracking-normal">({relatedEntities.length})</span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-1 pb-5">
                {relatedEntities.length > 0 ? (
                  relatedEntities.map((ent) => (
                    <Button
                      key={ent.id}
                      variant="ghost"
                      onClick={() => navigate(`/entities/${ent.id}`)}
                      className="flex h-auto w-full items-start justify-start gap-3 rounded-md border border-transparent px-3 py-3 text-left normal-case tracking-normal font-normal hover:bg-foreground/[0.035]"
                    >
                      <Network className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">{ent.title}</p>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">{ent.type}</p>
                      </div>
                    </Button>
                  ))
                ) : (
                  <p className="px-3 py-4 text-sm text-muted-foreground">{t("ent_no_connected_entities")}</p>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t("entities_delete_one_title")}
        description={t("entities_delete_one_desc", { title: entity.title || t("notes_untitled") })}
        confirmText={t("common_delete")}
        destructive
        onConfirm={handleDeleteEntity}
      />
    </AppLayout>
  );
}
