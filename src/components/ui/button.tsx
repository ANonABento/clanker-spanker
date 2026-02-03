import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#606060] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[#3a3a3a] text-[#e0e0e0] border border-[#505050] shadow-md hover:bg-[#4a4a4a] hover:border-[#606060] hover:shadow-[0_0_12px_rgba(192,192,192,0.2)]",
        secondary:
          "bg-[#1a1a1a] text-[#a0a0a0] border border-[#2a2a2a] hover:bg-[#252525] hover:text-[#c0c0c0] hover:border-[#3a3a3a]",
        destructive:
          "bg-red-600/80 text-white shadow-sm hover:bg-red-500 hover:shadow-[0_0_12px_rgba(239,68,68,0.3)]",
        outline:
          "border border-[#3a3a3a] bg-transparent text-[#909090] hover:bg-[#1a1a1a] hover:text-[#c0c0c0] hover:border-[#505050]",
        ghost: "text-[#808080] hover:bg-[#1a1a1a] hover:text-[#c0c0c0]",
        link: "text-[#a0a0a0] underline-offset-4 hover:underline hover:text-[#d0d0d0]",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
