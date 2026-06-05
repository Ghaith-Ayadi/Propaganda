import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "@untitledui/icons";
import type { Brief, BriefStatus } from "@/lib/plan/types";
import { BRIEF_STATUS_ORDER, statusMeta } from "@/lib/plan/types";
import { ButtonGroup, ButtonGroupItem } from "@/components/base/button-group/button-group";
import { StatusBadge, AssigneeAvatars, TagPill } from "./bits";

type StatusFilter = BriefStatus | "all";
type SortKey = "planned" | "title" | "status";
type SortDir = "asc" | "desc";

function formatDate(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface Props {
  briefs: Brief[];
  onOpen: (id: string) => void;
}

export function PlanList({ briefs, onOpen }: Props) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("planned");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: briefs.length };
    for (const s of BRIEF_STATUS_ORDER) c[s] = 0;
    for (const b of briefs) c[b.status] = (c[b.status] ?? 0) + 1;
    return c;
  }, [briefs]);

  const rows = useMemo(() => {
    const xs = filter === "all" ? briefs : briefs.filter((b) => b.status === filter);
    const sign = sortDir === "asc" ? 1 : -1;
    return [...xs].sort((a, b) => {
      if (sortKey === "title") return sign * a.title.localeCompare(b.title);
      if (sortKey === "status") {
        return sign * (BRIEF_STATUS_ORDER.indexOf(a.status) - BRIEF_STATUS_ORDER.indexOf(b.status));
      }
      // planned date: undated always last, regardless of direction
      if (!a.plannedDate && !b.plannedDate) return 0;
      if (!a.plannedDate) return 1;
      if (!b.plannedDate) return -1;
      return sign * a.plannedDate.localeCompare(b.plannedDate);
    });
  }, [briefs, filter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-[980px]">
        {/* status filter */}
        <div className="mb-3 overflow-x-auto">
          <ButtonGroup
            size="sm"
            selectedKeys={[filter]}
            disallowEmptySelection
            onSelectionChange={(keys) => {
              const next = [...keys][0];
              if (next) setFilter(next as StatusFilter);
            }}
          >
            <ButtonGroupItem id="all">
              All <span className="ml-1 text-quaternary">{counts.all}</span>
            </ButtonGroupItem>
            {BRIEF_STATUS_ORDER.map((s) => (
              <ButtonGroupItem
                key={s}
                id={s}
                iconLeading={<span className={`size-1.5 rounded-full ${statusMeta(s).dot}`} />}
              >
                {statusMeta(s).label} <span className="ml-1 text-quaternary">{counts[s]}</span>
              </ButtonGroupItem>
            ))}
          </ButtonGroup>
        </div>

        {/* table */}
        <div className="overflow-hidden rounded-xl border border-secondary">
          <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <SortableTh
                  className="w-32"
                  active={sortKey === "status"}
                  dir={sortDir}
                  onClick={() => toggleSort("status")}
                >
                  Status
                </SortableTh>
                <SortableTh active={sortKey === "title"} dir={sortDir} onClick={() => toggleSort("title")}>
                  Title
                </SortableTh>
                <Th className="w-44">Tags</Th>
                <Th className="w-16">Owner</Th>
                <SortableTh
                  className="w-28"
                  active={sortKey === "planned"}
                  dir={sortDir}
                  onClick={() => toggleSort("planned")}
                >
                  Date
                </SortableTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr
                  key={b.id}
                  tabIndex={0}
                  onClick={() => onOpen(b.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onOpen(b.id);
                    }
                  }}
                  className="group cursor-pointer text-secondary outline-none transition hover:bg-secondary focus:bg-secondary"
                >
                  <Td>
                    <StatusBadge status={b.status} />
                  </Td>
                  <Td className="truncate text-sm text-primary">
                    {b.title || <span className="text-quaternary">Untitled</span>}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {b.tags.slice(0, 3).map((t) => (
                        <TagPill key={t} tag={t} />
                      ))}
                    </div>
                  </Td>
                  <Td>
                    <AssigneeAvatars ids={b.assigneeIds} />
                  </Td>
                  <Td className="text-xs text-quaternary">
                    {b.plannedDate ? formatDate(b.plannedDate) : "—"}
                  </Td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="border-t border-secondary px-4 py-8 text-center text-sm text-tertiary"
                  >
                    No briefs in this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={[
        "border-b border-secondary bg-secondary px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-quaternary",
        className ?? "",
      ].join(" ")}
    >
      {children}
    </th>
  );
}

function SortableTh({
  children,
  className,
  active,
  dir,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th
      className={[
        "border-b border-secondary bg-secondary px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-quaternary",
        className ?? "",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between gap-1 uppercase tracking-wide transition hover:text-secondary"
      >
        <span>{children}</span>
        <span className="inline-flex w-3 shrink-0 items-center justify-center">
          {active && (dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
        </span>
      </button>
    </th>
  );
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <td className={["border-t border-secondary px-4 py-2.5 align-middle", className ?? ""].join(" ")}>
      {children}
    </td>
  );
}
