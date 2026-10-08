import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useIsRestoring } from "@tanstack/react-query";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { entitiesApi, notesApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  ArrowLeft, Loader2, Check, PanelRight, 
  FileText, X, Clock,
  Link2, AtSign, Eye, PenLine
} from "@/lib/heroicons";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { TiptapEditor, type TiptapEditorHandle } from "@/components/TiptapEditor";
import { BacklinksPanel } from "@/components/BacklinksPanel";
import { countTiptapMentions, extractMentionIds, extractMentionLabels, parseTiptapContent, sanitizeTiptapMentions, tiptapContentToPlainText } from "@/lib/tiptap-content";
import {
  loadWallpaperSettings,
  resolveVaultBlobFast,
  subscribeWallpaper,
  type NoteWallpaperSettings,
} from "@/lib/note-wallpaper";
import { useLanguage } from "@/contexts/LanguageContext";
import { getNoteFoldsSync, loadNoteFolds, saveNoteFolds } from "@/lib/note-folds";
import { getEditorReadOnlySync, loadEditorReadOnly, saveEditorReadOnly } from "@/lib/editor-mode";
import { loadNoteFontSize, subscribeNoteFontSize } from "@/lib/note-font-size";
import { queryClient } from "@/lib/query-client";
import { qk, STALE } from "@/lib/queries";

interface NoteData {
  id: string;
  title: string;
  content: any;
  type?: string;
  folderId?: string;
  entityIds: string[];
  createdAt: string;
  updatedAt: string;
}

const typeLabels: Record<string, string> = {
  PERSON: "Person",
  PROJECT: "Project",
  TOPIC: "Topic",
  ORGANIZATION: "Organization",
  ACTIVITY: "Activity",
};

