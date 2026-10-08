// The claims browser: search, filter by status and topic, sort by weight, one
// page of rows at a time from the server. The selected claim opens beside the
// list (under it on a phone).

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, SearchLg } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { ButtonGroup, ButtonGroupItem } from "@/components/base/button-group/button-group";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { goPage, pageHref } from "@/lib/route";
import { kb } from "@/lib/knowledge/adapter";
import { useClaimPages, useKb } from "@/lib/knowledge/hooks";
import type { ClaimStatus, ClaimSummary, Topic } from "@/lib/knowledge/types";
import { cx } from "@/utils/cx";
import { ClaimStatusBadge, ConflictBadge, Empty, Loading, formatDate } from "./bits";
import { ClaimDetailView } from "./ClaimDetailView";

type StatusFilter = "live" | "settled" | "contested" | "retired" | "all";
const STATUS_SETS: Record<StatusFilter, ClaimStatus[]> = {
  live: ["settled", "contested"],
  settled: ["settled"],
  contested: ["contested"],
  retired: ["superseded", "retracted"],
  all: ["settled", "contested", "superseded", "retracted"],
};
const PAGE_SIZE = 25;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ClaimsView({ selected }: { selected: string | null }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("live");
  const [topic, setTopic] = useState<string | null>(null);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [sort, setSort] = useState<"recent" | "weight">("recent");
  const q = useDebounced(search, 250);

  const topics = useKb("kb.topics", () => kb().topics(), []);
  const pending = useKb("kb.pending", () => kb().pending(), []);
  const list = useClaimPages({ search: q, statuses: STATUS_SETS[status], topic, problemsOnly, sort, limit: PAGE_SIZE });

  const topicItems = useMemo(
    () => [{ id: "", label: "All topics" }, ...(topics.data ?? []).map((t) => ({ id: t.id, label: topicPath(t, topics.data ?? []) }))],
    [topics.data],
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className={cx("flex min-w-0 flex-col gap-4", selected && "max-lg:hidden")}>
        <Input
          size="sm"
          icon={SearchLg}
          placeholder="Search claims"
          aria-label="Search claims"
          value={search}
          onChange={setSearch}
        />
        <div className="flex flex-wrap items-center gap-2">
          <ButtonGroup
            size="sm"
            selectedKeys={[status]}
            disallowEmptySelection
            onSelectionChange={(keys) => {
              const next = [...keys][0];
              if (next) setStatus(next as StatusFilter);
            }}
          >
            <ButtonGroupItem id="live">Live</ButtonGroupItem>
            <ButtonGroupItem id="settled">Settled</ButtonGroupItem>
            <ButtonGroupItem id="contested">Contested</ButtonGroupItem>
            <ButtonGroupItem id="retired">Retired</ButtonGroupItem>
            <ButtonGroupItem id="all">All</ButtonGroupItem>
          </ButtonGroup>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-52">
            <Select
              size="sm"
              aria-label="Topic"
              selectedKey={topic ?? ""}
              onSelectionChange={(k) => setTopic(k ? String(k) : null)}
              items={topicItems}
            >
              {(item) => <Select.Item id={item.id} label={item.label} />}
            </Select>
          </div>
          <div className="w-44">
            <Select
              size="sm"
              aria-label="Sort"
              selectedKey={sort}
              onSelectionChange={(k) => setSort(k as "recent" | "weight")}
              items={[
                { id: "recent", label: "Newest first" },
                { id: "weight", label: "Most relied on" },
              ]}
            >
              {(item) => <Select.Item id={item.id} label={item.label} />}
            </Select>
          </div>
          <Checkbox isSelected={problemsOnly} onChange={setProblemsOnly} label="Only problems" />
        </div>

        {(pending.data?.length ?? 0) > 0 && (
          <div className="rounded-lg bg-secondary px-3.5 py-2.5 text-sm text-tertiary ring-1 ring-secondary">
            <span className="font-medium text-secondary">In review: </span>
            {pending.data!.map((p, i) => (
              <span key={p.id}>
                {i > 0 && " · "}
                {p.origin === "remember" ? `"${p.title}"` : p.title}
                {p.status === "escalated" ? " (waiting on the topic owner)" : " (with the Guardian)"}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-baseline justify-between text-sm text-tertiary">
          <span>
            {list.total} {list.total === 1 ? "claim" : "claims"}
          </span>
        </div>

        {list.loading && list.rows.length === 0 ? (
          <Loading />
        ) : list.rows.length === 0 ? (
          <Empty title="No claims match">
            {q ? "Try fewer words, or another status." : "Remember a fact, or connect a source, and claims show up here."}
          </Empty>
        ) : (
          <ul className="divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
            {list.rows.map((c) => (
              <ClaimRow key={c.id} claim={c} active={c.id === selected} />
            ))}
          </ul>
        )}
        {list.more && (
          <Button size="sm" color="secondary" onClick={list.more} isLoading={list.loading} className="self-center">
            Show more
          </Button>
        )}
      </div>

      <div className={cx("min-w-0", !selected && "max-lg:hidden")}>
        {selected ? (
          <div className="lg:sticky lg:top-6">
            <Button
              size="sm"
              color="link-gray"
              iconLeading={ArrowLeft}
              onClick={() => goPage("knowledge")}
              className="mb-3 lg:hidden"
            >
              All claims
            </Button>
            <ClaimDetailView key={selected} id={selected} />
          </div>
        ) : (
          <Empty title="Pick a claim">
            Its sources and their tiers, its relationships to other claims, the posts that rely on it, and how it got in.
          </Empty>
        )}
      </div>
    </div>
  );
}

function ClaimRow({ claim, active }: { claim: ClaimSummary; active: boolean }) {
  return (
    <li>
      <a
        href={pageHref("knowledge", `claims/${claim.id}`)}
        className={cx("flex flex-col gap-2 px-4 py-3 transition hover:bg-primary_hover", active && "bg-secondary")}
        aria-current={active ? "true" : undefined}
      >
        <span className={cx("text-sm text-primary", (claim.status === "superseded" || claim.status === "retracted") && "text-tertiary line-through decoration-1")}>
          {claim.text}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-quaternary">
          <ClaimStatusBadge status={claim.status} />
          {claim.inConflict && <ConflictBadge />}
          {claim.topics.map((t) => t.name).join(", ")}
          {claim.postCount > 0 && <span>· {claim.postCount === 1 ? "1 post relies on it" : `${claim.postCount} posts rely on it`}</span>}
          {claim.validFrom && <span>· since {formatDate(claim.validFrom)}</span>}
        </span>
      </a>
    </li>
  );
}

function topicPath(t: Topic, all: Topic[]): string {
  const parent = t.parent ? all.find((p) => p.id === t.parent) : undefined;
  return parent ? `${topicPath(parent, all)} / ${t.name}` : t.name;
}
