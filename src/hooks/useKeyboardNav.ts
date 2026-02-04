import { useState, useCallback, useEffect } from "react";

interface UseKeyboardNavOptions {
  totalCards: number;
  onOpenPR?: (index: number) => void;
  onToggleMonitor?: (index: number) => void;
  onRefresh?: () => void;
  onShowHelp?: () => void;
  onEscape?: () => void;
  enabled?: boolean;
}

interface UseKeyboardNavReturn {
  focusedIndex: number | null;
  setFocusedIndex: (index: number | null) => void;
  clearFocus: () => void;
}

export function useKeyboardNav({
  totalCards,
  onOpenPR,
  onToggleMonitor,
  onRefresh,
  onShowHelp,
  onEscape,
  enabled = true,
}: UseKeyboardNavOptions): UseKeyboardNavReturn {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  const clearFocus = useCallback(() => setFocusedIndex(null), []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Skip if typing in an input
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (event.key) {
        case "j":
          event.preventDefault();
          setFocusedIndex((prev) => {
            if (totalCards === 0) return null;
            if (prev === null) return 0;
            return Math.min(prev + 1, totalCards - 1);
          });
          break;

        case "k":
          event.preventDefault();
          setFocusedIndex((prev) => {
            if (totalCards === 0) return null;
            if (prev === null) return 0;
            return Math.max(prev - 1, 0);
          });
          break;

        case "Enter":
          if (focusedIndex !== null && onOpenPR) {
            event.preventDefault();
            onOpenPR(focusedIndex);
          }
          break;

        case "m":
          if (focusedIndex !== null && onToggleMonitor) {
            event.preventDefault();
            onToggleMonitor(focusedIndex);
          }
          break;

        case "r":
          if (onRefresh) {
            event.preventDefault();
            onRefresh();
          }
          break;

        case "?":
          if (onShowHelp) {
            event.preventDefault();
            onShowHelp();
          }
          break;

        case "Escape":
          event.preventDefault();
          if (focusedIndex !== null) {
            setFocusedIndex(null);
          }
          onEscape?.();
          break;
      }
    },
    [
      enabled,
      totalCards,
      focusedIndex,
      onOpenPR,
      onToggleMonitor,
      onRefresh,
      onShowHelp,
      onEscape,
    ]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Reset focus when total cards changes (e.g., after filtering)
  useEffect(() => {
    if (focusedIndex !== null && focusedIndex >= totalCards) {
      setFocusedIndex(totalCards > 0 ? totalCards - 1 : null);
    }
  }, [totalCards, focusedIndex]);

  return { focusedIndex, setFocusedIndex, clearFocus };
}
