import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { metricsApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import type { Locale } from 'date-fns';
import { enUS } from 'date-fns/locale';

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

interface UseTimeAnalyticsOptions {
  initialDate?: Date;
  projectId?: string; // Filter by project
  locale?: Locale;
}

/**
 * Hook for managing time analytics calendar data and state
 * Can filter by specific project if projectId is provided
 */
export function useTimeAnalytics({ initialDate = new Date(), projectId, locale = enUS }: UseTimeAnalyticsOptions = {}) {
  const [currentDate, setCurrentDate] = useState(initialDate);
  const { user } = useAuth();

  const month = currentDate.getMonth() + 1; // date-fns uses 1-based months
  const year = currentDate.getFullYear();

  // Check if user can access analytics (premium feature)
  const plan = user?.plan || 'FREE';
  const canAccessAnalytics = plan !== 'FREE';

  // Fetch usage data for current month
  const {
    data: usageData,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['metrics', 'usage', month, year],
    queryFn: () => metricsApi.usage(month, year).then(r => r.data),
    enabled: canAccessAnalytics,
  });

  // Generate calendar grid for current month
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);

    return eachDayOfInterval({ start: monthStart, end: monthEnd });
  }, [currentDate]);

  // Process usage data into day data map
  const dayDataMap = useMemo(() => {
    const map = new Map<string, DayData>();

    if (!usageData) return map;

    // Initialize all calendar days
    calendarDays.forEach(date => {
      const dateKey = format(date, 'yyyy-MM-dd');
      map.set(dateKey, {
        date,
        totalSeconds: 0,
        entries: []
      });
    });

    // Aggregate data by day
    usageData.forEach((entry: any) => {
      // Filter by projectId if provided
      if (projectId && entry.entityId !== projectId) {
        return;
      }

      const dateKey = entry.date;
      const existing = map.get(dateKey);
      if (existing) {
        existing.totalSeconds += entry.durationSeconds;
        existing.entries.push({
          id: entry.id,
          entityId: entry.entityId,
          entityTitle: entry.entityTitle,
          durationSeconds: entry.durationSeconds,
          note: entry.note
        });
      }
    });

    return map;
  }, [usageData, calendarDays, projectId]);

  // Calculate monthly totals
  const monthlyStats = useMemo(() => {
    let totalSeconds = 0;
    let totalEntries = 0;
    let activeDays = 0;

    dayDataMap.forEach(dayData => {
      if (dayData.totalSeconds > 0) {
        totalSeconds += dayData.totalSeconds;
        totalEntries += dayData.entries.length;
        activeDays += 1;
      }
    });

    return {
      totalSeconds,
      totalEntries,
      activeDays,
      averageDaily: activeDays > 0 ? Math.round(totalSeconds / activeDays) : 0
    };
  }, [dayDataMap]);

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      if (direction === 'next') {
        newDate.setMonth(newDate.getMonth() + 1);
      } else {
        newDate.setMonth(newDate.getMonth() - 1);
      }
      return newDate;
    });
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const getDayData = (date: Date): DayData | undefined => {
    const dateKey = format(date, 'yyyy-MM-dd');
    return dayDataMap.get(dateKey);
  };

  return {
    // State
    currentDate,
    canAccessAnalytics,

    // Data
    calendarDays,
    dayDataMap,
    monthlyStats,

    // Loading states
    isLoading,
    error,

    // Actions
    navigateMonth,
    goToToday,
    getDayData,
    refetch,

    // Computed
    currentMonthName: format(currentDate, 'MMMM yyyy', { locale }),
    hasData: usageData && usageData.length > 0
  };
}