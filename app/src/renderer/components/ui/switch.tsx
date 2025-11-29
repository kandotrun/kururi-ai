import * as SwitchPrimitives from "@radix-ui/react-switch";
import * as React from "react";
import { cn } from "../utils/cn";

export type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>;

export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitives.Root>, SwitchProps>(
  ({ className, ...props }, ref) => (
    <SwitchPrimitives.Root
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-slate-300 transition data-[state=checked]:bg-cyan-400",
        className,
      )}
      {...props}
      ref={ref}
    >
      <SwitchPrimitives.Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitives.Root>
  ),
);

Switch.displayName = "Switch";
