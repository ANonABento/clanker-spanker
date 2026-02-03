import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ColumnProps {
  title: string;
  count?: number;
  children: ReactNode;
  className?: string;
}

export function Column({ title, count, children, className }: ColumnProps) {
  return (
    <div
      className={cn(
        "flex flex-col min-h-0 rounded-lg bg-[#080808] border border-[#1a1a1a]",
        className
      )}
    >
      {/* Column Header */}
      <div className="flex-shrink-0 flex items-center justify-between border-b border-[#1a1a1a] px-4 py-2.5">
        <h2 className="text-xs font-semibold text-[#707070] tracking-wide uppercase">{title}</h2>
        {count !== undefined && (
          <span className="rounded-full bg-[#141414] px-2 py-0.5 text-xs font-medium text-[#505050]">
            {count}
          </span>
        )}
      </div>

      {/* Column Content - scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2">{children}</div>
    </div>
  );
}
