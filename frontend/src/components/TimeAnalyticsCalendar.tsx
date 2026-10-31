import { useMemo } from 'react';
import {
  format,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay
} from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar, BarChart3 } from "@/lib/heroicons";
import { useTimeAnalytics } from '@/hooks/useTimeAnalytics';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { getDateFnsLocale } from '@/lib/date-format';

interface TimeAnalyticsCalendarProps {
  projectId?: string; // Filter analytics by project
  onDayClick?: (dayData: any) => void;
}

/**
 * Interactive calendar component for time analytics
 * Shows monthly view with time spent per day
 * Can be filtered by projectId for project-specific analytics
 */
export function TimeAnalyticsCalendar({ projectId, onDayClick }: TimeAnalyticsCalendarProps) {
  const { language } = useLanguage();
  const dateFnsLocale = getDateFnsLocale(language);
  const {
    currentDate,
    canAccessAnalytics,
    calendarDays,
    dayDataMap,
    monthlyStats,
    isLoading,
    navigateMonth,
    goToToday,
    getDayData
  } = useTimeAnalytics({ locale: dateFnsLocale });

  // Generate full calendar grid (including days from prev/next month for proper alignment)
  const fullCalendarGrid = useMemo(() => {
    const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    const calendarStart = startOfWeek(monthStart, { locale: dateFnsLocale });
    const calendarEnd = endOfWeek(monthEnd, { locale: dateFnsLocale });

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentDate, dateFnsLocale]);

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const getIntensityClass = (seconds: number): string => {
    if (seconds === 0) return 'bg-zinc-50 dark:bg-zinc-900';
    if (seconds < 1800) return 'bg-zinc-100 dark:bg-zinc-900/20'; // < 30min
    if (seconds < 3600) return 'bg-zinc-200 dark:bg-zinc-800/30'; // < 1h
    if (seconds < 7200) return 'bg-zinc-300 dark:bg-zinc-700/40'; // < 2h
    return 'bg-zinc-400 dark:bg-zinc-600/50'; // >= 2h
  };

  if (!canAccessAnalytics) {
    return (
      <Card className="p-8 text-center">
        <BarChart3 className="w-12 h-12 text-zinc-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-foreground mb-2">Analytics Premium</h3>
        <p className="text-sm text-zinc-500 mb-4">
          Upgrade your plan to access detailed time analytics and calendar view.
        </p>
        <Button>Upgrade Plan</Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Monthly Stats */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Monthly Summary
          </h3>
          <Badge variant="secondary">
            {format(currentDate, 'MMM yyyy', { locale: dateFnsLocale })}
          </Badge>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-zinc-500">
              {formatDuration(monthlyStats.totalSeconds)}
            </div>
            <div className="text-sm text-zinc-500">Total Time</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-zinc-500">
              {monthlyStats.activeDays}
            </div>
            <div className="text-sm text-zinc-500">Active Days</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-zinc-500">
              {monthlyStats.totalEntries}
            </div>
            <div className="text-sm text-zinc-500">Time Entries</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-zinc-500">
              {formatDuration(monthlyStats.averageDaily)}
            </div>
            <div className="text-sm text-zinc-500">Daily Average</div>
          </div>
        </div>
      </Card>

      {/* Calendar */}
      <Card className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Calendar className="w-6 h-6" />
            {format(currentDate, 'MMMM yyyy', { locale: dateFnsLocale })}
          </h2>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigateMonth('prev')}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={goToToday}
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigateMonth('next')}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1">
          {/* Day headers */}
          {fullCalendarGrid.slice(0, 7).map((date) => (
            <div key={date.toISOString()} className="p-2 text-center text-sm font-medium text-zinc-500">
              {format(date, "EEE", { locale: dateFnsLocale })}
            </div>
          ))}

          {/* Calendar days */}
          {fullCalendarGrid.map((date, index) => {
            const dayData = getDayData(date);
            const isCurrentMonth = isSameMonth(date, currentDate);
            const isToday = isSameDay(date, new Date());

            return (
              <div
                key={index}
                className={`
                  min-h-[80px] p-2 border border-zinc-200 dark:border-zinc-700 rounded-lg cursor-pointer
                  transition-all hover:shadow-md
                  ${isCurrentMonth ? 'bg-foreground dark:bg-zinc-800' : 'bg-zinc-50 dark:bg-zinc-900 opacity-50'}
                  ${isToday ? 'ring-2 ring-zinc-500' : ''}
                `}
                onClick={() => dayData && onDayClick?.(dayData)}
              >
                <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                  {format(date, 'd', { locale: dateFnsLocale })}
                </div>

                {isLoading ? (
                  <Skeleton className="h-4 w-12" />
                ) : dayData && dayData.totalSeconds > 0 ? (
                  <div className="space-y-1">
                    <div className={`text-xs px-2 py-1 rounded text-center text-foreground font-medium ${getIntensityClass(dayData.totalSeconds)}`}>
                      {formatDuration(dayData.totalSeconds)}
                    </div>
                    <div className="text-xs text-zinc-500 text-center">
                      {dayData.entries.length}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-zinc-400 text-center">-</div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}