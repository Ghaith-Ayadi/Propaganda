// How the Guardian's checks become a verdict (policy v1, "Verdict"). The model
// fills in the checks; this code decides, so "contested" is what a weak check
// produces and never the model's mood. Pure: unit-tested against the fixtures.

export type CheckResult = "pass" | "weak" | "fail" | "escalate" | "patch" | "minor" | "major";
export type Verdict = "admit" | "admit_contested" | "reject" | "escalate";
export type Severity = "" | "patch" | "minor" | "major";

export interface Check {
  check: string;
  result: CheckResult;
  reason: string;
}

const CHECK_RE = /^(C([1-9]|1[01])|H[1-4])$/;
const RESULTS = new Set<CheckResult>(["pass", "weak", "fail", "escalate", "patch", "minor", "major"]);

/** Keep the checks the database accepts (kb_checks_valid), one per name, the strictest kept. */
export function cleanChecks(raw: unknown): Check[] {
  if (!Array.isArray(raw)) return [];
  const rank: Record<string, number> = { pass: 0, patch: 0, minor: 1, weak: 1, major: 2, fail: 3, escalate: 4 };
  const byName = new Map<string, Check>();
  for (const c of raw) {
    const check = String(c?.check ?? "").toUpperCase();
    const result = String(c?.result ?? "").toLowerCase() as CheckResult;
    if (!CHECK_RE.test(check) || !RESULTS.has(result)) continue;
    const next = { check, result, reason: String(c?.reason ?? "").slice(0, 2000) };
    const prev = byName.get(check);
    if (!prev || rank[result]! > rank[prev.result]!) byName.set(check, next);
  }
  return [...byName.values()].sort((a, b) => order(a.check) - order(b.check));
}

function order(check: string): number {
  return (check.startsWith("H") ? 0 : 100) + Number(check.slice(1));
}

export interface VerdictInput {
  origin: string;
  checks: Check[];
  /** A supersede or retract targets a remembered claim or one in an owned topic (H2). */
  retiresProtected: boolean;
}

export interface VerdictOutput {
  verdict: Verdict;
  checks: Check[];
  /** The changes go in contested even though the verdict is admit (the first sweep). */
  sweepContested: boolean;
}

export function decide({ origin, checks, retiresProtected }: VerdictInput): VerdictOutput {
  let out = checks;
  const has = (r: CheckResult) => out.some((c) => c.result === r);

  // 1. A Remember is admitted, whatever its checks say (H1).
  if (origin === "remember") return { verdict: "admit", checks: out, sweepContested: false };

  // The first sweep never escalates: owners would drown on day one. What would
  // have escalated goes in contested instead.
  if (origin === "sweep") {
    out = out.map((c) => (c.result === "escalate" ? { ...c, result: "weak" as const } : c));
  }

  // H2: retiring a remembered or owned claim is the owner's call. The database
  // refuses it anyway; escalating says so instead of failing.
  if (retiresProtected && !has("fail")) {
    out = cleanChecks([...out, { check: "H2", result: "escalate", reason: "Retires a remembered or owned claim: the owner decides." }]);
  }

  // 2-5, in order.
  if (has("escalate")) return { verdict: "escalate", checks: out, sweepContested: false };
  if (has("fail")) return { verdict: "reject", checks: out, sweepContested: false };
  if (has("weak")) {
    // In the sweep the ruling names which changes are contested; the rest settle.
    return origin === "sweep"
      ? { verdict: "admit", checks: out, sweepContested: true }
      : { verdict: "admit_contested", checks: out, sweepContested: false };
  }
  return { verdict: "admit", checks: out, sweepContested: false };
}

/** C11's result, or the higher of what the model said and what the changes imply. */
export function severityOf(checks: Check[], ops: string[]): Severity {
  const c11 = checks.find((c) => c.check === "C11")?.result;
  if (c11 === "patch" || c11 === "minor" || c11 === "major") return c11;
  if (ops.includes("retract")) return "major";
  if (ops.includes("supersede")) return "minor";
  return "";
}
