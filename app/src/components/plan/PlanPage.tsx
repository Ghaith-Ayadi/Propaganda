// Top-level "Planning" view (#/plan): the official Untitled UI Calendar of
// briefs (as events), plus a floating Unscheduled column. Mock data for now.

import { useMemo, useState } from "react";
import { Calendar as CalendarIcon, Plus, Rows01 } from "@untitledui/icons";
import { go } from "@/lib/route";
import { mockBriefs } from "@/lib/plan/mock";
import type { Brief, BriefStatus } from "@/lib/plan/types";
import { Button } from "@/components/base/buttons/button";
import { ButtonGroup, ButtonGroupItem } from "@/components/base/button-group/button-group";
import { Calendar, type CalendarEvent } from "@/components/application/calendar/calendar";
import { PlanList } from "./PlanList";
import { StatusBadge, AssigneeAvatar } from "./bits";

type PlanView = "calendar" | "list";

const EVENT_COLOR: Record<BriefStatus, CalendarEvent["color"]> = {
  backlog: "gray",
  todo: "blue",
  in_progress: "orange",
  in_review: "purple",
  done: "green",
  cancelled: "pink",
};

function briefsToEvents(briefs: Brief[]): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const b of briefs) {
    if (!b.plannedDate) continue;
    const [y, m, d] = b.plannedDate.split("-").map(Number);
    out.push({
      id: b.id,
      title: b.title || "Untitled brief",
      // All-day, spanning ~2 days so more of the title is visible; start = due date.
      start: new Date(y, m - 1, d),
      end: new Date(y, m - 1, d + 2),
      color: EVENT_COLOR[b.status],
      dot: true,
    });
  }
  return out;
}

export function PlanPage() {
  const briefs = useMemo(() => mockBriefs(), []);
  const [view, setView] = useState<PlanView>("calendar");
  const events = useMemo(() => briefsToEvents(briefs), [briefs]);
  const unscheduled = useMemo(() => briefs.filter((b) => !b.plannedDate), [briefs]);
  const openBrief = (id: string) => go({ view: "brief", id });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* header */}
      <div className="flex items-center justify-between gap-3 border-b border-secondary px-6 py-4">
        <div className="flex items-center gap-3">
          <h1 className="font-title text-2xl text-primary">Planning</h1>
          <span className="text-sm text-quaternary">
            {briefs.length} {briefs.length === 1 ? "brief" : "briefs"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ButtonGroup
            size="sm"
            selectedKeys={[view]}
            disallowEmptySelection
            onSelectionChange={(keys) => {
              const next = [...keys][0];
              if (next) setView(next as PlanView);
            }}
          >
            <ButtonGroupItem id="calendar" iconLeading={CalendarIcon}>
              Calendar
            </ButtonGroupItem>
            <ButtonGroupItem id="list" iconLeading={Rows01}>
              List
            </ButtonGroupItem>
          </ButtonGroup>
          <Button size="sm" color="primary" iconLeading={Plus} onClick={() => openBrief("new")}>
            New brief
          </Button>
        </div>
      </div>

      {/* body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {briefs.length === 0 ? (
          <EmptyState />
        ) : view === "calendar" ? (
          <div className="flex h-full min-h-0 gap-5 overflow-y-auto p-5">
            <div
              className="min-w-0 flex-1"
              onClick={(e) => {
                const target = e.target as HTMLElement;
                const addEl = target.closest<HTMLElement>("[data-add-date]");
                if (addEl?.dataset.addDate) {
                  go({ view: "brief", id: `new:${addEl.dataset.addDate}` });
                  return;
                }
                const evEl = target.closest<HTMLElement>("[data-event-id]");
                if (evEl?.dataset.eventId) openBrief(evEl.dataset.eventId);
              }}
            >
              <Calendar events={events} view="month" />
            </div>
            <UnscheduledColumn briefs={unscheduled} onOpen={openBrief} />
          </div>
        ) : (
          <PlanList briefs={briefs} onOpen={openBrief} />
        )}
      </div>
    </div>
  );
}

function UnscheduledColumn({
  briefs,
  onOpen,
}: {
  briefs: Brief[];
  onOpen: (id: string) => void;
}) {
  return (
    <aside className="flex w-72 shrink-0 flex-col self-start overflow-hidden rounded-xl bg-primary shadow-xs ring ring-secondary">
      <div className="flex items-center justify-between border-b border-secondary px-4 py-3">
        <h3 className="text-sm font-semibold text-primary">Unscheduled</h3>
        <span className="text-xs text-quaternary">{briefs.length}</span>
      </div>
      <div className="flex flex-col gap-2 p-3">
        {briefs.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-quaternary">Nothing unscheduled.</p>
        ) : (
          briefs.map((b) => (
            <button
              key={b.id}
              onClick={() => onOpen(b.id)}
              className="flex w-full flex-col gap-2 rounded-lg border border-secondary bg-primary p-3 text-left shadow-xs transition hover:border-brand"
            >
              <span className="truncate text-sm text-primary">{b.title}</span>
              <span className="flex items-center justify-between gap-2">
                <StatusBadge status={b.status} />
                <AssigneeAvatar id={b.assigneeId} />
              </span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <CalendarIcon className="size-8 text-quaternary" />
      <div>
        <p className="text-sm font-medium text-secondary">No briefs yet</p>
        <p className="text-xs text-quaternary">Plan a post by creating your first brief.</p>
      </div>
      <Button size="sm" color="primary" iconLeading={Plus} onClick={() => go({ view: "brief", id: "new" })}>
        New brief
      </Button>
    </div>
  );
}
