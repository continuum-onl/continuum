import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback } from "react";
import { STALE } from "@/lib/queries";

/**
 * Stale-while-revalidate resource hook.
 *
 * Paints the previously cached value immediately (the cache is persisted in
 * IndexedDB, so it also survives reloads and app restarts) and refreshes it in
 * the background. `loading` is only true on the very first load with no cache.
 */
export function useCachedResource<T>(
  key: QueryKey,
  fetcher: () => Promise<T>,
  options?: {
    staleTime?: number;
    enabled?: boolean;
    refetchInterval?: number | false;
    refetchOnMount?: boolean | "always";
  }
) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: key,
    queryFn: fetcher,
    staleTime: options?.staleTime ?? STALE.list,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
    refetchOnMount: options?.refetchOnMount,
  });

  const setData = useCallback(
    (updater: T | ((prev: T | undefined) => T)) => {
      qc.setQueryData<T>(key, updater as never);
    },
    [qc, key]
  );

  return {
    data: query.data,
    /** First paint only — a cached value never shows a skeleton. */
    loading: query.isLoading && query.data === undefined,
    refreshing: query.isFetching,
    error: query.error,
    refetch: query.refetch,
    setData,
  };
}
