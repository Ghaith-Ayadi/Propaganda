// Flags: content that disagrees with the knowledge base, and claims that
// disagree with each other. Re-checks after a change live in their own
// threads (RechecksView), not here one by one.

import { ArrowLeft, BookOpen01, Scales02 } from "@untitledui/icons";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { ButtonGroup, ButtonGroupItem } from "@/components/base/button-group/button-group";
import { goPage, pageHref } from "@/lib/route";
import { useFlagPage } from "@/lib/knowledge/hooks";
import type { FlagSummary } from "@/lib/knowledge/types";
import { cx } from "@/utils/cx";
import { Empty, FlagStatusBadge, Loading, formatDate } from "./bits";
import { FlagDetailView } from "./FlagDetailView";

const PAGE_SIZE = 30;

export function FlagsView({ selected }: { selected: string | null }) {
  const [status, setStatus] = useState<"open" | "closed">("open");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const page = useFlagPage({ status, kind: "all", offset: 0, limit });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
      <div className={cx("flex min-w-0 flex-col gap-4", selected && "max-lg:hidden")}>
        <ButtonGroup
          size="sm"
          selectedKeys={[status]}
          disallowEmptySelection
          onSelectionChange={(keys) => {
            const next = [...keys][0];
            if (next) {
              setStatus(next as "open" | "closed");
              setLimit(PAGE_SIZE);
            }
          }}
        >
          <ButtonGroupItem id="open">Open</ButtonGroupItem>
          <ButtonGroupItem id="closed">Closed</ButtonGroupItem>
        </ButtonGroup>

        {page.loading && !page.data ? (
          <Loading />
        ) : !page.data?.rows.length ? (
          <Empty title={status === "open" ? "Nothing disagrees with the knowledge base" : "No closed flags yet"}>
            {status === "open" ? "When a post or a new claim contradicts a settled one, it shows up here." : undefined}
          </Empty>
        ) : (
          <ul className="divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
            {page.data.rows.map((f) => (
              <FlagRow key={f.id} flag={f} active={f.id === selected} />
            ))}
          </ul>
        )}
        {page.data?.next != null && (
          <Button size="sm" color="secondary" className="self-center" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            Show more
          </Button>
        )}
      </div>

      <div className={cx("min-w-0", !selected && "max-lg:hidden")}>
        {selected ? (
          <>
            <Button size="sm" color="link-gray" iconLeading={ArrowLeft} onClick={() => goPage("knowledge", "flags")} className="mb-3 lg:hidden">
              All flags
            </Button>
            <FlagDetailView key={selected} id={selected} />
          </>
        ) : (
          <Empty title="Pick a flag">See what the content says, what the knowledge base says, the evidence, and the fix.</Empty>
        )}
      </div>
    </div>
  );
}

function FlagRow({ flag, active }: { flag: FlagSummary; active: boolean }) {
  const Icon = flag.kind === "kb_conflict" ? Scales02 : BookOpen01;
  return (
    <li>
      <a
        href={pageHref("knowledge", `flags/${flag.id}`)}
        className={cx("flex gap-3 px-4 py-3 transition hover:bg-primary_hover", active && "bg-secondary")}
        aria-current={active ? "true" : undefined}
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-quaternary" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-medium text-primary">{flag.postTitle}</span>
            {flag.confidence != null && <span className="shrink-0 text-xs text-quaternary">{Math.round(flag.confidence * 100)}%</span>}
          </span>
          <span className="truncate text-sm text-tertiary">{flag.headline}</span>
          <span className="flex items-center gap-2 text-xs text-quaternary">
            {flag.status !== "open" && <FlagStatusBadge status={flag.status} />}
            raised {formatDate(flag.created)}
          </span>
        </span>
      </a>
    </li>
  );
}
