// The one seam between the knowledge base pages and the server.
//
// Every page reads and writes through `kb()`. Two implementations:
//   - placeholder.ts: in-memory sample data for a made-up tenant. It pages,
//     filters and searches like the server would, and simulates the Guardian
//     ruling, so the screens can be built and reviewed before the schema lands.
//   - live.ts: the real thing, against the kb_ tables and functions of the
//     draft migration (project files, kb-data-model/). It works only once that
//     migration is applied.
//
// Every real build uses live.ts (the kb_ tables are on the server since
// 20261008000010); a tenant with no knowledge yet sees empty pages. The
// placeholder serves the UI preview (VITE_UI_PREVIEW) only.

import type {
  BulkAction,
  ClaimDetail,
  ClaimPage,
  ClaimQuery,
  ContestAxis,
  ContestState,
  FlagDetail,
  FlagPage,
  FlagQuery,
  Grades,
  HandClose,
  PendingProposal,
  PostFindings,
  RecheckThread,
  RecheckThreadSummary,
  RememberInput,
  Topic,
} from "./types";
import { placeholderKb } from "./placeholder";
import { liveKb } from "./live";
import { UI_PREVIEW } from "@/lib/preview";

export interface KnowledgeBackend {
  /** True when the data on screen is sample data. The pages say so. */
  readonly sample: boolean;

  topics(): Promise<Topic[]>;
  claims(q: ClaimQuery): Promise<ClaimPage>;
  claim(id: string): Promise<ClaimDetail | null>;
  pending(): Promise<PendingProposal[]>;
  /** kb_remember: always admitted; the Guardian may flag what it contradicts. Returns the proposal id. */
  remember(input: RememberInput): Promise<string>;

  flags(q: FlagQuery): Promise<FlagPage>;
  flag(id: string): Promise<FlagDetail | null>;
  /** kb_close_flag: won't fix, taken down (retracted), snoozed or duplicate. */
  closeFlag(id: string, status: HandClose, opts?: { note?: string; until?: string; duplicateOf?: string }): Promise<void>;
  /** Marks the fix as applied; the reviewing agent closes the flag as fixed once it sees the new version. */
  applyFix(id: string): Promise<void>;
  /** kb_contest: opens a draft proposal tied to the flag; the agent drafts the changes. */
  contest(flagId: string, reason: string, axis: ContestAxis | null): Promise<ContestState>;
  /** kb_submit: sends the drafted contest to the Guardian. */
  submitContest(flagId: string): Promise<ContestState>;

  rechecks(): Promise<RecheckThreadSummary[]>;
  recheck(id: string): Promise<RecheckThread | null>;
  bulk(flagIds: string[], action: BulkAction): Promise<void>;

  grades(): Promise<Grades>;

  /** What the Checker and the Guardian said about one post: the editor's Review tab. */
  postFindings(postId: string): Promise<PostFindings>;
}

export function kb(): KnowledgeBackend {
  return UI_PREVIEW ? placeholderKb : liveKb;
}
