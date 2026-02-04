import { useState, useCallback, useEffect } from "react";
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

  // Persist order to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
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
  const sortPRs = useCallback(
    (prs: PR[]) => {
      return [...prs].sort((a, b) => {
        const aIdx = order.indexOf(a.id);
        const bIdx = order.indexOf(b.id);
        if (aIdx === -1 && bIdx === -1) return 0;
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return aIdx - bIdx;
      });
    },
    [order]
  );

  // Add any new PRs to the order (that aren't already tracked)
  const ensureInOrder = useCallback((prs: PR[]) => {
    const newIds = prs.map((pr) => pr.id).filter((id) => !order.includes(id));
    if (newIds.length > 0) {
      setOrder((prev) => [...prev, ...newIds]);
    }
  }, [order]);

  return { order, reorder, sortPRs, ensureInOrder };
}
