import { format } from 'date-fns';
import { Clock, X, FileText } from "@/lib/heroicons";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLanguage } from '@/contexts/LanguageContext';
import { getDateFnsLocale } from '@/lib/date-format';

interface DayData {
  date: Date;
  totalSeconds: number;
  entries: Array<{
    id: string;
    entityId: string;
    entityTitle?: string;
    durationSeconds: number;
    note?: string;
  }>;
}

interface DayDetailsModalProps {
  dayData: DayData | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal showing detailed time entries for a specific day
 */
export function DayDetailsModal({ dayData, isOpen, onClose }: DayDetailsModalProps) {
  const { t, language } = useLanguage();
  if (!dayData) return null;

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const totalHours = Math.floor(dayData.totalSeconds / 3600);
  const totalMinutes = Math.floor((dayData.totalSeconds % 3600) / 60);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            {format(dayData.date, 'EEEE, MMMM d, yyyy', { locale: getDateFnsLocale(language) })}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Summary */}
          <div className="bg-card rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg text-foreground">
                  {t('tm_total_time_colon', { time: formatDuration(dayData.totalSeconds) })}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t('tm_time_entry_count', { count: dayData.entries.length, word: dayData.entries.length === 1 ? t('tm_entry_singular') : t('tm_entry_plural') })}
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-muted-foreground">
                  {totalHours > 0 ? `${totalHours}:${totalMinutes.toString().padStart(2, '0')}` : `${totalMinutes}m`}
                </div>
              </div>
            </div>
          </div>

          {/* Time Entries */}
          <ScrollArea className="max-h-96">
            <div className="space-y-3">
              {dayData.entries.map((entry) => (
                <div
                  key={entry.id}
                  className="border border-border/10 rounded-lg p-4 bg-foreground"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="secondary">
                          {entry.entityTitle || t('tm_entity_fallback', { id: entry.entityId })}
                        </Badge>
                        <span className="text-sm font-medium text-muted-foreground">
                          {formatDuration(entry.durationSeconds)}
                        </span>
                      </div>

                      {entry.note && (
                        <div className="flex items-start gap-2 text-sm text-muted-foreground dark:text-muted-foreground">
                          <FileText className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <p className="line-clamp-2">{entry.note}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {dayData.entries.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{t('tm_no_entries_for_day')}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}