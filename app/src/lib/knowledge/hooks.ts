// Data hooks for the knowledge base pages. Each one asks the backend for what
// one screen shows and re-asks when a write lands (`changed()`), so lists stay
// in step after a Remember, a contest or a bulk action without a global store.

import { useCallback, useEffect, useRef, useState } from "react";
import { reportError } from "@/lib/telemetry";
import { kb } from "./adapter";
import type { ClaimPage, ClaimQuery, ClaimSummary, FlagPage, FlagQuery } from "./types";

const listeners = new Set<() => void>();

/** Tell every mounted hook that knowledge base data changed. */
export function changed(): void {
  for (const fn of listeners) fn();
}

function useChangeTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return tick;
}

export interface Loaded<T> {
  data: T | undefined;
  loading: boolean;
  error: unknown;
  reload: () => void;
}

/** Runs `load` whenever `deps` change or the knowledge base changes; drops stale answers. */
export function useKb<T>(where: string, load: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const tick = useChangeTick();
  const [own, setOwn] = useState(0);
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: unknown }>({
    data: undefined,
    loading: true,
    error: null,
  });
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    load().then(
      (data) => {
        if (mine === seq.current) setState({ data, loading: false, error: null });
      },
      (error) => {
        reportError(where, error);
        if (mine === seq.current) setState((s) => ({ ...s, loading: false, error }));
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, own]);

  const reload = useCallback(() => setOwn((n) => n + 1), []);
  return { ...state, reload };
}

/**
 * The claims list: pages of `limit` rows, appended as the person scrolls
 * ("Load more"). Changing the filters starts over from the first page.
 */
export function useClaimPages(q: Omit<ClaimQuery, "offset">) {
  const key = JSON.stringify(q);
  // The offset belongs to one set of filters: new filters read from the top.
  const [cursor, setCursor] = useState({ key, offset: 0 });
  const offset = cursor.key === key ? cursor.offset : 0;
  const setOffset = (n: number) => setCursor({ key, offset: n });
  const [rows, setRows] = useState<ClaimSummary[]>([]);
  const page = useKb<ClaimPage>("kb.claims", () => kb().claims({ ...q, offset }), [key, offset]);
  useEffect(() => {
    if (!page.data) return;
    const got = page.data.rows;
    setRows((prev) => (offset === 0 ? got : [...prev.filter((r) => !got.some((g) => g.id === r.id)), ...got]));
  }, [page.data, offset]);
  return {
    rows,
    total: page.data?.total ?? 0,
    loading: page.loading,
    error: page.error,
    more: page.data?.next != null ? () => setOffset(page.data!.next!) : null,
  };
}

export function useFlagPage(q: FlagQuery) {
  return useKb<FlagPage>("kb.flags", () => kb().flags(q), [JSON.stringify(q)]);
}

/** The nav bar's count beside "Knowledge base": open flags plus open re-checks; red when one is urgent. */
export function useKnowledgeBadge(): { count: number; urgent: boolean } | null {
  // Sample data isn't this tenant's: no number beside the nav entry.
  const sample = kb().sample;
  const flags = useKb("kb.badge", () => kb().flags({ status: "open", kind: "all", offset: 0, limit: 1 }), []);
  const threads = useKb("kb.rechecks", () => kb().rechecks(), []);
  if (sample || !flags.data) return null;
  const count = flags.data.total + (threads.data ?? []).reduce((s, t) => s + t.open, 0);
  return count ? { count, urgent: flags.data.urgent > 0 } : null;
}
