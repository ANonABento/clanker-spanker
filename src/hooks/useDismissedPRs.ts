import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "dismissed-prs";

export function useDismissedPRs() {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return new Set(JSON.parse(stored));
      }
    } catch (e) {
      console.error("Failed to load dismissed PRs:", e);
    }
    return new Set();
  });

  // Persist to localStorage when dismissed IDs change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...dismissedIds]));
    } catch (e) {
      console.error("Failed to save dismissed PRs:", e);
    }
  }, [dismissedIds]);

  const dismiss = useCallback((prId: string) => {
    setDismissedIds((prev) => new Set([...prev, prId]));
  }, []);

  const restore = useCallback((prId: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.delete(prId);
      return next;
    });
  }, []);

  const isDismissed = useCallback(
    (prId: string) => dismissedIds.has(prId),
    [dismissedIds]
  );

  const clearAll = useCallback(() => {
    setDismissedIds(new Set());
  }, []);

  return {
    dismissedIds,
    dismiss,
    restore,
    isDismissed,
    clearAll,
  };
}
