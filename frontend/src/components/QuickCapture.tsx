import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Zap } from "@/lib/heroicons";
import { notesApi } from "@/lib/api";
import { qk } from "@/lib/queries";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { nextNumberedNoteTitle } from "@/lib/numbered-note-title";

const COPY = {
  en: { capture: "Quick capture", captureDesc: "Write it down now. It will be saved as a numbered quick note.", placeholder: "An idea, a task, a thought…", save: "Save", saved: "Captured", failed: "Could not save" },
  pt: { capture: "Captura rápida", captureDesc: "Anote agora. Ela será salva como uma quicknote numerada.", placeholder: "Uma ideia, tarefa, pensamento…", save: "Salvar", saved: "Capturado", failed: "Não foi possível salvar" },
  es: { capture: "Captura rápida", captureDesc: "Anótalo ahora. Se guardará como una quicknote numerada.", placeholder: "Una idea, tarea, pensamiento…", save: "Guardar", saved: "Capturado", failed: "No se pudo guardar" },
  fr: { capture: "Capture rapide", captureDesc: "Notez-le maintenant. Elle sera enregistrée comme quicknote numérotée.", placeholder: "Une idée, une tâche, une pensée…", save: "Enregistrer", saved: "Capturé", failed: "Échec de l'enregistrement" },
};
const QUICK_CAPTURE_TITLE_PREFIXES = ["Quick capture", "Quicknote", "Captura rápida", "Capture rapide"];

interface QuickCaptureProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}

export function QuickCapture({ open: controlledOpen, onOpenChange, showTrigger = true }: QuickCaptureProps) {
  const { language } = useLanguage();
  const c = COPY[(language as keyof typeof COPY)] ?? COPY.en;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const setOpen = useCallback((nextOpen: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [controlledOpen, onOpenChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "n") { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const save = async () => {
    const value = text.trim();
    if (!value || saving) return;
    setSaving(true);
    try {
      const response = await notesApi.list();
      if (!Array.isArray(response.data)) throw new Error("Could not load notes");
      const title = nextNumberedNoteTitle(
        response.data.map((note: { title?: string }) => note.title ?? ""),
        c.capture.toLowerCase(),
        QUICK_CAPTURE_TITLE_PREFIXES
      );
      await notesApi.create(title, value);
      void qc.invalidateQueries({ queryKey: qk.notes() });
      toast({ title: c.saved });
      setText("");
      setOpen(false);
    } catch {
      toast({ title: c.failed, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {showTrigger && (
        <Button variant="secondary" size="icon" aria-label={c.capture} title={`${c.capture} (Ctrl+Shift+N)`}
          onClick={() => setOpen(true)} className="h-12 w-12 shrink-0 rounded-2xl">
          <Zap className="h-4 w-4" />
        </Button>
      )}

      <Dialog open={open} onOpenChange={o => !o && setOpen(false)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">{c.capture}</DialogTitle>
            <DialogDescription>{c.captureDesc}</DialogDescription>
          </DialogHeader>
          <textarea autoFocus value={text} onChange={e => setText(e.target.value)} placeholder={c.placeholder} rows={5}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); } }}
            className="w-full resize-none rounded-2xl bg-muted/50 p-4 text-sm text-foreground outline-none placeholder:text-muted-foreground" />
          <Button onClick={save} disabled={!text.trim() || saving} className="rounded-full">{c.save}</Button>
        </DialogContent>
      </Dialog>

    </>
  );
}
