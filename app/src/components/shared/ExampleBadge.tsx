// Marks a section that shows example data because the table behind it doesn't
// exist yet. Each page's placeholder.ts says which; the badge goes away when
// the section's data comes from the server.

import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";

export function ExampleBadge({ why }: { why: string }) {
  return (
    <Tooltip title="Example data" description={why}>
      <TooltipTrigger className="inline-flex cursor-default items-center rounded-full border border-dashed border-primary px-2 py-0.5 text-xs text-tertiary">
        Example
      </TooltipTrigger>
    </Tooltip>
  );
}
