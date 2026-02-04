import { useRef, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PRCard } from "./PRCard";
import type { PR, Monitor } from "@/lib/types";

interface SortablePRCardProps {
  pr: PR;
  monitor?: Monitor;
  terminalOutput?: string[];
  isFocused?: boolean;
  onStartMonitor?: (pr: PR) => void;
  onStopMonitor?: (pr: PR) => void;
  onOpenInGitHub?: (pr: PR) => void;
  onExpand?: (pr: PR) => void;
  onDismiss?: (pr: PR) => void;
  hasCompletedMonitor?: boolean;
  completedMonitorData?: { iteration: number; maxIterations: number; exitReason: string };
}

export function SortablePRCard(props: SortablePRCardProps) {
  const { onOpenInGitHub, ...prCardProps } = props;
  const wasDragging = useRef(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: props.pr.id,
  });

  // Track when dragging starts
  useEffect(() => {
    if (isDragging) {
      wasDragging.current = true;
    }
  }, [isDragging]);

  // Wrapper that prevents opening GitHub during drag
  const handleOpenInGitHub = (pr: PR) => {
    if (wasDragging.current) {
      wasDragging.current = false;
      return;
    }
    onOpenInGitHub?.(pr);
  };

  // Reset drag state on any click (for cases where header wasn't clicked)
  const handleClick = () => {
    if (wasDragging.current) {
      wasDragging.current = false;
    }
  };

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
    cursor: isDragging ? "grabbing" : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        isDragging
          ? "shadow-[0_0_20px_rgba(139,92,246,0.4)] rounded-lg scale-[1.02]"
          : ""
      }
      {...attributes}
      {...listeners}
      onClick={handleClick}
    >
      <PRCard {...prCardProps} onOpenInGitHub={handleOpenInGitHub} />
    </div>
  );
}
