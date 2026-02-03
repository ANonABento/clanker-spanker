import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Toast as ToastType, ToastVariant } from "@/hooks/useToast";

interface ToastProps {
  toast: ToastType;
  onDismiss: (id: string) => void;
}

const variantConfig: Record<
  ToastVariant,
  { icon: typeof CheckCircle2; className: string }
> = {
  success: {
    icon: CheckCircle2,
    className: "border-emerald-700/40 bg-emerald-900/30 text-emerald-300",
  },
  error: {
    icon: AlertCircle,
    className: "border-red-700/40 bg-red-900/30 text-red-300",
  },
  warning: {
    icon: AlertTriangle,
    className: "border-amber-700/40 bg-amber-900/30 text-amber-300",
  },
  info: {
    icon: Info,
    className: "border-sky-700/40 bg-sky-900/30 text-sky-300",
  },
};

export function Toast({ toast, onDismiss }: ToastProps) {
  const config = variantConfig[toast.variant];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg transition-all duration-300",
        "animate-in slide-in-from-right-full fade-in",
        config.className
      )}
      role="alert"
    >
      <Icon className="h-5 w-5 flex-shrink-0" />
      <span className="flex-1 text-sm font-medium">{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="flex-shrink-0 rounded p-1 opacity-70 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastType[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