export default function NoteEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { t } = useLanguage();
  const isMobile = useIsMobile();
  const isRestoring = useIsRestoring();
  const editorRef = useRef<TiptapEditorHandle>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const tempId = searchParams.get("tempId");
  const isOptimistic = searchParams.get("optimistic") === "true";
  const optimisticKey = tempId ? `optimistic-note:${tempId}` : null;
  const cachedNote = id ? queryClient.getQueryData<NoteData>(qk.note(id)) ?? null : null;

  const [note, setNote] = useState<NoteData | null>(cachedNote);
  const [title, setTitle] = useState(cachedNote?.title ?? "");
  const [type, setType] = useState<string>(cachedNote?.type ?? "");
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [allEntities, setAllEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(!cachedNote);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "creating">("idle");
  const [showBacklinks, setShowBacklinks] = useState(false);
  // The last mode the user left the editor in (view or edit) is restored.
  const [readOnly, setReadOnly] = useState<boolean>(() => getEditorReadOnlySync());
  const [noteTitleScale, setNoteTitleScale] = useState<number>(() => loadNoteFontSize().titleScale);
  const [noteBodyScale, setNoteBodyScale] = useState<number>(() => loadNoteFontSize().bodyScale);

  useEffect(() => {
    const unsubscribe = subscribeNoteFontSize((settings) => {
      setNoteTitleScale(settings.titleScale);
      setNoteBodyScale(settings.bodyScale);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--note-title-font-scale", String(noteTitleScale));
    document.documentElement.style.setProperty("--note-body-font-scale", String(noteBodyScale));
  }, [noteTitleScale, noteBodyScale]);

  useEffect(() => {
    if (!isMobile || typeof window === "undefined") {
      setKeyboardInset(0);
      document.documentElement.style.setProperty("--mobile-keyboard-offset", "0px");
      return;
    }

    const vv = window.visualViewport;
    const updateKeyboardOffset = () => {
      const rawOffset = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      const next = rawOffset > 120 ? rawOffset : 0;
      setKeyboardInset(next);
      document.documentElement.style.setProperty("--mobile-keyboard-offset", `${next}px`);
    };

    updateKeyboardOffset();
    vv?.addEventListener("resize", updateKeyboardOffset);
    vv?.addEventListener("scroll", updateKeyboardOffset);
    window.addEventListener("resize", updateKeyboardOffset);

    return () => {
      vv?.removeEventListener("resize", updateKeyboardOffset);
      vv?.removeEventListener("scroll", updateKeyboardOffset);
      window.removeEventListener("resize", updateKeyboardOffset);
      document.documentElement.style.setProperty("--mobile-keyboard-offset", "0px");
    };
  }, [isMobile]);

  useEffect(() => {
    void loadEditorReadOnly().then((v) => setReadOnly(v));
  }, []);

  // Close the context sidebar with Escape.
  useEffect(() => {
    if (!showBacklinks) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowBacklinks(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showBacklinks]);



  // ── Wallpaper (global to all notes, persisted in localStorage) ──────────
  const [wallpaper, setWallpaper] = useState<NoteWallpaperSettings>(() => loadWallpaperSettings());
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeWallpaper(setWallpaper);
    return () => { unsubscribe(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!wallpaper.fileId) { setWallpaperUrl(null); return; }
    resolveVaultBlobFast(wallpaper.fileId)
      .then((url) => { if (!cancelled) setWallpaperUrl(url); })
      .catch(() => { if (!cancelled) setWallpaperUrl(null); });
    return () => { cancelled = true; };
  }, [wallpaper.fileId]);

  // Wallpaper is configured in /profile; the editor only renders it.



  // ── Collapsed headings (persisted server-side per note) ────────────────
  const [foldedHeadings, setFoldedHeadings] = useState<number[] | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setFoldedHeadings(getNoteFoldsSync(id));
    loadNoteFolds(id).then((indices) => {
      if (!cancelled) setFoldedHeadings(indices);
    });
    return () => { cancelled = true; };
  }, [id]);

  const handleFoldChange = useCallback((indices: number[]) => {
    if (!id) return;
    saveNoteFolds(id, indices);
  }, [id]);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedJSON = useRef<string>(cachedNote ? JSON.stringify(parseTiptapContent(cachedNote.content)) : "");
  const lastSavedTitle = useRef<string>(cachedNote?.title ?? "");
  const lastSavedType = useRef<string>(cachedNote?.type ?? "");
  const currentJSON = useRef<any>(cachedNote ? parseTiptapContent(cachedNote.content) : null);

  const saveOptimisticDraft = (draft: { title: string; type: string; content: any }) => {
    if (!optimisticKey) return;
    try {
      sessionStorage.setItem(optimisticKey, JSON.stringify(draft));
    } catch {
      // ignore storage failures
    }
  };

  const loadOptimisticDraft = () => {
    if (!optimisticKey) return null;
    try {
      const raw = sessionStorage.getItem(optimisticKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const clearOptimisticDraft = () => {
    if (!optimisticKey) return;
    try {
      sessionStorage.removeItem(optimisticKey);
    } catch {
      // ignore
    }
  };

  const contentForMetadata = currentJSON.current ?? note?.content;

  const mentionLabels = useMemo(() => extractMentionLabels(contentForMetadata), [contentForMetadata]);

  const mentionedEntities = useMemo(() => {
    if (!note?.entityIds?.length) return [];
    const entitiesById = new Map(allEntities.map((entity) => [entity.id, entity]));
    return note.entityIds.map((entityId) => {
      return (
        entitiesById.get(entityId) ?? {
          id: entityId,
          title: mentionLabels.get(entityId) ?? `@${entityId}`,
          type: undefined,
        }
      );
    });
  }, [note?.entityIds, allEntities, mentionLabels]);
  const mentionCounts = useMemo(
    () => countTiptapMentions(contentForMetadata),
    [contentForMetadata]
  );

  const characterCount = useMemo(
    () => tiptapContentToPlainText(contentForMetadata).length,
    [contentForMetadata]
  );

  const noteScore = useMemo(() => {
    const entityMentions = mentionCounts.entityMentions;
    const noteMentions = mentionCounts.noteMentions;
    const baseScore = entityMentions * 0.8 + noteMentions * 0.5 + Math.min(2, Math.log10(Math.max(1, characterCount)));
    return Number(Math.max(0, Math.min(10, baseScore)).toFixed(1));
  }, [mentionCounts, characterCount]);

  useEffect(() => {
    if (isRestoring) return;
    if (!id) return;
    let cancelled = false;
    const optimistic = searchParams.get("optimistic") === "true";

    if (optimistic) {
      setLoading(true);
      const placeholderContent = { type: "doc", content: [{ type: "paragraph" }] };
      setNote({
        id,
        title: "Untitled",
        content: placeholderContent,
        type: undefined,
        folderId: undefined,
        entityIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setTitle("Untitled");
      setType("");
      setAllEntities([]);
      currentJSON.current = placeholderContent;
      lastSavedTitle.current = "Untitled";
      lastSavedType.current = "";
      lastSavedJSON.current = JSON.stringify(placeholderContent);
      setSaveStatus("creating");
      setLoading(false);

      Promise.allSettled([
        queryClient.fetchQuery({ queryKey: qk.entities(), queryFn: () => entitiesApi.list().then((response) => response.data), staleTime: STALE.list }),
        queryClient.fetchQuery({ queryKey: qk.noteTypes(), queryFn: () => notesApi.getTypes().then((response) => response.data), staleTime: STALE.list }),
      ])
        .then(([entitiesResult, typesResult]) => {
          if (cancelled) return;
          if (entitiesResult.status === "fulfilled" && Array.isArray(entitiesResult.value)) {
            setAllEntities(entitiesResult.value);
          }
          if (typesResult.status === "fulfilled" && Array.isArray(typesResult.value)) {
            setAvailableTypes(typesResult.value);
          }
        })
        .catch(() => {
          /* ignore fetch details for optimistic placeholder */
        });
    } else {
      const cached = queryClient.getQueryData<NoteData>(qk.note(id));
      if (cached) {
        const parsedContent = parseTiptapContent(cached.content);
        const cachedNoteData = { ...cached, content: parsedContent };
        setNote(cachedNoteData);
        setTitle(cached.title);
        setType(cached.type ?? "");
        currentJSON.current = parsedContent;
        lastSavedTitle.current = cached.title;
        lastSavedType.current = cached.type ?? "";
        lastSavedJSON.current = JSON.stringify(parsedContent);
        setLoading(false);
      } else {
        setNote(null);
        setTitle("");
        setType("");
        currentJSON.current = null;
        setLoading(true);
      }

      // Paint from cache instantly (even if stale); revalidate in the background.
      const swr = <T,>(queryKey: readonly unknown[], queryFn: () => Promise<T>, staleTime: number) => {
        const cached = queryClient.getQueryData<T>(queryKey);
        if (cached !== undefined) {
          void queryClient.fetchQuery({ queryKey, queryFn, staleTime }).catch((error) => {
            console.warn("[note editor] Cached data refresh failed", error);
          });
          return Promise.resolve(cached);
        }
        return queryClient.fetchQuery({ queryKey, queryFn, staleTime });
      };
      Promise.allSettled([
        swr(qk.note(id), () => notesApi.get(id).then((response) => response.data as NoteData), STALE.detail),
        swr(qk.entities(), () => entitiesApi.list().then((response) => response.data), STALE.list),
        swr(qk.noteTypes(), () => notesApi.getTypes().then((response) => response.data), STALE.list),
      ])
        .then(([noteResult, entitiesResult, typesResult]) => {
          if (noteResult.status !== "fulfilled") throw noteResult.reason;
          if (cancelled) return;

          const data = noteResult.value as NoteData;
          const parsedContent = parseTiptapContent(data.content);
          const userEntities =
            entitiesResult.status === "fulfilled" && Array.isArray(entitiesResult.value)
              ? entitiesResult.value
              : [];
          
          setAllEntities(userEntities);

          const sanitized = userEntities.length > 0
            ? sanitizeTiptapMentions(parsedContent, userEntities)
            : { doc: parsedContent, entityIds: extractMentionIds(parsedContent), changed: false, removedIds: [] };
          
          const normalizedContent = sanitized.doc;

          if (typesResult.status === "fulfilled" && Array.isArray(typesResult.value)) {
            setAvailableTypes(typesResult.value);
          }

          const optimisticDraft = loadOptimisticDraft();
          const draftTitle = optimisticDraft?.title ?? data.title;
          const draftType = optimisticDraft?.type ?? data.type ?? "";
          const draftContent = optimisticDraft?.content ?? normalizedContent;
          const hasDraftChanges = optimisticDraft && (
            draftTitle !== data.title ||
            draftType !== (data.type ?? "") ||
            JSON.stringify(draftContent) !== JSON.stringify(normalizedContent)
          );

          setNote({
            ...data,
            content: draftContent,
            entityIds: sanitized.entityIds,
            type: draftType,
          });
          setTitle(draftTitle);
          setType(draftType);
          lastSavedTitle.current = data.title;
          lastSavedType.current = data.type || "";
          currentJSON.current = draftContent;
          lastSavedJSON.current = JSON.stringify(normalizedContent);

          if (hasDraftChanges) {
            setSaveStatus("saving");
            void doSave(draftTitle, draftContent, draftType).finally(() => {
              clearOptimisticDraft();
            });
          } else {
            setSaveStatus("idle");
            clearOptimisticDraft();
          }

          if (sanitized.changed) {
            void notesApi.update(id, {
              title: data.title,
              content: normalizedContent,
              entityIds: sanitized.entityIds,
            });
          }
        })
        .catch(() => {
          if (cancelled) return;
          if (cached) {
            console.warn(`[note editor] Could not refresh note ${id}; retaining cached content`);
          } else {
            toast({ title: t("ed_note_not_found"), variant: "destructive" });
            navigate("/notes");
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    return () => {
      cancelled = true;
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [id, isRestoring, navigate, searchParams, toast]);

  const doSave = useCallback(async (nextTitle: string, json: any, newType: string) => {
    if (!id) return;
    const jsonStr = JSON.stringify(json);
    if (nextTitle === lastSavedTitle.current && jsonStr === lastSavedJSON.current && newType === lastSavedType.current) return;

    setSaveStatus("saving");
    try {
      const entityIds = extractMentionIds(json);
      await notesApi.update(id, {
        title: nextTitle,
        content: json,
        entityIds,
        type: newType,
      });

      setNote((prev) => prev ? { ...prev, title: nextTitle, content: json, entityIds, type: newType } : null);
      queryClient.setQueryData(qk.note(id), (previous: NoteData | undefined) => previous ? { ...previous, title: nextTitle, content: json, entityIds, type: newType } : previous);
      void queryClient.invalidateQueries({ queryKey: qk.notes() });
      void queryClient.invalidateQueries({ queryKey: qk.graph() });

      lastSavedTitle.current = nextTitle;
      lastSavedJSON.current = jsonStr;
      lastSavedType.current = newType;
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (error: any) {
      setSaveStatus("idle");
      if (error?.response?.status === 401) {
        toast({ title: t("ed_session_expired"), variant: "destructive" });
      } else {
        toast({ title: t("ed_error_saving"), variant: "destructive" });
      }
    }
  }, [id, toast]);

  const scheduleAutoSave = useCallback((t: string, json: any, newType: string) => {
    if (isOptimistic) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => doSave(t, json, newType), 900);
  }, [doSave, isOptimistic]);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    setNote((prev) => (prev ? { ...prev, title: val } : prev));
    if (isOptimistic) {
      saveOptimisticDraft({ title: val, type, content: currentJSON.current });
      return;
    }
    scheduleAutoSave(val, currentJSON.current, type);
  };

  const handleTypeChange = (val: string) => {
    setType(val);
    setNote((prev) => (prev ? { ...prev, type: val } : prev));
    if (isOptimistic) {
      saveOptimisticDraft({ title, type: val, content: currentJSON.current });
      return;
    }
    scheduleAutoSave(title, currentJSON.current, val);
  };

  const handleEditorChange = useCallback((json: any) => {
    currentJSON.current = json;
    setNote((prev) =>
      prev ? { ...prev, content: json, entityIds: extractMentionIds(json) } : prev
    );
    if (isOptimistic) {
      saveOptimisticDraft({ title, type, content: json });
      return;
    }
    scheduleAutoSave(title, json, type);
  }, [title, type, scheduleAutoSave, isOptimistic]);

  // ── Guaranteed save on exit ────────────────────────────────────────────
  const latestRef = useRef({ title, type, isOptimistic });
  latestRef.current = { title, type, isOptimistic };

  const flushSave = useCallback(() => {
    const { title: t0, type: ty, isOptimistic: opt } = latestRef.current;
    if (opt || !id) return;
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    const json = editorRef.current?.getJSON() ?? currentJSON.current;
    if (!json) return;
    void doSave(t0, json, ty);
  }, [doSave, id]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushSave();
    };
    const onPageHide = () => flushSave();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
      flushSave();
    };
  }, [flushSave]);


  if (loading) {
    return (
      <AppLayout>
        <div className="flex justify-center items-center h-full">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="relative flex h-dvh min-h-0 overflow-hidden bg-background">
        {/* Wallpaper layer (global, per-user) - covers entire editor area including sidebar */}
        {wallpaperUrl && (
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center"
            style={{
              backgroundImage: `url(${wallpaperUrl})`,
              filter: `blur(${wallpaper.blur}px) brightness(${wallpaper.brightness}%)`,
              transform: wallpaper.blur > 0 ? "scale(1.05)" : undefined,
            }}
          />
        )}
        {wallpaperUrl && (
          <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 bg-background/55" />
        )}

        {/* Main Editor Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">

          {/* Top Toolbar */}
          <header className="relative z-10 flex shrink-0 items-center justify-between border-b border-border/5 bg-background/70 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur-md lg:pt-3">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/notes"))} className="text-muted-foreground hover:text-foreground w-8 h-8">
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <div className="h-4 w-[1px] bg-border/10 mx-2" />
              
              {/* Status Indicator */}
              <div className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5 bg-foreground/5 px-2.5 py-1 rounded-full">
                {saveStatus === "creating" && <><Loader2 className="w-3 h-3 animate-spin" /> {t("ed_creating")}</>}
                {saveStatus === "saving" && <><Loader2 className="w-3 h-3 animate-spin" /> {t("ed_saving")}</>}
                {saveStatus === "saved" && <><Check className="w-3 h-3 text-emerald-400" /> {t("ed_saved")}</>}
                {saveStatus === "idle" && <><FileText className="w-3 h-3" /> {t("ed_ready")}</>}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Read / write mode */}
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 transition-colors ${readOnly ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => {
                  if (!readOnly) flushSave();
                  setReadOnly((v) => {
                    saveEditorReadOnly(!v);
                    return !v;
                  });
                }}
                title={readOnly ? t("ed_edit_mode") : t("ed_view_mode")}
                aria-pressed={readOnly}
              >
                {readOnly ? <Eye className="h-4 w-4" /> : <PenLine className="h-4 w-4" />}
              </Button>




              <Button variant="ghost" size="icon" className={`w-8 h-8 transition-colors ${showBacklinks ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`} onClick={() => setShowBacklinks(!showBacklinks)} title={t("ed_toggle_side_panel")}>
                <PanelRight className="w-4 h-4" />
              </Button>
            </div>
          </header>

          {/* Editor Canvas */}
          <div className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth">
            <div
              className="mx-auto w-full max-w-[750px] px-6 pt-12 lg:px-12"
              style={{
                paddingBottom: `calc(${Math.max(7 * 16, keyboardInset + 140)}px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))`,
              }}
            >
              <Input
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                readOnly={readOnly}
                placeholder={t("ed_untitled_note")}
                className="text-5xl lg:text-6xl font-display font-bold border-0 px-0 focus-visible:ring-0 bg-transparent text-foreground mb-8 h-auto placeholder:text-muted-foreground/30 tracking-tight"
                style={{ fontSize: `${Math.max(2.2, 3.1 * (noteTitleScale / 100))}rem` }}
              />

              {currentJSON.current && (
                <div className="prose prose-invert prose-p:leading-relaxed prose-headings:font-display max-w-none">
                  <TiptapEditor
                    ref={editorRef}
                    content={currentJSON.current}
                    onChange={handleEditorChange}
                    editable={!readOnly}
                    currentNoteId={note?.id}
                    onSave={flushSave}
                    foldedHeadings={foldedHeadings}
                    onFoldedHeadingsChange={handleFoldChange}
                  />


                </div>
              )}
            </div>
          </div>
          
          {/* Footer Metadata */}
          {note?.updatedAt && (
            <div className="pointer-events-none absolute bottom-[calc(0.5rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] left-4 flex items-center gap-1.5 rounded-md border border-border/5 bg-background/80 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur">
              <Clock className="w-3 h-3" />
              {t("ed_edited", { date: new Date(note.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) })}
            </div>
          )}
        </div>

        {/* Click-outside overlay for the context sidebar */}
        {showBacklinks && (
          <div
            aria-hidden="true"
            className="absolute inset-0 z-20"
            onPointerDown={() => setShowBacklinks(false)}
          />
        )}

        {/* Combined Context Sidebar */}
        <aside

          aria-hidden={!showBacklinks}
          className={`absolute right-0 top-0 bottom-0 z-30 flex w-full max-w-[20rem] flex-col overflow-hidden border-l border-border/5 bg-background/80 backdrop-blur-2xl transition-transform duration-300 ease-in-out
          ${showBacklinks ? "translate-x-0" : "pointer-events-none translate-x-full"}`}
        >
          
          <div className="flex items-center justify-between border-b border-border/5 px-5 py-4 shrink-0">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("ed_context")}</p>
              <h3 className="mt-0.5 text-sm font-medium text-foreground">{t("ed_note_connections")}</h3>
            </div>
            <Button variant="ghost" size="icon" className="w-6 h-6 text-muted-foreground hover:text-foreground" onClick={() => setShowBacklinks(false)}>
              <X className="w-3 h-3" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Note type */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <FileText className="w-3 h-3" />
                <span>{t("ed_note_type")}</span>
              </div>
              <div className="flex gap-2">
                {availableTypes.length > 0 && (
                  <Select value={type} onValueChange={handleTypeChange}>
                    <SelectTrigger className="flex-1 bg-foreground/5 border-border/10 h-8 text-xs">
                      <SelectValue placeholder={t("ed_select_ellipsis")} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableTypes.map((tp) => (
                        <SelectItem key={tp} value={tp} className="text-xs">{tp}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Input
                  value={type}
                  onChange={(e) => handleTypeChange(e.target.value)}
                  placeholder={t("ed_or_new")}
                  className="flex-1 bg-foreground/5 border-border/10 h-8 text-xs"
                  maxLength={50}
                />
                {type && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-destructive/20 hover:text-destructive" onClick={() => handleTypeChange("")}>
                    <X className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-4">

              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <AtSign className="w-3 h-3" />
                <span>{t("ed_note_metadata")}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Card variant="subtle" className="border border-border/5 bg-background/40 p-3 backdrop-blur-xl">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{t("ed_score")}</p>
                  <p className="mt-2 text-sm font-medium text-foreground">{noteScore.toFixed(1)}</p>
                </Card>
                <Card variant="subtle" className="border border-border/5 bg-background/40 p-3 backdrop-blur-xl">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{t("ed_mentions")}</p>
                  <p className="mt-2 text-sm font-medium text-foreground">{mentionCounts.total}</p>
                </Card>
                <Card variant="subtle" className="border border-border/5 bg-background/40 p-3 backdrop-blur-xl">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{t("ed_entities")}</p>
                  <p className="mt-2 text-sm font-medium text-foreground">{note?.entityIds?.length ?? 0}</p>
                </Card>
                <Card variant="subtle" className="border border-border/5 bg-background/40 p-3 backdrop-blur-xl">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{t("ed_characters")}</p>
                  <p className="mt-2 text-sm font-medium text-foreground">{characterCount}</p>
                </Card>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <AtSign className="w-3 h-3" />
                <span>{t("ed_mentioned_entities")}</span>
              </div>
              
              {mentionedEntities.length === 0 ? (
                <p className="text-xs italic text-muted-foreground/60 pl-1">
                  {t("ed_mention_hint")}
                </p>
              ) : (
                <ul className="space-y-2">
                  {mentionedEntities.map((entity) => (
                    <li key={entity.id}>
                      <Button
                        variant="ghost"
                        onClick={() => navigate(`/entities/${entity.id}`)}
                        className="w-full h-auto flex flex-col items-start gap-1 rounded-md border border-border/5 bg-background/40 p-2.5 text-left normal-case tracking-normal backdrop-blur-xl hover:bg-background/60 hover:border-border/10"
                      >
                        <span className="w-full break-words text-xs font-medium leading-snug text-muted-foreground line-clamp-2">
                          {entity.title || t("ed_untitled_entity")}
                        </span>
                        {entity.type && (
                          <Badge variant="meta" className="px-1.5 py-0 text-[9px]">
                            {typeLabels[entity.type] || entity.type}
                          </Badge>
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-border/5 pt-4">
              <div className="flex items-center gap-1.5 mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Link2 className="w-3 h-3" />
                <span>{t("ed_linked_mentions")}</span>
              </div>
              {id && <BacklinksPanel noteId={id} />}
            </div>
          </div>
        </aside>

      </div>
    </AppLayout>
  );
}