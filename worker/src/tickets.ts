// Where a failure group's bug report becomes a ticket (src/failures.ts).
//
// - notion: a task on the Propaganda Tasks board (Label bug, Status Backlog),
//   with the whole report. NOTION_TOKEN is an internal integration the board
//   is shared with; NOTION_TASKS_DATA_SOURCE overrides the board.
// - github: an issue on GITHUB_ISSUES_REPO (Ghaith-Ayadi/Propaganda). That
//   repository is public, so the issue carries only the workflow, the step,
//   the error's class, counts, the fingerprint and the Admin link: no tenant
//   and no error text (even normalized, it can carry a tenant's words). The
//   rest stays in Admin and Slack. GITHUB_ISSUES_TOKEN may write issues.
// - slack: the whole agent report, posted to SLACK_WEBHOOK_URL (an incoming
//   webhook on Ayadi's private workspace), new and repeats alike. Mentioning
//   @Claude on it (Claude in Slack) hands it to Claude to fix.
//
// FAILURE_TICKETS picks ("github", "slack", "notion", comma-separated); unset,
// every destination with a token is used. A repeat adds a note to the ticket
// and reopens it when it was closed.

export type TicketKind = "notion" | "github" | "slack";

export interface Ticket {
  kind: TicketKind;
  /** Notion page id, or the issue number. */
  ref: string;
  url: string;
}

export interface BugReport {
  fingerprint: string;
  title: string;
  environment: string;
  workflow: string;
  step: string | null;
  signature: string;
  /** The error's class ("GatewayForbiddenError", "Error"): all a public issue says about it. */
  errorClass: string;
  occurrences: number;
  firstSeen: number;
  lastSeen: number;
  tenants: { id: string; name: string }[];
  models: string[];
  cost: number;
  unpriced: number;
  latestError: string;
  runs: { id: string; at: number; site: string | null }[];
  adminUrl: string;
  runUrl: (id: string) => string;
  /** Everything an agent needs to fix it (failures.ts agentReport): private, never on GitHub. */
  agentReport: string;
}

const NOTION_VERSION = "2025-09-03";
const NOTION_TASKS = "36c73ad5-6c72-80bd-aaa6-000ba6df98f2";

const notionToken = () => process.env.NOTION_TOKEN ?? "";
const githubToken = () => process.env.GITHUB_ISSUES_TOKEN ?? "";
const githubRepo = () => process.env.GITHUB_ISSUES_REPO ?? "Ghaith-Ayadi/Propaganda";
const slackWebhook = () => process.env.SLACK_WEBHOOK_URL ?? "";

/** The destinations in use on this box. */
export function ticketSinks(): TicketKind[] {
  const want = process.env.FAILURE_TICKETS;
  const ready: Record<TicketKind, boolean> = { notion: !!notionToken(), github: !!githubToken(), slack: !!slackWebhook() };
  const kinds: TicketKind[] = want
    ? want.split(",").map((s) => s.trim()).filter((s): s is TicketKind => s in ready)
    : ["github", "slack", "notion"];
  return kinds.filter((k) => ready[k]);
}

/** For tests: where the two APIs are. */
const notionApi = () => process.env.NOTION_API_URL ?? "https://api.notion.com";
const githubApi = () => process.env.GITHUB_API_URL ?? "https://api.github.com";

const when = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";

async function ask<T>(what: string, url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`${what} answered ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

// ---- Notion ----

function notion<T>(path: string, method: string, body?: unknown): Promise<T> {
  return ask<T>(`Notion ${method} ${path.split("/").slice(0, 3).join("/")}`, `${notionApi()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${notionToken()}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const text = (content: string) => ({ type: "text", text: { content: content.slice(0, 2000) } });
const para = (content: string) => ({ object: "block", type: "paragraph", paragraph: { rich_text: [text(content)] } });
const heading = (content: string) => ({ object: "block", type: "heading_3", heading_3: { rich_text: [text(content)] } });
const bullet = (content: string) => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: [text(content)] } });
function code(content: string) {
  const parts: ReturnType<typeof text>[] = [];
  // Notion caps a block at 100 pieces of 2000 characters; reports stay far below.
  for (let i = 0; i < Math.min(content.length, 40_000); i += 2000) parts.push(text(content.slice(i, i + 2000)));
  return { object: "block", type: "code", code: { language: "plain text", rich_text: parts } };
}

function notionBody(r: BugReport) {
  return [
    para(`Filed by the worker from a run failure (${r.environment}). One task per failure; repeats are added below.`),
    heading("Report"),
    code(r.agentReport),
    para(`Fingerprint ${r.fingerprint}`),
  ];
}

async function fileNotion(r: BugReport): Promise<Ticket> {
  const page = await notion<{ id: string; url: string }>("/v1/pages", "POST", {
    parent: { type: "data_source_id", data_source_id: process.env.NOTION_TASKS_DATA_SOURCE ?? NOTION_TASKS },
    properties: {
      Name: { title: [text(`${r.environment === "prod" ? "" : `[${r.environment}] `}Run failure: ${r.title}`)] },
      Status: { status: { name: "Backlog" } },
      Label: { multi_select: [{ name: "bug" }] },
    },
    children: notionBody(r),
  });
  return { kind: "notion", ref: page.id, url: page.url };
}

const CLOSED_STATUSES = new Set(["Done", "Cancelled"]);

