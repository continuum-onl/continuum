import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { timeTrackingApi } from "@/lib/api";
import { useTimeTracking, type TimeEntry } from "@/hooks/useTimeTracking";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import SmoothDrawer from "@/components/ui/smooth-drawer";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Check, Loader2, Trash2 } from "@/lib/heroicons";
import { formatLocalizedDate } from "@/lib/date-format";

interface ProjectDayTimeEntriesProps {
  entityId: string;
  date: string | null;
  onOpenChange: (open: boolean) => void;
}

export function ProjectDayTimeEntries({ entityId, date, onOpenChange }: ProjectDayTimeEntriesProps) {
  const { language, t } = useLanguage();
  const { toast } = useToast();
  const { deleteEntryAsync, updateEntry } = useTimeTracking();
  const queryClient = useQueryClient();
  const queryKey = ["timeTracking", "entries", entityId, date];
  const [editMinutes, setEditMinutes] = useState<Record<string, string>>({});
  const [busyOperation, setBusyOperation] = useState<{ entryId: string; action: "save" | "delete" } | null>(null);
  const [pendingDeleteEntryId, setPendingDeleteEntryId] = useState<string | null>(null);

  const {
    data: entries = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!date) return [];
      // Use the same inclusive source as the heatmap, not Mongo's exclusive Between query.
      const response = await timeTrackingApi.getAllInRange(date, date);
      return (response.data as TimeEntry[]).filter((entry) => entry.entityId === entityId && entry.date === date);
    },
    enabled: !!date,
  });

  const saveDuration = async (entry: TimeEntry) => {
    const minutes = Number(editMinutes[entry.id] ?? entry.durationSeconds / 60);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      toast({ title: t("tm_duration_must_be_positive"), variant: "destructive" });
      return;
    }
    setBusyOperation({ entryId: entry.id, action: "save" });
    try {
      const durationSeconds = Math.max(1, Math.round(minutes * 60));
      await updateEntry({ entryId: entry.id, durationSeconds });
      queryClient.setQueryData<TimeEntry[]>(queryKey, (current) =>
        current?.map((item) => item.id === entry.id ? { ...item, durationSeconds } : item),
      );
      setEditMinutes((current) => {
        const next = { ...current };
        delete next[entry.id];
        return next;
      });
      toast({ title: t("tm_duration_updated") });
    } catch {
      toast({ title: t("ent_error"), variant: "destructive" });
    } finally {
      setBusyOperation(null);
    }
  };

  const removeEntry = async (entryId: string) => {
    setBusyOperation({ entryId, action: "delete" });
    try {
      await deleteEntryAsync(entryId);
      queryClient.setQueryData<TimeEntry[]>(queryKey, (current) => current?.filter((item) => item.id !== entryId));
      toast({ title: t("tm_entry_deleted") });
    } catch {
      toast({ title: t("ent_error"), variant: "destructive" });
    } finally {
      setBusyOperation(null);
    }
  };

  const formattedDate = date
    ? formatLocalizedDate(date, language, { dateStyle: "full" })
    : "";
  const totalSeconds = entries.reduce((total, entry) => total + (entry.durationSeconds || 0), 0);
  const formattedTotal = [
    Math.floor(totalSeconds / 3600),
    Math.floor((totalSeconds % 3600) / 60),
    totalSeconds % 60,
  ].map((part) => String(part).padStart(2, "0")).join(":");

  return (
    <SmoothDrawer
      open={!!date}
      onOpenChange={onOpenChange}
      title={formattedDate}
      description={t("tm_project_day_entries")}
    >
      <div className="space-y-4 px-5 pb-6">
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : isError ? (
          <div className="space-y-3 py-4 text-center">
            <p role="alert" className="text-sm text-destructive">{t("common_tryAgain")}</p>
            <Button variant="outline" onClick={() => void refetch()}>{t("common_tryAgain")}</Button>
          </div>
        ) : (
          <>
            <p className="border-b border-border/10 pb-3 font-mono text-sm text-foreground">
              {t("tm_total_time_colon", { time: formattedTotal })}
            </p>
            {entries.length === 0 ? (
              <p className="py-1 text-sm text-muted-foreground">{t("tm_no_entries_yet")}</p>
            ) : (
              <ul className="divide-y divide-border/10">
                {entries.map((entry) => {
                  const minutes = editMinutes[entry.id] ?? String(entry.durationSeconds / 60);
                  const saving = busyOperation?.entryId === entry.id && busyOperation.action === "save";
                  const deleting = busyOperation?.entryId === entry.id && busyOperation.action === "delete";
                  return (
                    <li key={entry.id} className="flex flex-wrap items-center gap-2 py-3">
                      <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                        {entry.source}{entry.note ? ` · ${entry.note}` : ""}
                      </span>
                      <label className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1 / 60}
                          step="any"
                          value={minutes}
                          onChange={(event) => setEditMinutes((current) => ({ ...current, [entry.id]: event.target.value }))}
                          aria-label={t("tm_edit_duration")}
                          className="h-9 w-24 rounded-lg border border-border/15 bg-foreground/[0.03] px-2 text-right font-mono text-sm text-foreground"
                        />
                        <span className="text-xs text-muted-foreground">{t("tm_minutes_short")}</span>
                      </label>
                      <Button
                        size="iconSm"
                        variant="ghost"
                        onClick={() => void saveDuration(entry)}
                        disabled={busyOperation !== null}
                        title={t("tm_save")}
                        aria-label={t("tm_save")}
                      >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      </Button>
                      <Button
                        size="iconSm"
                        variant="ghost"
                        onClick={() => setPendingDeleteEntryId(entry.id)}
                        disabled={busyOperation !== null}
                        title={t("tm_delete_entry")}
                        aria-label={t("tm_delete_entry")}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
      <ConfirmDialog
        open={pendingDeleteEntryId !== null}
        onOpenChange={(open) => !open && setPendingDeleteEntryId(null)}
        title={t("tm_delete_entry_confirm_title")}
        description={t("tm_delete_entry_confirm_description")}
        confirmText={t("common_delete")}
        destructive
        onConfirm={() => pendingDeleteEntryId ? removeEntry(pendingDeleteEntryId) : undefined}
      />
    </SmoothDrawer>
  );
}
