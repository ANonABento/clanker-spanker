import { useState, useEffect, useCallback } from "react";
import { fetchPRs } from "@/lib/tauri";
import type { PR } from "@/lib/types";

interface UsePRsOptions {
  repo?: string;
  repos?: string[];
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface UsePRsReturn {
  prs: PR[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePRs(options: UsePRsOptions = {}): UsePRsReturn {
  const { repo, repos, autoRefresh = false, refreshInterval = 60000 } = options;

  const [prs, setPRs] = useState<PR[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memoize repos array to prevent unnecessary re-renders
  const reposKey = repos?.join(",") ?? repo ?? "";

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await fetchPRs({ repo, repos });
      setPRs(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error("Failed to fetch PRs:", err);
    } finally {
      setIsLoading(false);
    }
  }, [reposKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, refresh]);

  return { prs, isLoading, error, refresh };
}
