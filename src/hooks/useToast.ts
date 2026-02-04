import { useState, useCallback, useRef, useEffect } from "react";

export type ToastVariant = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  duration: number;
}

interface UseToastReturn {
  toasts: Toast[];
  showToast: (message: string, variant?: ToastVariant, duration?: number) => void;
  dismissToast: (id: string) => void;
  clearAll: () => void;
}

const DEFAULT_DURATION = 3000;
let toastIdCounter = 0;

export function useToast(): UseToastReturn {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  const dismissToast = useCallback((id: string) => {
    // Clear the timer
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }

    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (
      message: string,
      variant: ToastVariant = "info",
      duration?: number
    ) => {
      const id = `toast-${++toastIdCounter}`;

      // Error toasts don't auto-dismiss by default
      const effectiveDuration = duration ?? (variant === "error" ? 0 : DEFAULT_DURATION);

      const newToast: Toast = {
        id,
        message,
        variant,
        duration: effectiveDuration,
      };

      setToasts((prev) => [...prev, newToast]);

      // Auto-dismiss (unless duration is 0)
      if (effectiveDuration > 0) {
        const timer = setTimeout(() => {
          dismissToast(id);
        }, effectiveDuration);
        timersRef.current.set(id, timer);
      }
    },
    [dismissToast]
  );

  const clearAll = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
    setToasts([]);
  }, []);

  return { toasts, showToast, dismissToast, clearAll };
}
