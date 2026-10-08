/** Thrown when the budget rules refuse a call. Nothing was sent to a model. */
export class BudgetError extends Error {
  constructor(public readonly reason: "kill-switch" | "global-daily-cap" | "tenant-budget") {
    super(`Model call refused: ${reason}`);
    this.name = "BudgetError";
  }
}

/**
 * The Claude subscription's 5-hour limit is exhausted. `resetsAt` is epoch ms.
 * Never logged as a call: it cost nothing. A workflow engine waits it out.
 */
export class UsageLimitError extends Error {
  constructor(public readonly resetsAt: number) {
    super(`Usage limit reached until ${new Date(resetsAt).toISOString()}`);
    this.name = "UsageLimitError";
  }
}

/** The cost log itself is unreachable or unconfigured. Calls fail closed: no log, no call. */
export class CostLogUnavailableError extends Error {
  constructor(detail: string) {
    super(`Cost log unavailable: ${detail}`);
    this.name = "CostLogUnavailableError";
  }
}
