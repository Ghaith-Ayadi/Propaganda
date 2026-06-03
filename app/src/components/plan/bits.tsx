// Thin wrappers over the Untitled UI primitives so brief status, assignee and
// tags render with the real Badge and Avatar components at every call site.

import { User01 } from "@untitledui/icons";
import type { BriefStatus } from "@/lib/plan/types";
import { statusMeta } from "@/lib/plan/types";
import { assigneeById, initials } from "@/lib/plan/mock";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Avatar } from "@/components/base/avatar/avatar";

type StatusBadgeColor = "gray" | "blue" | "orange" | "purple" | "success" | "pink";

const STATUS_BADGE_COLOR: Record<BriefStatus, StatusBadgeColor> = {
  backlog: "gray",
  todo: "blue",
  in_progress: "orange",
  in_review: "purple",
  done: "success",
  cancelled: "pink",
};

export function StatusBadge({ status }: { status: BriefStatus }) {
  return (
    <BadgeWithDot color={STATUS_BADGE_COLOR[status]} type="pill-color" size="sm">
      {statusMeta(status).label}
    </BadgeWithDot>
  );
}

export function AssigneeAvatar({ id }: { id: string | null }) {
  const a = assigneeById(id);
  if (!a) return <Avatar size="xs" placeholderIcon={User01} alt="Unassigned" />;
  return <Avatar size="xs" initials={initials(a.name)} alt={a.name} />;
}

export function TagPill({ tag }: { tag: string }) {
  return (
    <Badge color="gray" type="color" size="sm">
      #{tag}
    </Badge>
  );
}
