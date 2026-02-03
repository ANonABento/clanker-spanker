import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PR } from "@/lib/types";

interface DoneChipProps {
  pr: PR;
  isFocused?: boolean;
  onDismiss?: (pr: PR) => void;
  onOpenInGitHub?: (pr: PR) => void;
}

export function DoneChip({
  pr,
  isFocused,
  onDismiss,
  onOpenInGitHub,
}: DoneChipProps) {
  return (
    <div
      data-focused={isFocused}
      onClick={() => onOpenInGitHub?.(pr)}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full cursor-pointer",
        "bg-[#111] border border-[#1f1f1f]",
        "text-xs text-[#808080]",
        "hover:border-[#2a2a2a] hover:bg-[#141414] transition-colors",
        isFocused && "ring-1 ring-[#8b5cf6] ring-offset-1 ring-offset-[#0a0a0a]"
      )}
    >
      <Check className="h-3 w-3 text-emerald-500" />
      <span className="font-medium text-[#909090]">#{pr.number}</span>
      <span className="max-w-[120px] truncate">{pr.title}</span>

      {onDismiss && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(pr);
          }}
          className="p-0.5 rounded hover:bg-[#222] text-[#505050] hover:text-[#ef4444] transition-colors"
          title="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