async function recurNotion(t: Ticket, r: BugReport, more: number): Promise<void> {
  const page = await notion<{ properties?: { Status?: { status?: { name?: string } | null } } }>(`/v1/pages/${t.ref}`, "GET");
  const status = page.properties?.Status?.status?.name ?? "";
  const reopened = CLOSED_STATUSES.has(status);
  if (reopened) await notion(`/v1/pages/${t.ref}`, "PATCH", { properties: { Status: { status: { name: "Backlog" } } } });
  const latest = r.runs[0];
  await notion(`/v1/blocks/${t.ref}/children`, "PATCH", {
    children: [
      heading(`Happened again (${when(r.lastSeen)})`),
      para(`${more} more time${more === 1 ? "" : "s"}, ${r.occurrences} in all.${reopened ? ` It was ${status}, so it is back in Backlog.` : ""}`),
      ...(latest ? [para(`Latest run ${latest.id}: ${r.runUrl(latest.id)}`)] : []),
      code(r.agentReport),
    ],
  });
}

// ---- GitHub ----

function github<T>(path: string, method: string, body?: unknown): Promise<T> {
  return ask<T>(`GitHub ${method} ${path.replace(/\/\d+.*$/, "")}`, `${githubApi()}/repos/${githubRepo()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${githubToken()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "propaganda-worker",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The public name of a group: workflow, step and error class, never the error text. */
const publicTitle = (r: BugReport) => `${r.workflow}${r.step ? ` › ${r.step}` : ""}: ${r.errorClass}`;

/** Public repository: what failed and where, no tenant and no error text. */
function githubBody(r: BugReport): string {
  return [
    `A run failure the worker recorded on **${r.environment}**. One issue per failure; repeats are added as comments.`,
    "",
    `- Agent run: \`${r.workflow}\`${r.step ? `, step \`${r.step}\`` : ""}`,
    `- Error class: \`${r.errorClass}\``,
    `- Seen ${r.occurrences} time${r.occurrences === 1 ? "" : "s"}, first ${when(r.firstSeen)}, last ${when(r.lastSeen)}`,
    `- Tenants affected: ${r.tenants.length}`,
    `- Fingerprint: \`${r.fingerprint}\``,
    "",
    `The error, stack, input and runs are in [Admin > Failures](${r.adminUrl}) (superadmins only) and in the Slack report.`,
    "",
    `<!-- failure-fingerprint: ${r.fingerprint} -->`,
  ].join("\n");
}

async function fileGithub(r: BugReport): Promise<Ticket> {
  const issue = await github<{ number: number; html_url: string }>("/issues", "POST", {
    title: `${r.environment === "prod" ? "" : `[${r.environment}] `}Run failure: ${publicTitle(r)}`.slice(0, 250),
    body: githubBody(r),
    labels: ["bug", "run-failure", r.environment],
  });
  return { kind: "github", ref: String(issue.number), url: issue.html_url };
}

async function recurGithub(t: Ticket, r: BugReport, more: number): Promise<void> {
  const issue = await github<{ state: string }>(`/issues/${t.ref}`, "GET");
  const reopened = issue.state === "closed";
  if (reopened) await github(`/issues/${t.ref}`, "PATCH", { state: "open" });
  await github(`/issues/${t.ref}/comments`, "POST", {
    body: `Happened again: ${more} more time${more === 1 ? "" : "s"}, ${r.occurrences} in all, last ${when(r.lastSeen)}.${reopened ? " Reopened." : ""} Details in [Admin > Failures](${r.adminUrl}).`,
  });
}

// ---- Slack ----

/** Slack's limit for a message is 40,000 characters; keep well under it. */
const SLACK_MAX = 12_000;

function slackText(r: BugReport, headline: string): string {
  const report = r.agentReport.length > SLACK_MAX ? `${r.agentReport.slice(0, SLACK_MAX)}\n… (cut; the rest is in Admin)` : r.agentReport;
  // Slack's own escapes, so the report shows as written.
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    `*${esc(headline)}* (${r.environment}) · ${esc(r.workflow)}${r.step ? ` › ${esc(r.step)}` : ""}`,
    `Mention @Claude in this thread to have it fixed. <${r.adminUrl}|Admin> · fingerprint \`${r.fingerprint}\``,
    "```",
    esc(report),
    "```",
  ].join("\n");
}

async function postSlack(text: string): Promise<void> {
  const res = await fetch(slackWebhook(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, unfurl_links: false }),
  });
  if (!res.ok) throw new Error(`Slack answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
}

async function fileSlack(r: BugReport): Promise<Ticket> {
  await postSlack(slackText(r, "New run failure"));
  return { kind: "slack", ref: r.fingerprint, url: "" };
}

async function recurSlack(r: BugReport, more: number): Promise<void> {
  await postSlack(slackText(r, `Run failure again: ${more} more, ${r.occurrences} in all`));
}

export function fileTicket(kind: TicketKind, r: BugReport): Promise<Ticket> {
  return kind === "notion" ? fileNotion(r) : kind === "github" ? fileGithub(r) : fileSlack(r);
}

export function recurTicket(t: Ticket, r: BugReport, more: number): Promise<void> {
  return t.kind === "notion" ? recurNotion(t, r, more) : t.kind === "github" ? recurGithub(t, r, more) : recurSlack(r, more);
}
