// Admin > Arena: the same real agent task on two or three models, answers shown
// blind (A, B, C in a shuffled order), and Ayadi picks the best. The vote and
// what each answer cost are saved (public.arena_votes); the standings below sum
// them per agent. Mounted by lib/admin/sections.tsx as "arena" (#/admin/arena).

import { useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminContext";
import { toast } from "@/components/base/toast/toast";
import {
  arenaSources,
  arenaTenants,
  listVotes,
  runRound,
  saveVote,
  standings,
  type ArenaAgent,
  type ArenaEntry,
  type ArenaRound,
  type ArenaSource,
  type ArenaVote,
} from "@/lib/admin/arena";
import { userMessage } from "@/lib/errors";
import { reportError } from "@/lib/telemetry";

const AGENTS: { id: ArenaAgent; label: string; detail: string }[] = [
  { id: "pitcher", label: "Pitcher: judging", detail: "Judges the tenant's waiting ideas (up to 25) against its goals and what it already has, with the Pitcher's own prompt." },
  { id: "listener", label: "Listener: a call", detail: "Reads one call with the Listener's own prompt and pulls out content gaps and candidate facts." },
];
const FALLBACK_MODELS = ["deepseek/deepseek-v4-pro", "xiaomi/mimo-v2.6-pro", "openai/gpt-6-sol"];
const LETTERS = ["A", "B", "C"];
const usd = (n: number) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}`;
const field = "rounded-lg border border-secondary bg-primary px-2 py-1.5 text-sm text-secondary";

export function ArenaPage() {
  const { client } = useAdmin();
  const [agent, setAgent] = useState<ArenaAgent>("pitcher");
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [site, setSite] = useState("");
  const [sources, setSources] = useState<ArenaSource[]>([]);
  const [source, setSource] = useState("");
  const [transcript, setTranscript] = useState("");
  const [title, setTitle] = useState("");
  const [models, setModels] = useState<string[]>(FALLBACK_MODELS);
  const [round, setRound] = useState<ArenaRound | null>(null);
  const [voted, setVoted] = useState<string | null | undefined>(undefined);
  const [note, setNote] = useState("");
  const [votes, setVotes] = useState<ArenaVote[] | null>(null);
  const [busy, setBusy] = useState<"run" | "vote" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = (where: string) => (err: unknown) => {
    reportError(where, err);
    setError(userMessage(err));
  };

  useEffect(() => {
    arenaTenants(client).then((t) => {
      setTenants(t);
      setSite((s) => s || (t[0]?.id ?? ""));
    }, fail("ArenaPage.tenants"));
    listVotes(client).then(setVotes, fail("ArenaPage.votes"));
  }, [client]);

  useEffect(() => {
    if (!site) return;
    setSource("");
    arenaSources(client, site).then((r) => {
      setSources(r.sources);
      if (r.defaultModels?.length) setModels((m) => (m === FALLBACK_MODELS ? r.defaultModels : m));
    }, fail("ArenaPage.sources"));
  }, [client, site]);

  const picked = models.map((m) => m.trim()).filter(Boolean);
  const ready = !!site && picked.length >= 2 && (agent === "pitcher" || !!source || !!transcript.trim());
  const table = useMemo(() => (votes ? standings(votes, agent) : []), [votes, agent]);

  const run = async () => {
    setBusy("run");
    setError(null);
    setRound(null);
    setVoted(undefined);
    setNote("");
    try {
      setRound(
        await runRound(client, {
          agent,
          site,
          models: picked,
          ...(agent === "listener" ? (source ? { source } : { transcript, title }) : {}),
        }),
      );
    } catch (err) {
      fail("ArenaPage.run")(err);
    } finally {
      setBusy(null);
    }
  };

  const vote = async (winner: string | null) => {
    if (!round) return;
    setBusy("vote");
    try {
      await saveVote(client, round, winner, note);
      setVoted(winner);
      toast.add({ type: "success", title: "Vote saved", description: winner ? `You picked ${winner}.` : "None was good enough." });
      listVotes(client).then(setVotes, fail("ArenaPage.votes"));
    } catch (err) {
      fail("ArenaPage.vote")(err);
    } finally {
      setBusy(null);
    }
  };

  const revealed = voted !== undefined;

  return (
    <div className="flex flex-col gap-6 text-sm">
      <section className="flex flex-col gap-3 rounded-xl border border-secondary p-4">
        <div className="flex flex-wrap gap-1">
          {AGENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-pressed={agent === a.id}
              onClick={() => setAgent(a.id)}
              className="rounded-lg px-3 py-1.5 text-secondary hover:bg-secondary aria-pressed:bg-tertiary aria-pressed:font-medium aria-pressed:text-primary"
            >
              {a.label}
            </button>
          ))}
        </div>
        <p className="text-tertiary">{AGENTS.find((a) => a.id === agent)!.detail}</p>

        <div className="flex flex-wrap gap-2">
          <select aria-label="Tenant" value={site} onChange={(e) => setSite(e.target.value)} className={field}>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name || t.id}</option>
            ))}
          </select>
          {agent === "listener" && (
            <select aria-label="Call" value={source} onChange={(e) => setSource(e.target.value)} className={field}>
              <option value="">Paste a transcript…</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{`${s.title || "untitled"} (${(s.occurred ?? s.created).slice(0, 10)})`}</option>
              ))}
            </select>
          )}
        </div>
        {agent === "listener" && !source && (
          <div className="flex flex-col gap-2">
            <input aria-label="Call title" placeholder="Call title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
            <textarea
              aria-label="Transcript"
              placeholder="Paste the transcript here"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={6}
              className={`${field} font-mono text-xs`}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-tertiary">Models (AI Gateway ids; leave the third empty for two)</span>
          <div className="grid gap-2 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <input
                key={i}
                aria-label={`Model ${i + 1}`}
                value={models[i] ?? ""}
                onChange={(e) => setModels((m) => Object.assign([...m], { [i]: e.target.value }))}
                className={`${field} font-mono text-xs`}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!ready || busy !== null}
            onClick={() => void run()}
            className="rounded-lg bg-primary-solid px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy === "run" ? "Asking the models…" : "Run a round"}
          </button>
          <span className="text-xs text-quaternary">Capped per round on the worker. Every call is in the cost log as arena:{agent}.</span>
        </div>
        {error && <p className="text-error-primary">{error}</p>}
      </section>

      {round && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="type-heading text-primary">{round.task}</h3>
            {revealed && <span className="text-tertiary">Round cost {usd(round.costUsd)}</span>}
          </div>
          <div className={`grid gap-3 ${round.entries.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
            {round.entries.map((e, i) => (
              <article key={i} className={`flex min-w-0 flex-col rounded-xl border ${revealed && voted === e.model ? "border-brand" : "border-secondary"}`}>
                <header className="flex items-center justify-between gap-2 border-b border-secondary px-4 py-2.5">
                  <span className="font-medium text-primary">Answer {LETTERS[i]}</span>
                  {revealed && (
                    <span className="truncate font-mono text-xs text-tertiary">
                      {e.model} · {usd(e.costUsd)} · {(e.ms / 1000).toFixed(1)}s
                    </span>
                  )}
                </header>
                <div className="max-h-[560px] flex-1 overflow-y-auto px-4 py-3">
                  {e.error ? <p className="text-error-primary">This model failed: {e.error}</p> : <Answer agent={round.agent} entry={e} ideas={round.ideas} />}
                </div>
                {!revealed && !e.error && (
                  <footer className="border-t border-secondary px-4 py-2.5">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void vote(e.model)}
                      className="w-full rounded-lg border border-secondary px-3 py-1.5 font-medium text-secondary hover:bg-secondary disabled:opacity-50"
                    >
                      {LETTERS[i]} is best
                    </button>
                  </footer>
                )}
              </article>
            ))}
          </div>
          {!revealed && (
            <div className="flex flex-wrap items-center gap-2">
              <input aria-label="Note" placeholder="Why (optional, saved with the vote)" value={note} onChange={(e) => setNote(e.target.value)} className={`${field} min-w-0 flex-1`} />
              <button type="button" disabled={busy !== null} onClick={() => void vote(null)} className="rounded-lg px-3 py-1.5 text-secondary hover:bg-secondary disabled:opacity-50">
                None is good enough
              </button>
            </div>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-medium text-primary">Standings: {AGENTS.find((a) => a.id === agent)!.label}</h3>
        <div className="overflow-x-auto rounded-xl border border-secondary">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary text-left text-[11px] font-semibold uppercase tracking-wide text-quaternary">
                <th className="px-4 py-2">Model</th>
                <th className="px-4 py-2">Wins</th>
                <th className="px-4 py-2">Win rate</th>
                <th className="px-4 py-2">Cost per answer</th>
              </tr>
            </thead>
            <tbody>
              {!votes && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-tertiary">Loading…</td></tr>
              )}
              {votes && table.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-tertiary">No votes yet.</td></tr>
              )}
              {table.map((s) => (
                <tr key={s.model} className="border-t border-secondary">
                  <td className="px-4 py-2 font-mono text-xs text-primary">{s.model}</td>
                  <td className="px-4 py-2 text-secondary">{s.wins} of {s.rounds}</td>
                  <td className="px-4 py-2 text-secondary">{Math.round((100 * s.wins) / s.rounds)}%</td>
                  <td className="px-4 py-2 text-secondary">{usd(s.avgCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---- one answer, readable ----

type Rec = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown): Rec[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Rec[]) : []);

function Answer({ agent, entry, ideas }: { agent: ArenaAgent; entry: ArenaEntry; ideas: { id: string; title: string }[] }) {
  const a = entry.answer as Rec | null;
  const problem = entry.problem && <p className="mb-2 rounded-lg bg-warning-primary px-2 py-1 text-xs text-warning-primary">The agent couldn't use this as is: {entry.problem}</p>;
  if (!a || typeof a !== "object") {
    return (
      <>
        {problem}
        <pre className="whitespace-pre-wrap break-words font-mono text-xs text-secondary">{entry.raw}</pre>
      </>
    );
  }
  if (agent === "pitcher") {
    const titles = new Map(ideas.map((i) => [i.id, i.title]));
    return (
      <>
        {problem}
        <ol className="flex flex-col gap-3">
          {list(a.ideas).map((j, n) => (
            <li key={n} className="flex flex-col gap-0.5">
              <span className="font-medium text-primary">{titles.get(text(j.id)) ?? text(j.id)}</span>
              <Line label="Topics" value={Array.isArray(j.topics) ? (j.topics as string[]).join(", ") : ""} />
              <Line label="Target search" value={text(j.targetSearch)} />
              <Line label="Timely" value={j.timely === true ? `yes${text(j.expiresAt) ? `, until ${text(j.expiresAt)}` : ""}` : ""} />
              <Line label="Answers a gap" value={text(j.answersGap)} />
              <Line label="Demand" value={text(j.demand)} />
              <Line label="Repeats" value={text(j.duplicateOf)} />
              <Line label="Replaces flagged" value={text(j.replacesFlagged)} />
              <Line label="What changed" value={text(j.changed)} />
              <Line label="Searches" value={Array.isArray(j.searches) ? (j.searches as string[]).join(" · ") : ""} />
            </li>
          ))}
        </ol>
      </>
    );
  }
  return (
    <>
      {problem}
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-quaternary">Ideas</h4>
      <ol className="mb-4 flex flex-col gap-2.5">
        {list(a.ideas).map((i, n) => (
          <li key={n} className="flex flex-col gap-0.5">
            <span className="font-medium text-primary">{text(i.title)} <span className="font-normal text-quaternary">· {text(i.kind)}</span></span>
            <span className="text-secondary">{text(i.why)}</span>
            {text(i.quote) && <q className="text-xs text-tertiary">{text(i.quote)}</q>}
          </li>
        ))}
        {!list(a.ideas).length && <li className="text-tertiary">None.</li>}
      </ol>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-quaternary">Facts</h4>
      <ol className="flex flex-col gap-2.5">
        {list(a.facts).map((f, n) => (
          <li key={n} className="flex flex-col gap-0.5">
            <span className="text-primary">{text(f.text)} {text(f.topic) && <span className="text-quaternary">· {text(f.topic)}</span>}</span>
            {text(f.quote) && <q className="text-xs text-tertiary">{text(f.quote)}</q>}
          </li>
        ))}
        {!list(a.facts).length && <li className="text-tertiary">None.</li>}
      </ol>
    </>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <span className="text-secondary">
      <span className="text-quaternary">{label}: </span>
      {value}
    </span>
  );
}
