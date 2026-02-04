import { MessageSquare, Maximize2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelativeTime, formatCountdown } from "@/lib/time";
import { MiniTerminal } from "@/components/terminal/MiniTerminal";
import type { PR, Monitor } from "@/lib/types";

interface PRCardProps {
  pr: PR;
  monitor?: Monitor;
  terminalOutput?: string[];
  isFocused?: boolean;
  isCompact?: boolean;
  hasCompletedMonitor?: boolean;
  completedMonitorData?: { iteration: number; maxIterations: number; exitReason: string };
  onStartMonitor?: (pr: PR) => void;
  onStopMonitor?: (pr: PR) => void;
  onOpenInGitHub?: (pr: PR) => void;
  onExpand?: (pr: PR) => void;
  onDismiss?: (pr: PR) => void;
}

export function PRCard({
  pr,
  monitor,
  terminalOutput = [],
  isFocused,
  isCompact,
  hasCompletedMonitor,
  completedMonitorData,
  onStartMonitor,
  onStopMonitor,
  onOpenInGitHub,
  onExpand,
  onDismiss,
}: PRCardProps) {
  const isMonitoring = pr.category === "monitoring" && monitor;

  // Compact mode (for split view sidebar)
  if (isCompact) {
    return (
      <div
        data-focused={isFocused}
        className={cn(
          "flex items-center gap-3 p-2 rounded-lg border border-[#1f1f1f] bg-[#111]",
          "hover:border-[#2a2a2a] hover:bg-[#141414] transition-colors cursor-pointer",
          isFocused && "ring-1 ring-[#8b5cf6] ring-offset-1 ring-offset-[#0a0a0a]"
        )}
        onClick={() => onExpand?.(pr)}
      >
        <span className="font-semibold text-[#e5e5e5] text-sm">#{pr.number}</span>
        {isMonitoring && (
          <div className="flex-1 h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#8b5cf6] shadow-[0_0_8px_rgba(139,92,246,0.5)] transition-all duration-300"
              style={{
                width: `${monitor.maxIterations > 0 ? (monitor.iteration / monitor.maxIterations) * 100 : 0}%`,
              }}
            />
          </div>
        )}
        {!isMonitoring && pr.state === "merged" && (
          <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium">
            Merged
          </span>
        )}
        {!isMonitoring && pr.state !== "merged" && hasCompletedMonitor && (
          <span className="text-xs px-2 py-0.5 rounded bg-[#1a1a1a] text-[#707070] font-medium">
            Logged
          </span>
        )}
        {!isMonitoring && pr.state !== "merged" && !hasCompletedMonitor && onStartMonitor && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStartMonitor(pr);
            }}
            className="text-xs px-2 py-0.5 rounded bg-[#8b5cf6] text-white font-medium hover:bg-[#7c3aed] transition-all"
          >
            Monitor
          </button>
        )}
      </div>
    );
  }

  const handleHeaderClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenInGitHub?.(pr);
  };

  return (
    <div
      data-focused={isFocused}
      className={cn(
        "rounded-lg border border-[#1f1f1f] bg-[#111] p-3 space-y-2.5",
        "shadow-[0_1px_2px_rgba(0,0,0,0.2)]",
        "hover:border-[#333] hover:bg-[#141414] hover:shadow-[0_4px_16px_rgba(139,92,246,0.1)] hover:translate-y-[-1px]",
        "transition-all duration-200 ease-out",
        isFocused && "ring-2 ring-[#8b5cf6]/50 ring-offset-2 ring-offset-[#0a0a0a]",
        pr.state === "merged" && "opacity-80 hover:opacity-100"
      )}
    >
      {/* Clickable Header Area - opens GitHub */}
      <div
        data-clickable-header
        onClick={handleHeaderClick}
        className="cursor-pointer space-y-2.5"
      >
        {/* Header Row: PR#, Date, Comments on left; Status on right */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-[#e5e5e5] text-sm">#{pr.number}</span>
            {pr.state !== "merged" && pr.isDraft && (
              <span className="text-yellow-400/80 bg-yellow-500/10 px-1.5 py-0.5 rounded font-medium">
                Draft
              </span>
            )}
            {pr.updatedAt && <span className="text-[#666666]">{formatRelativeTime(pr.updatedAt)}</span>}
            {pr.state !== "merged" && pr.unresolvedThreads > 0 && (
              <span className="flex items-center gap-1 text-orange-400">
                <MessageSquare className="h-3 w-3" />
                {pr.unresolvedThreads}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {pr.state === "merged" ? (
              <span className="flex items-center gap-1 text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded font-medium text-xs">
                <Check className="h-3 w-3" />
                Merged
              </span>
            ) : (
              <>
                <StatusBadge status={pr.ciStatus} type="ci" />
                <StatusBadge status={pr.reviewStatus} type="review" />
              </>
            )}
          </div>
        </div>

        {/* Title - always 2 lines height */}
        <p
          className={cn(
            "text-sm line-clamp-2 leading-snug min-h-[2.625rem]",
            pr.state === "merged" ? "text-[#707070]" : "text-[#a0a0a0]"
          )}
          title={pr.title}
        >
          {pr.title}
        </p>
      </div>


      {/* Monitor Progress (inline when monitoring) */}
      {isMonitoring && (
        <>
          <div className="flex items-center gap-2 text-xs pt-1 border-t border-[#1f1f1f]/50">
            <div className="flex-1 h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#8b5cf6] shadow-[0_0_8px_rgba(139,92,246,0.5)] transition-all duration-300"
                style={{
                  width: `${monitor.maxIterations > 0 ? (monitor.iteration / monitor.maxIterations) * 100 : 0}%`,
                }}
              />
            </div>
            <span className="text-[#606060] tabular-nums">
              {monitor.iteration}/{monitor.maxIterations}
            </span>
            {monitor.nextCheckAt && (
              <span className="text-[#505050]">{formatCountdown(monitor.nextCheckAt)}</span>
            )}
          </div>

          {/* Mini Terminal Output (3-4 lines) */}
          <MiniTerminal output={terminalOutput} className="h-16" />
        </>
      )}

      {/* Completed Monitor - show green progress bar and terminal output */}
      {hasCompletedMonitor && !isMonitoring && (
        <>
          <div className="flex items-center gap-2 text-xs pt-1 border-t border-[#1f1f1f]/50">
            <div className="flex-1 h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)] transition-all duration-300"
                style={{
                  width: completedMonitorData && completedMonitorData.maxIterations > 0
                    ? `${(completedMonitorData.iteration / completedMonitorData.maxIterations) * 100}%`
                    : "100%",
                }}
              />
            </div>
            <span className="text-emerald-500/70 tabular-nums">
              {completedMonitorData
                ? `${completedMonitorData.iteration}/${completedMonitorData.maxIterations}`
                : "Done"}
            </span>
          </div>
          {terminalOutput.length > 0 && (
            <MiniTerminal output={terminalOutput} className="h-12" />
          )}
        </>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        {pr.category === "todo" && onStartMonitor && !hasCompletedMonitor && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStartMonitor(pr);
            }}
            className="flex-1 text-xs py-1.5 rounded bg-[#8b5cf6] text-white font-medium hover:bg-[#7c3aed] transition-all"
          >
            Monitor
          </button>
        )}
        {pr.state === "merged" && onDismiss && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(pr);
            }}
            className="flex-1 text-xs py-1.5 rounded bg-emerald-500/20 text-emerald-400 font-medium hover:bg-emerald-500/30 transition-colors"
          >
            Dismiss
          </button>
        )}
        {pr.category === "monitoring" && onStopMonitor && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStopMonitor(pr);
              }}
              className="flex-1 text-xs py-1.5 rounded bg-[#1a1a1a] text-[#808080] font-medium hover:bg-[#222] hover:text-[#ef4444] transition-colors"
            >
              Stop
            </button>
            {onExpand && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onExpand(pr);
                }}
                className="px-2.5 py-1.5 rounded bg-[#1a1a1a] text-[#606060] hover:bg-[#222] hover:text-[#808080] transition-colors"
                title="Expand terminal"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        )}
        {hasCompletedMonitor && !isMonitoring && (
          <>
            {onStartMonitor && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStartMonitor(pr);
                }}
                className="flex-1 text-xs py-1.5 rounded bg-[#8b5cf6] text-white font-medium hover:bg-[#7c3aed] transition-all"
              >
                ReMonitor
              </button>
            )}
            {onExpand && terminalOutput.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onExpand(pr);
                }}
                className="flex-1 text-xs py-1.5 rounded bg-[#1a1a1a] text-[#808080] font-medium hover:bg-[#222] hover:text-[#a0a0a0] transition-colors"
              >
                View Log
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Status badge with text labels
function StatusBadge({
  status,
  type,
}: {
  status: string | null;
  type: "ci" | "review";
}) {
  if (!status) return null;

  const styles: Record<string, Record<string, { bg: string; text: string; label: string; pulse?: boolean }>> = {
    ci: {
      passing: { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "CI Passing" },
      failing: { bg: "bg-red-500/15", text: "text-red-400", label: "CI Failing" },
      pending: { bg: "bg-yellow-500/15", text: "text-yellow-400", label: "CI Pending", pulse: true },
    },
    review: {
      approved: { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "Approved" },
      changes_requested: { bg: "bg-orange-500/15", text: "text-orange-400", label: "Changes" },
      commented: { bg: "bg-blue-500/15", text: "text-blue-400", label: "Commented" },
      conflicts: { bg: "bg-red-500/15", text: "text-red-400", label: "Conflicts" },
      pending: { bg: "bg-gray-500/15", text: "text-gray-400", label: "Need Review" },
    },
  };

  const style = styles[type]?.[status];
  if (!style) return null;

  return (
    <span
      className={cn(
        "text-xs px-1.5 py-0.5 rounded font-medium",
        style.bg,
        style.text,
        style.pulse && "animate-pulse"
      )}
    >
      {style.label}
    </span>
  );
}
