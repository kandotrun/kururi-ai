import * as React from "react";
import { cn } from "../utils/cn";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("rounded-xl border border-slate-200 bg-white p-4 shadow-sm", className)}
      {...props}
    />
  ),
);

Card.displayName = "Card";
