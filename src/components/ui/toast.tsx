import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Toast as ToastType, ToastVariant } from "@/hooks/useToast";

interface ToastProps {
  toast: ToastType;
  onDismiss: (id: string) => void;
}

const variantConfig: Record<
  ToastVariant,
  { icon: typeof CheckCircle2; className: string; progressColor: string }
> = {
  success: {
    icon: CheckCircle2,
    className: "border-emerald-700/40 bg-emerald-900/30 text-emerald-300 shadow-[0_0_16px_rgba(16,185,129,0.15)]",
    progressColor: "bg-emerald-500/50",
  },
  error: {
    icon: AlertCircle,
    className: "border-red-700/40 bg-red-900/30 text-red-300 shadow-[0_0_16px_rgba(239,68,68,0.15)]",
    progressColor: "bg-red-500/50",
  },
  warning: {
    icon: AlertTriangle,
    className: "border-amber-700/40 bg-amber-900/30 text-amber-300 shadow-[0_0_16px_rgba(234,179,8,0.15)]",
    progressColor: "bg-amber-500/50",
  },
  info: {
    icon: Info,
    className: "border-sky-700/40 bg-sky-900/30 text-sky-300 shadow-[0_0_16px_rgba(56,189,248,0.15)]",
    progressColor: "bg-sky-500/50",
  },
};

export function Toast({ toast, onDismiss }: ToastProps) {
  const config = variantConfig[toast.variant];
  const Icon = config.icon;
  const showProgress = toast.variant !== "error"; // Errors don't auto-dismiss

  return (
    <div
      className={cn(
        "relative flex items-center gap-3 rounded-lg border px-4 py-3 transition-all duration-300 overflow-hidden",
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
      {/* Progress bar for auto-dismiss countdown */}
      {showProgress && (
        <div
          className={cn(
            "absolute bottom-0 left-0 h-0.5",
            config.progressColor,
            "animate-[shrink_3s_linear_forwards]"
          )}
          style={{ width: "100%" }}
        />
      )}
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
