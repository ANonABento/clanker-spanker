import { Inbox } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { PRCardSkeleton } from "./PRCardSkeleton";
import { SortablePRCard } from "./SortablePRCard";
import type { PR, Monitor } from "@/lib/types";

interface CardGridProps {
  prs: PR[];
  isLoading?: boolean;
  focusedPRId?: string | null;
  hasRepo?: boolean;
  onReorder?: (activeId: string, overId: string) => void;
  terminalOutputs?: Record<string, string[]>;
  getMonitorForPR?: (prId: string) => Monitor | undefined;
  onStartMonitor?: (pr: PR) => void;
  onStopMonitor?: (pr: PR) => void;
  onOpenInGitHub?: (pr: PR) => void;
  onExpand?: (pr: PR) => void;
  onDismiss?: (pr: PR) => void;
  completedMonitors?: Record<string, { monitorId: string; prNumber: number; iteration: number; maxIterations: number; exitReason: string }>;
}

function LoadingSkeletons() {
  return (
    <>
      <PRCardSkeleton />
      <PRCardSkeleton />
      <PRCardSkeleton />
      <PRCardSkeleton />
      <PRCardSkeleton />
      <PRCardSkeleton />
    </>
  );
}

export function CardGrid({
  prs,
  isLoading,
  focusedPRId,
  hasRepo,
  onReorder,
  terminalOutputs = {},
  getMonitorForPR,
  onStartMonitor,
  onStopMonitor,
  onOpenInGitHub,
  onExpand,
  onDismiss,
  completedMonitors = {},
}: CardGridProps) {
  // Configure sensors with activation constraints to allow clicking
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before dragging starts
      },
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id && onReorder) {
      onReorder(String(active.id), String(over.id));
    }
  };

  // Show global empty state if no repo selected
  if (!isLoading && !hasRepo) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Inbox className="mx-auto h-16 w-16 text-[#404040] mb-4 animate-float" />
          <h2 className="text-lg font-medium text-[#909090] mb-2">
            No repository selected
          </h2>
          <p className="text-sm text-[#606060] max-w-sm">
            Click "Select repository..." in the header to add a GitHub repo. You
            can paste a full URL or use owner/repo format.
          </p>
        </div>
      </div>
    );
  }

  const isEmpty = !isLoading && prs.length === 0;

  return (
    <div className="h-full overflow-y-auto pt-1">
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          <LoadingSkeletons />
        </div>
      ) : isEmpty ? (
        <EmptyState />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={prs.map((pr) => pr.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {prs.map((pr) => (
                <SortablePRCard
                  key={pr.id}
                  pr={pr}
                  monitor={getMonitorForPR?.(pr.id)}
                  terminalOutput={terminalOutputs[pr.id]}
                  isFocused={pr.id === focusedPRId}
                  onStartMonitor={onStartMonitor}
                  onStopMonitor={onStopMonitor}
                  onOpenInGitHub={onOpenInGitHub}
                  onExpand={onExpand}
                  onDismiss={onDismiss}
                  hasCompletedMonitor={!!completedMonitors[pr.id]}
                  completedMonitorData={completedMonitors[pr.id]}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-64 flex-col items-center justify-center text-center">
      <Inbox className="h-16 w-16 text-[#404040] mb-4 animate-float" />
      <h2 className="text-lg font-medium text-[#909090] mb-2">No open PRs</h2>
      <p className="text-sm text-[#606060] max-w-sm">
        Open pull requests will appear here. Click "Refresh" to check for
        updates.
      </p>
    </div>
  );
}
