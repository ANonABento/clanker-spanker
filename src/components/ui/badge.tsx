import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-[#1a1a1a] text-[#909090] border border-[#2a2a2a]",
        secondary: "bg-[#141414] text-[#707070] border border-[#1f1f1f]",
        success:
          "bg-emerald-900/30 text-emerald-400/90 border border-emerald-700/40",
        successSolid: "bg-emerald-600/90 text-white shadow-[0_0_8px_rgba(16,185,129,0.25)]",
        warning:
          "bg-amber-900/30 text-amber-400/90 border border-amber-700/40",
        warningSolid: "bg-amber-500/90 text-black",
        danger:
          "bg-red-900/30 text-red-400/90 border border-red-700/40",
        dangerSolid: "bg-red-600/90 text-white shadow-[0_0_8px_rgba(220,38,38,0.25)]",
        info: "bg-sky-900/30 text-sky-400/90 border border-sky-700/40",
        outline: "border border-[#2a2a2a] text-[#606060] bg-transparent",
        ghost: "text-[#505050] bg-transparent border-transparent",
      },
      size: {
        default: "px-2 py-0.5 text-xs",
        sm: "px-1.5 py-0.5 text-[10px]",
        lg: "px-2.5 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <div
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
