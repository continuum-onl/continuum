import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { notesApi } from "@/lib/api";
import { usePlanGate } from "@/hooks/usePlanGate";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queries";
import { useLanguage } from "@/contexts/LanguageContext";
import { nextNumberedNoteTitle } from "@/lib/numbered-note-title";

interface UseCreateNoteOptions {
  /** Called when the plan limit is reached (e.g. open the upgrade modal). */
  onLimitReached?: () => void;
}

/**
 * Centralised, reliable "create a new note" action.
 * Creates the note on the server first, then navigates to the real note id.
 * This avoids the previous optimistic flow that could leave the user stranded
 * on a temporary URL when the backend was slow or the request failed.
 */
export function useCreateNote(options: UseCreateNoteOptions = {}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { canCreateNote, refresh, applyUsageDelta } = usePlanGate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const inFlight = useRef(false);
  const untitledPrefix = t("notes_untitled").toLowerCase();

  const createNote = useCallback(async () => {
    if (inFlight.current) return;

    if (!canCreateNote) {
      options.onLimitReached?.();
      return;
    }

    inFlight.current = true;
    setCreating(true);
    applyUsageDelta({ notesCount: 1 });
    const optimisticId = `optimistic-note-${Date.now()}`;
    const optimisticNote = {
      id: optimisticId,
      title: untitledPrefix,
      content: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    queryClient.setQueryData(qk.notes(), (prev: any[] | undefined) => [optimisticNote, ...(prev ?? [])]);

    try {
      const notesResponse = await notesApi.list();
      if (!Array.isArray(notesResponse.data)) throw new Error("Could not load notes");
      const title = nextNumberedNoteTitle(
        notesResponse.data.map((note: { title?: string }) => note.title ?? ""),
        untitledPrefix,
        ["Untitled", "Sin título", "Sem título", "Sans titre"]
      );
      queryClient.setQueryData(qk.notes(), (prev: any[] | undefined) =>
        (prev ?? []).map((note) => note.id === optimisticId ? { ...note, title } : note)
      );

      const { data } = await notesApi.create(title, "");
      if (!data?.id) throw new Error("Invalid response from server");
      queryClient.setQueryData(qk.note(data.id), data);
      queryClient.setQueryData(qk.notes(), (prev: any[] | undefined) =>
        (prev ?? []).map((note) => note.id === optimisticId ? data : note)
      );
      void queryClient.invalidateQueries({ queryKey: qk.notes() });
      void refresh();
      navigate(`/notes/${data.id}`);
    } catch (err: any) {
      queryClient.setQueryData(qk.notes(), (prev: any[] | undefined) =>
        (prev ?? []).filter((note) => note.id !== optimisticId)
      );
      applyUsageDelta({ notesCount: -1 });
      if (err?.response?.status === 403) {
        options.onLimitReached?.();
      } else {
        toast({
          title: "Could not create note",
          description: err?.response?.data?.message || "Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      inFlight.current = false;
      setCreating(false);
    }
  }, [canCreateNote, applyUsageDelta, refresh, navigate, toast, options, queryClient, untitledPrefix]);

  return { createNote, creating, canCreateNote };
}