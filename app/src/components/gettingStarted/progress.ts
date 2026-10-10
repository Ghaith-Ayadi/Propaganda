// The Strategist's progress on a tenant's first day, from the worker
// (GET /worker/v1/progress/strategist, worker/README.md): which steps of the
// plan are done, how far the first pitches are, and which first drafts are
// being written. Any member of the site may read it. Polled every few seconds
// while Getting started waits on an agent, and never otherwise.

import { useEffect, useState } from "react";
import { authHeader, SUPABASE_URL } from "@/lib/supabase";
import { coded } from "@/lib/errors";
import { reportError } from "@/lib/telemetry";

const WORKER_URL = (import.meta.env.VITE_WORKER_URL as string | undefined) ?? `${SUPABASE_URL}/worker/v1`;

export interface StrategistProgress {
  proposalId: string | null;
  status: "requested" | "running" | "sent" | "approved" | "failed" | "superseded" | null;
  steps: { label: string; state: "done" | "running" | "waiting" }[];
  /** The first pitches, one Strategist call per topic. Null until they start. */
  pitches: { topicsDone: number; topics: number; written: number } | null;
  /** The first drafts, started when the plan is approved. */
  drafts: { briefId: string; state: "running" | "done" | "failed" }[];
}

/** The plan's steps as the page shows them before the worker answers. */
export const PLAN_STEPS = [
  "Read your website",
  "Looked up searches and their volumes",
  "Checked who ranks for your searches",
  "Writing the plan",
  "Checking it against the Launch rules",
];

async function fetchProgress(site: string): Promise<StrategistProgress> {
  const res = await fetch(`${WORKER_URL}/progress/strategist?site=${encodeURIComponent(site)}`, {
    headers: { Authorization: await authHeader() },
  });
  if (!res.ok) throw new Error(`worker answered ${res.status}`);
  return (await res.json()) as StrategistProgress;
}

/** Polls while `active`; null until the first answer, and after a failure (the page falls back to the proposal's status). */
export function useStrategistProgress(site: string, active: boolean, everyMs = 4000): StrategistProgress | null {
  const [progress, setProgress] = useState<StrategistProgress | null>(null);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const p = await fetchProgress(site);
        failures = 0;
        if (!stop) setProgress(p);
      } catch (err) {
        // Reported once per wait: the page still moves on the proposal's own status.
        if (failures++ === 0) reportError("Strategist progress not read", coded("START-PROGRESS", err));
      }
      if (!stop) timer = setTimeout(tick, failures > 3 ? everyMs * 4 : everyMs);
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [site, active, everyMs]);
  return progress;
}
