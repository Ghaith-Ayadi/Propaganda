// Height-animated show/hide without measuring: the grid-rows 0fr to 1fr trick.
// Children stay mounted (inert while closed), so a fold in the nav tree eases
// open and shut instead of vanishing.

import type { ReactNode } from "react";
import { cx } from "@/utils/cx";

export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
