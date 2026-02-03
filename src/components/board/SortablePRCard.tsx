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
}

export function SortablePRCard(props: SortablePRCardProps) {
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

  const handleClick = (e: React.MouseEvent) => {
    console.log("[SortablePRCard] handleClick called", {
      wasDragging: wasDragging.current,
      target: (e.target as HTMLElement).tagName,
      closestButton: !!(e.target as HTMLElement).closest("button"),
      hasOnOpenInGitHub: !!props.onOpenInGitHub,
      prUrl: props.pr.url,
    });

    // Don't open if we were dragging
    if (wasDragging.current) {
      console.log("[SortablePRCard] Blocked: was dragging");
      wasDragging.current = false;
      return;
    }
    // Don't open if clicking a button
    if ((e.target as HTMLElement).closest("button")) {
      console.log("[SortablePRCard] Blocked: clicked button");
      return;
    }
    e.stopPropagation();
    console.log("[SortablePRCard] Calling onOpenInGitHub");
    props.onOpenInGitHub?.(props.pr);
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
      <PRCard {...props} />
    </div>
  );
}
