import { useState, useCallback, useEffect, useMemo } from "react";
import type { PR } from "@/lib/types";

const STORAGE_KEY = "pr-card-order";

export function usePROrder() {
  const [order, setOrder] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Create a Map for O(1) index lookups instead of O(n) indexOf calls
  const orderMap = useMemo(
    () => new Map(order.map((id, index) => [id, index])),
    [order]
  );

  // Persist order to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
    } catch (e) {
      console.error("Failed to save PR order:", e);
    }
  }, [order]);

  const reorder = useCallback((activeId: string, overId: string) => {
    setOrder((prev) => {
      const oldIndex = prev.indexOf(activeId);
      const newIndex = prev.indexOf(overId);

      // If activeId is not in the list, add it
      if (oldIndex === -1) {
        const next = [...prev];
        if (newIndex === -1) {
          next.push(activeId);
        } else {
          next.splice(newIndex, 0, activeId);
        }
        return next;
      }

      // If overId is not in the list, just return current
      if (newIndex === -1) return prev;

      // Reorder
      const next = [...prev];
      next.splice(oldIndex, 1);
      next.splice(newIndex, 0, activeId);
      return next;
    });
  }, []);

  // Sort PRs by stored order, new PRs go to end
  // Uses Map for O(1) lookups instead of O(n) indexOf calls
  const sortPRs = useCallback(
    (prs: PR[]) => {
      return [...prs].sort((a, b) => {
        const aIdx = orderMap.get(a.id);
        const bIdx = orderMap.get(b.id);
        if (aIdx === undefined && bIdx === undefined) return 0;
        if (aIdx === undefined) return 1;
        if (bIdx === undefined) return -1;
        return aIdx - bIdx;
      });
    },
    [orderMap]
  );

  // Add any new PRs to the order (that aren't already tracked)
  // Uses Map for O(1) lookups instead of O(n) includes calls
  const ensureInOrder = useCallback((prs: PR[]) => {
    const newIds = prs.map((pr) => pr.id).filter((id) => !orderMap.has(id));
    if (newIds.length > 0) {
      setOrder((prev) => [...prev, ...newIds]);
    }
  }, [orderMap]);

  return { order, reorder, sortPRs, ensureInOrder };
}
