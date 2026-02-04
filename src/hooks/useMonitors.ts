import { useState, useEffect, useCallback, useMemo } from "react";
import {
  getMonitors,
  startMonitor as startMonitorAPI,
  stopMonitor as stopMonitorAPI,
  fetchPRComments,
  type StartMonitorParams,
} from "@/lib/tauri";
import type { Monitor, PR } from "@/lib/types";

interface UseMonitorsOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface UseMonitorsReturn {
  monitors: Monitor[];
  monitorsMap: Map<string, Monitor>;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  startMonitor: (pr: PR) => Promise<Monitor>;
  stopMonitor: (prId: string) => Promise<void>;
  getMonitorForPR: (prId: string) => Monitor | undefined;
}

export function useMonitors(options: UseMonitorsOptions = {}): UseMonitorsReturn {
  const { autoRefresh = true, refreshInterval = 5000 } = options;

  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create a map of prId -> Monitor for quick lookup
  const monitorsMap = useMemo(() => {
    const map = new Map<string, Monitor>();
    for (const monitor of monitors) {
      // Only track active monitors
      if (monitor.status === "running" || monitor.status === "sleeping") {
        map.set(monitor.prId, monitor);
      }
    }
    return map;
  }, [monitors]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Fetch only active monitors
      const data = await getMonitors({ status: "running" });
      // Also fetch sleeping monitors
      const sleepingData = await getMonitors({ status: "sleeping" });
      setMonitors([...data, ...sleepingData]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error("Failed to fetch monitors:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh when monitors are active
  useEffect(() => {
    if (!autoRefresh || monitors.length === 0) return;

    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, refresh, monitors.length]);

  const startMonitor = useCallback(
    async (pr: PR): Promise<Monitor> => {
      const params: StartMonitorParams = {
        prId: pr.id,
        prNumber: pr.number,
        repo: pr.repo,
      };

      try {
        // Fetch unresolved comments before starting monitor
        // This populates the pr_comments table and updates unresolved_threads count
        await fetchPRComments(pr.number, pr.repo);

        const monitor = await startMonitorAPI(params);
        // Refresh monitors list
        await refresh();
        return monitor;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      }
    },
    [refresh]
  );

  const stopMonitor = useCallback(
    async (prId: string): Promise<void> => {
      const monitor = monitorsMap.get(prId);
      if (!monitor) {
        console.warn("No active monitor found for PR:", prId);
        return;
      }

      try {
        await stopMonitorAPI(monitor.id);
        // Refresh monitors list
        await refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      }
    },
    [monitorsMap, refresh]
  );

  const getMonitorForPR = useCallback(
    (prId: string): Monitor | undefined => {
      return monitorsMap.get(prId);
    },
    [monitorsMap]
  );

  return {
    monitors,
    monitorsMap,
    isLoading,
    error,
    refresh,
    startMonitor,
    stopMonitor,
    getMonitorForPR,
  };
}
