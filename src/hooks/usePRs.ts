import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { fetchPRs } from "@/lib/tauri";
import type { PR } from "@/lib/types";

interface UsePRsOptions {
  repo?: string;
  repos?: string[];
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface RefreshOptions {
  forceRefresh?: boolean;
  showVisualFeedback?: boolean; // Only true for user-initiated refreshes
}

interface UsePRsReturn {
  prs: PR[];
  isLoading: boolean;
  error: string | null;
  refresh: (options?: boolean | RefreshOptions) => Promise<void>;
  lastRefreshTime: Date | null;
}

export function usePRs(options: UsePRsOptions = {}): UsePRsReturn {
  const { repo, repos, autoRefresh = false, refreshInterval = 60000 } = options;

  const [prs, setPRs] = useState<PR[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);

  const refresh = useCallback(async (options?: boolean | RefreshOptions) => {
    // Handle both old API (boolean) and new API (options object)
    // Also guard against React events being passed (e.g., from onClick={refresh})
    let force = true;
    let showVisualFeedback = true;

    if (typeof options === "boolean") {
      force = options;
      showVisualFeedback = options; // Old behavior: force=true means user click
    } else if (options && typeof options === "object" && !("target" in options)) {
      // It's a RefreshOptions object (not a React event)
      force = options.forceRefresh ?? true;
      showVisualFeedback = options.showVisualFeedback ?? false;
    }
    // If options is a React event or undefined, use defaults (force=true, visual=true)

    // Track start time for minimum loading duration
    const startTime = Date.now();
    const MIN_LOADING_MS = 400;

    setIsLoading(true);
    setError(null);

    // Only use double RAF for user-initiated refreshes (need visual feedback)
    if (showVisualFeedback) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
    }

    try {
      const currentRepo = repo;
      const currentRepos = repos;
      const data = await fetchPRs({
        repo: currentRepo,
        repos: currentRepos,
        forceRefresh: force
      });

      // Only enforce minimum loading duration for user-initiated refreshes
      if (showVisualFeedback) {
        const elapsed = Date.now() - startTime;
        if (elapsed < MIN_LOADING_MS) {
          await new Promise((resolve) => setTimeout(resolve, MIN_LOADING_MS - elapsed));
        }
      }

      setPRs(data);
      setLastRefreshTime(new Date());
    } catch (err) {
      let message: string;
      if (err instanceof Error) {
        message = err.message;
      } else if (typeof err === "string") {
        message = err;
      } else {
        message = "Unknown error occurred";
      }
      setError(message);
      console.error("Failed to fetch PRs:", message);
    } finally {
      setIsLoading(false);
    }
  }, [repo, repos]);

  // Initial fetch (incremental - use cached data if available, no visual feedback)
  useEffect(() => {
    refresh({ forceRefresh: false, showVisualFeedback: false });
  }, [refresh]);

  // Auto-refresh (incremental, no visual feedback)
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(
      () => refresh({ forceRefresh: false, showVisualFeedback: false }),
      refreshInterval
    );
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, refresh]);

  // Listen for refresh events (e.g., from API when monitor starts, no visual feedback)
  useEffect(() => {
    const unlisten = listen("pr:refresh", () => {
      console.log("PR refresh event received");
      refresh({ forceRefresh: true, showVisualFeedback: false });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refresh]);

  return { prs, isLoading, error, refresh, lastRefreshTime };
}
