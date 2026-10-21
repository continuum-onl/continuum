import { memo, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { ArrowUpRight, Calendar, Link2, Network, StickyNote, X, Tag } from "@/lib/heroicons";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExpandableEntityDescription } from "@/components/ExpandableEntityDescription";
import SmoothDrawer from "@/components/ui/smooth-drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEntityStore, type InspectableEntity, type InspectableNote } from "@/contexts/EntityContext";
import { entitiesApi, notesApi } from "@/lib/api";
import { tiptapContentToPlainText } from "@/lib/tiptap-content";
import type { Entity, EntityStats, Note } from "@/types";
import { useLanguage } from "@/contexts/LanguageContext";

function getEntityTypeConfig(t: (key: string) => string, type: string): { label: string } {
  const key = `ent_type_${type.toLowerCase()}`;
  const translated = t(key);
  return { label: translated === key ? type : translated };
}

interface RelatedNote {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
}

interface SideInspectorProps {
  isOpen: boolean;
  entity: InspectableEntity | null;
  onClose: () => void;
  mobileBottomSheet?: boolean;
}

const truncateText = (value: string, maxLength = 220) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

const formatDate = (value?: string) => (value ? new Date(value).toLocaleDateString("en-US") : "—");

export const SideInspector = memo(function SideInspector({ isOpen, entity, onClose, mobileBottomSheet: mobileBottomSheetProp = false }: SideInspectorProps) {
  const isMobile = useIsMobile();
  const drawerMode = mobileBottomSheetProp && isMobile;
  const mobileBottomSheet = mobileBottomSheetProp && !drawerMode;
  const navigate = useNavigate();
  const { openInspector, setLoadingEntityId } = useEntityStore();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [resolvedFromApi, setResolvedFromApi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedEntity, setResolvedEntity] = useState<InspectableEntity | null>(null);
  const [relatedNotes, setRelatedNotes] = useState<RelatedNote[]>([]);
  const [relatedEntities, setRelatedEntities] = useState<Entity[]>([]);
  const [stats, setStats] = useState<EntityStats | null>(null);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [mobilePanelHeight, setMobilePanelHeight] = useState(() =>
    typeof window === "undefined" ? 240 : Math.max(200, Math.round(window.innerHeight * 0.32))
  );
  const dragStart = useRef<{ y: number; height: number } | null>(null);
  const dragMoved = useRef(false);

  useEffect(() => {
    if (!mobileBottomSheet) return;
    setMobileExpanded(false);
    setMobilePanelHeight(Math.max(200, Math.round(window.innerHeight * 0.32)));
  }, [entity?.id, isOpen, mobileBottomSheet]);

  useEffect(() => {
    if (!mobileBottomSheet) return;
    const resize = () => setMobilePanelHeight(Math.max(200, Math.round(window.innerHeight * (mobileExpanded ? 0.7 : 0.32))));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [mobileBottomSheet, mobileExpanded]);

  useEffect(() => {
    if (!entity || !isOpen) {
      return;
    }

    let cancelled = false;

    setResolvedEntity(entity);
    setResolvedFromApi(false);
    setLoading(true);
    setError(null);
    setStats(null);
    setRelatedNotes([]);
    setRelatedEntities([]);
    setLoadingEntityId(entity.id);

    const loadInspectorData = async () => {
      try {
        if (entity.type === "NOTE") {
          const { data } = await notesApi.get(entity.id);

          if (cancelled) {
            return;
          }

          const noteData = data as Partial<Note> & {
            userId?: string;
            entityIds?: string[];
            content?: string;
          };
          const plainText = tiptapContentToPlainText(noteData.content);

          setResolvedEntity({
            id: noteData.id || entity.id,
            title: noteData.title || entity.title,
            type: "NOTE",
            content: noteData.content || "",
            description: plainText ? truncateText(plainText) : undefined,
            tags: Array.isArray(noteData.tags) ? noteData.tags : [],
            entityIds: Array.isArray(noteData.entityIds) ? noteData.entityIds : [],
            ownerId:
              typeof noteData.ownerId === "string"
                ? noteData.ownerId
                : typeof noteData.userId === "string"
                  ? noteData.userId
                  : "",
            createdAt: noteData.createdAt || "",
            updatedAt: noteData.updatedAt || noteData.createdAt || "",
            // preserve custom note type for inspector UI
            noteType: typeof (noteData as { type?: unknown }).type === "string" ? (noteData as { type: string }).type : "",
          } satisfies InspectableNote);
          setResolvedFromApi(true);
          return;
        }

        const [entityRes, notesRes, connectionsRes, statsRes] = await Promise.all([
          entitiesApi.get(entity.id),
          entitiesApi.getNotes(entity.id),
          entitiesApi.getConnections(entity.id),
          entity.type === "ACTIVITY" ? entitiesApi.stats(entity.id) : Promise.resolve(null),
        ]);

        if (cancelled) {
          return;
        }

        setResolvedEntity(entityRes.data);
        setRelatedNotes(Array.isArray(notesRes.data) ? notesRes.data : []);
        setRelatedEntities(
          (Array.isArray(connectionsRes.data) ? connectionsRes.data : []).filter(
            (item: Entity) => item.id !== entity.id
          )
        );
        setStats(statsRes ? statsRes.data : null);
        setResolvedFromApi(true);
      } catch {
        if (!cancelled) {
          setError(t("ent_could_not_load"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadingEntityId(null);
        }
      }
    };

    void loadInspectorData();

    return () => {
      cancelled = true;
      setLoadingEntityId(null);
    };
  }, [entity, isOpen, setLoadingEntityId]);

  if (!entity) {
    return null;
  }

  const displayEntity = resolvedEntity || entity;
  const config = getEntityTypeConfig(t, displayEntity.type);
  const isNote = displayEntity.type === "NOTE";
  const activityTotalCompletions = Array.isArray((displayEntity as Entity).trackingDates)
    ? (displayEntity as Entity).trackingDates?.length ?? 0
    : stats?.totalCompletions ?? 0;
  const weeklyCompletionRate = (() => {
    const value = stats?.weeklyCompletionRate ?? 0;
    return value <= 1 ? value * 100 : value;
  })();
  const notePreview = isNote
    ? (() => {
        const note = displayEntity as InspectableNote;
        const previewSource = note.description || tiptapContentToPlainText(note.content);
        return previewSource ? truncateText(previewSource) : "No content available.";
      })()
    : "";
  const inspectorMobileHeight = `${mobilePanelHeight}px`;
  const inspectorMobileStyle = mobileBottomSheet
    ? { "--mobile-inspector-height": inspectorMobileHeight } as React.CSSProperties
    : undefined;

  const panel = (
    <AnimatePresence mode="wait">
      {isOpen && (
        <motion.div
          initial={mobileBottomSheet && window.innerWidth < 1024 ? { opacity: 0, y: 40 } : { opacity: 0, x: 320 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={mobileBottomSheet && window.innerWidth < 1024 ? { opacity: 0, y: 40 } : { opacity: 0, x: 320 }}
          transition={{ duration: 0.25 }}
          style={inspectorMobileStyle}
          className={drawerMode ? "flex h-full min-h-0 w-full flex-col" : mobileBottomSheet
            ? "relative z-40 flex h-[var(--mobile-inspector-height)] max-h-[70dvh] w-full flex-none flex-col overflow-hidden rounded-t-3xl border-t border-border/10 bg-background/95 shadow-2xl backdrop-blur-xl lg:fixed lg:bottom-0 lg:right-0 lg:top-0 lg:h-auto lg:max-h-none lg:w-[22rem] lg:rounded-none lg:rounded-l-2xl lg:border-l lg:border-t-0"
            : "fixed right-0 top-0 bottom-0 z-40 w-[22rem] border-l border-border/10 bg-background/95 backdrop-blur-xl shadow-2xl"}
        >
          {mobileBottomSheet && (
            <div
              className="shrink-0 border-b border-border/10 px-4 pb-3 [touch-action:none] lg:hidden"
              role="group"
              onTouchStart={event => {
                if (event.target instanceof HTMLElement && event.target.closest("[data-inspector-close]")) return;
                const touch = event.touches[0];
                if (!touch) return;
                dragStart.current = { y: touch.clientY, height: mobilePanelHeight };
                dragMoved.current = false;
              }}
              onTouchMove={event => {
                const start = dragStart.current;
                const touch = event.touches[0];
                if (!start || !touch) return;
                event.preventDefault();
                const delta = start.y - touch.clientY;
                if (Math.abs(delta) > 4) dragMoved.current = true;
                const minHeight = Math.max(200, Math.round(window.innerHeight * 0.32));
                const maxHeight = Math.round(window.innerHeight * 0.7);
                setMobilePanelHeight(Math.max(minHeight, Math.min(maxHeight, start.height + delta)));
              }}
              onTouchEnd={event => {
                const start = dragStart.current;
                const touch = event.changedTouches[0];
                if (!start || !touch) return;
                const minHeight = Math.max(200, Math.round(window.innerHeight * 0.32));
                const maxHeight = Math.round(window.innerHeight * 0.7);
                const height = Math.max(minHeight, Math.min(maxHeight, start.height + start.y - touch.clientY));
                const expanded = height > window.innerHeight * 0.5;
                dragStart.current = null;
                setMobileExpanded(expanded);
                setMobilePanelHeight(Math.round(window.innerHeight * (expanded ? 0.7 : 0.32)));
              }}
              onTouchCancel={() => { dragStart.current = null; }}
              onClick={event => {
                if (event.target instanceof HTMLElement && event.target.closest("[data-inspector-close]")) return;
                if (dragMoved.current) {
                  dragMoved.current = false;
                  return;
                }
                const expanded = !mobileExpanded;
                setMobileExpanded(expanded);
                setMobilePanelHeight(Math.max(200, Math.round(window.innerHeight * (expanded ? 0.7 : 0.32))));
              }}
            >
              <button
                type="button"
                className="flex w-full touch-none flex-col items-center pb-3 pt-2"
                aria-label={t(mobileExpanded ? "ent_collapse_details" : "ent_expand_details")}
                aria-expanded={mobileExpanded}
                onClick={event => {
                  event.stopPropagation();
                  if (dragMoved.current) {
                    dragMoved.current = false;
                    return;
                  }
                  const expanded = !mobileExpanded;
                  setMobileExpanded(expanded);
                  setMobilePanelHeight(Math.max(200, Math.round(window.innerHeight * (expanded ? 0.7 : 0.32))));
                }}
              >
                <span className="h-1.5 w-10 rounded-full bg-muted-foreground/40" />
              </button>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="label-caps text-muted-foreground">{config.label}</p>
                  <h2 className="mt-1 break-words font-serif text-lg leading-tight tracking-tight text-foreground">{displayEntity.title}</h2>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  data-inspector-close
                  onPointerDown={event => event.stopPropagation()}
                  onClick={event => { event.stopPropagation(); onClose(); }}
                  aria-label={t("ent_close")}
                  className="h-8 w-8 shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {isNote ? notePreview : displayEntity.description || t("ent_no_description_added")}
              </div>
            </div>
          )}
          {mobileBottomSheet && !mobileExpanded && (
            <div className="min-h-0 flex-1 overflow-hidden px-4 pb-3 lg:hidden" aria-hidden="true" />
          )}
          <ScrollArea className={drawerMode ? "min-h-0 flex-1" : mobileBottomSheet
            ? mobileExpanded ? "min-h-0 flex-1 overscroll-contain lg:h-full" : "hidden lg:block lg:h-full"
            : "h-full"}
          >
            <div className="space-y-4 p-6">
              <div className={mobileBottomSheet ? "hidden items-start justify-between gap-3 lg:flex" : "flex items-start justify-between gap-3"}>
                <div className="min-w-0 flex-1">
                  <p className="label-caps text-muted-foreground">
                    {config.label}
                  </p>
                  <h2 className="mt-2 font-serif text-2xl tracking-tight text-foreground break-words">{displayEntity.title}</h2>
                  {!loading && resolvedFromApi && displayEntity.createdAt && (
                    <p className="mt-2 text-[10px] font-mono text-muted-foreground">
                      {formatDate(displayEntity.createdAt)}
                    </p>
                  )}
                </div>
                <motion.button
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={onClose}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={t("ent_close")}
                >
                  <X className="h-3.5 w-3.5" />
                </motion.button>
              </div>

              <div className="h-px bg-border/10" />

              {loading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, index) => (
                    <div key={index} className="h-20 animate-pulse rounded-xl bg-muted/50" />
                  ))}
                </div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-3"
                >
                  {error && (
                    <div className="rounded-2xl bg-card/40 p-4">
                      <p className="text-xs text-muted-foreground">{error}</p>
                    </div>
                  )}

                  {isNote ? (
                    <>
                      <div className="rounded-2xl bg-card/40 p-4">
                        <h3 className="mb-3 label-caps text-muted-foreground">{t("ent_summary")}</h3>
                        <div className="space-y-3">
                          <p className="text-xs leading-relaxed text-muted-foreground">{notePreview}</p>
                          <div className="space-y-2 border-t border-border/10 pt-3">
                            <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                              <span className="inline-flex items-center gap-1.5">
                                <Link2 className="h-3 w-3" />
                                {t("ent_mentioned_entities")}
                              </span>
                              <span className="font-semibold text-muted-foreground">{(displayEntity as InspectableNote).entityIds?.length ?? 0}</span>
                            </div>
                            <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                              <span className="inline-flex items-center gap-1.5">
                                <Calendar className="h-3 w-3" />
                                {t("ent_last_update")}
                              </span>
                              <span className="font-semibold text-muted-foreground">{formatDate((displayEntity as InspectableNote).updatedAt)}</span>
                            </div>
                              {/* Note Type display + clear action */}
                              {displayEntity?.noteType ? (
                                <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                                  <span className="inline-flex items-center gap-1.5">
                                    <Tag className="h-3 w-3" />
                                    {t("ent_note_type")}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-muted-foreground">{(displayEntity as any).noteType}</span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={async () => {
                                        try {
                                          setLoading(true);
                                          await notesApi.update(displayEntity.id, { type: "" });
                                          // update local state
                                          setResolvedEntity((prev) => prev ? ({ ...prev, noteType: "" } as any) : prev);
                                          toast({ title: t("ent_type_removed") });
                                        } catch {
                                          toast({ title: t("ent_failed_remove_type"), variant: "destructive" });
                                        } finally {
                                          setLoading(false);
                                        }
                                      }}
                                      className="h-5 w-5 p-0 hover:bg-muted"
                                    >
                                      <X className="h-3 w-3 text-muted-foreground" />
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                          </div>
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        className="w-full gap-2 border-border/10 hover:bg-muted"
                        onClick={() => {
                          navigate(`/notes/${displayEntity.id}`);
                          onClose();
                        }}
                      >
                        <ArrowUpRight className="h-3.5 w-3.5" />
                        <span className="text-xs font-medium">{t("ent_open_note")}</span>
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="rounded-2xl bg-card/40 p-4">
                        <h3 className="mb-3 label-caps text-muted-foreground">{t("ent_metadata")}</h3>
                        <div className="space-y-2 text-[10px] font-mono text-muted-foreground">
                          <div className="flex items-center justify-between">
                            <span className="inline-flex items-center gap-1.5">
                              <Calendar className="h-3 w-3" />
                              {t("ent_created")}
                            </span>
                            <span className="font-semibold text-muted-foreground">{formatDate(displayEntity.createdAt)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="inline-flex items-center gap-1.5">
                              <Network className="h-3 w-3" />
                              {t("ent_connections")}
                            </span>
                            <span className="font-semibold text-muted-foreground">{relatedEntities.length}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="inline-flex items-center gap-1.5">
                              <Tag className="h-3 w-3" />
                              {t("ent_type")}
                            </span>
                            <span className="font-semibold text-muted-foreground">{config.label}</span>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl bg-card/40 p-4">
                        <h3 className="mb-3 label-caps text-muted-foreground">{t("ent_details")}</h3>
                        <div className="space-y-3">
                          {displayEntity.description ? (
                            <ExpandableEntityDescription
                              key={displayEntity.id}
                              description={displayEntity.description}
                              className="text-xs leading-relaxed text-muted-foreground"
                            />
                          ) : (
                            <p className="text-xs text-muted-foreground">{t("ent_no_description_added")}</p>
                          )}
                          <div className="grid grid-cols-2 gap-2 border-t border-border/10 pt-3">
                            <div className="text-center text-[10px] font-mono">
                              <div className="font-semibold text-foreground">{relatedNotes.length}</div>
                              <div className="mt-1 text-muted-foreground">{t("ent_notes")}</div>
                            </div>
                            <div className="text-center text-[10px] font-mono">
                              <div className="font-semibold text-foreground">{relatedEntities.length}</div>
                              <div className="mt-1 text-muted-foreground">{t("ent_connections")}</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {displayEntity.type === "ACTIVITY" && (
                        <div className="rounded-2xl bg-card/40 p-4">
                          <h3 className="mb-3 label-caps text-muted-foreground">{t("ent_activity_metrics")}</h3>
                          <div className="grid grid-cols-2 gap-3 text-center text-[10px] font-mono">
                            <div>
                              <div className="font-semibold text-foreground">{activityTotalCompletions}</div>
                              <p className="mt-1 text-muted-foreground">{t("ent_total_tracked")}</p>
                            </div>
                            <div>
                              <div className="font-semibold text-foreground">{Math.round(weeklyCompletionRate)}%</div>
                              <p className="mt-1 text-muted-foreground">{t("ent_weekly")}</p>
                            </div>
                          </div>
                        </div>
                      )}


                      <div className="rounded-2xl bg-card/40 p-4">
                        <h3 className="mb-3 label-caps text-muted-foreground">{t("ent_connected_notes")}</h3>
                        <div className="space-y-2">
                          {relatedNotes.length > 0 ? (
                            (mobileBottomSheet ? relatedNotes : relatedNotes.slice(0, 5)).map((note) => (
                              <button
                                key={note.id}
                                onClick={() => {
                                  navigate(`/notes/${note.id}`);
                                  onClose();
                                }}
                                className="flex w-full items-start gap-2 rounded-xl border border-border/10 px-2.5 py-2 text-left transition-colors hover:bg-muted"
                              >
                                <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs text-foreground">{note.title}</p>
                                  <p className="text-[9px] text-muted-foreground">{formatDate(note.updatedAt || note.createdAt)}</p>
                                </div>
                              </button>
                            ))
                          ) : (
                            <p className="text-xs text-muted-foreground">{t("ent_no_connected_notes")}</p>
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-card/40 p-4">
                        <h3 className="mb-3 label-caps text-muted-foreground">{t("ent_related_entities")}</h3>
                        <div className="space-y-2">
                          {relatedEntities.length > 0 ? (
                            (mobileBottomSheet ? relatedEntities : relatedEntities.slice(0, 5)).map((relatedEntity) => (
                              <button
                                key={relatedEntity.id}
                                onClick={() => openInspector(relatedEntity)}
                                className="flex w-full items-center justify-between rounded-xl border border-border/10 px-2.5 py-2 text-left transition-colors hover:bg-muted"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-xs text-foreground">{relatedEntity.title}</p>
                                  <p className="text-[9px] text-muted-foreground">
                                    {getEntityTypeConfig(t, relatedEntity.type).label}
                                  </p>
                                </div>
                                <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                              </button>
                            ))
                          ) : (
                            <p className="text-xs text-muted-foreground">{t("ent_no_related_entities")}</p>
                          )}
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        className="w-full gap-2 border-border/10 hover:bg-muted"
                        onClick={() => {
                          navigate(`/entities/${displayEntity.id}`);
                          onClose();
                        }}
                      >
                        <ArrowUpRight className="h-3.5 w-3.5" />
                        <span className="text-xs font-medium">{t("ent_open_entity")}</span>
                      </Button>
                    </>
                  )}
                </motion.div>
              )}
            </div>
          </ScrollArea>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (drawerMode) {
    return (
      <SmoothDrawer key={entity?.id} expandable dragFromContent open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }} hideHeader title={entity?.title ?? ""}>
        {panel}
      </SmoothDrawer>
    );
  }
  return panel;
});

SideInspector.displayName = "SideInspector";
