import { useState, useCallback, useEffect } from "react";
import { getSetting, setSetting } from "@/lib/tauri";
import type { PRFilters } from "@/lib/filters";
import { DEFAULT_FILTERS, hasActiveFilters as checkHasActiveFilters } from "@/lib/filters";

const STORAGE_KEY = "pr_filters";

interface UseFiltersReturn {
  filters: PRFilters;
  setFilter: <K extends keyof PRFilters>(key: K, value: PRFilters[K]) => void;
  resetFilters: () => void;
  hasActiveFilters: boolean;
  isLoading: boolean;
}

export function useFilters(): UseFiltersReturn {
  const [filters, setFiltersState] = useState<PRFilters>(DEFAULT_FILTERS);
  const [isLoading, setIsLoading] = useState(true);

  // Load filters from settings on mount
  useEffect(() => {
    getSetting(STORAGE_KEY)
      .then((saved) => {
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            setFiltersState({ ...DEFAULT_FILTERS, ...parsed });
          } catch {
            console.error("Failed to parse saved filters");
          }
        }
      })
      .catch((err) => {
        console.error("Failed to load filters:", err);
      })
      .finally(() => setIsLoading(false));
  }, []);

  // Persist filters when they change
  const persistFilters = useCallback((newFilters: PRFilters) => {
    setSetting(STORAGE_KEY, JSON.stringify(newFilters)).catch((err) => {
      console.error("Failed to save filters:", err);
    });
  }, []);

  // Update a specific filter
  const setFilter = useCallback(
    <K extends keyof PRFilters>(key: K, value: PRFilters[K]) => {
      setFiltersState((prev) => {
        const next = { ...prev, [key]: value };
        persistFilters(next);
        return next;
      });
    },
    [persistFilters]
  );

  // Reset all filters
  const resetFilters = useCallback(() => {
    setFiltersState(DEFAULT_FILTERS);
    persistFilters(DEFAULT_FILTERS);
  }, [persistFilters]);

  return {
    filters,
    setFilter,
    resetFilters,
    hasActiveFilters: checkHasActiveFilters(filters),
    isLoading,
  };
}
