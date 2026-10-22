// The right-hand side of Connections: what the picked connector is, and how to set it up.

import { useEffect, useState } from "react";
import { Plus, Trash01 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { toast } from "@/components/base/toast/toast";
import { CopyField, Note } from "@/components/settings/ui";
import { createApiToken, listApiTokens, MCP_URL, revokeApiToken, type ApiToken } from "@/lib/apiTokens";
import { userMessage } from "@/lib/errors";
import { reportError } from "@/lib/telemetry";
import { mcpUrl, transcriptUrlShape, useConnection, useWatchedSites } from "@/lib/tenantConfig";
import type { Connector } from "./connectors";
import { Logo } from "./logos";

export function ConnectorBody({ connector: c }: { connector: Connector }) {
  return (
    <div>
      <div className="flex items-start gap-4 border-b border-secondary px-6 py-5">
        <Logo id={c.logo} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="type-title text-primary">{c.name}</h2>
          <p className="mt-0.5 text-sm text-tertiary">{c.summary}</p>
        </div>
        {c.connection && <Status id={c.connection} />}
      </div>
      <div className="space-y-4 px-6 py-5">
        <Body connector={c} />
      </div>
    </div>
  );
}

function Status({ id }: { id: NonNullable<Connector["connection"]> }) {
  const { status } = useConnection(id);
  return status === "requested" ? (
    <Badge size="sm" color="warning">Requested</Badge>
  ) : (
    <Badge size="sm" color="gray">Not connected</Badge>
  );
}

function Body({ connector: c }: { connector: Connector }) {
  switch (c.id) {
    case "transcript-url":
      return <TranscriptUrl />;
    case "websites":
      return <WatchedSites />;
    case "claude":
      return <ClaudePlugin />;
    case "chatgpt":
      return <Mcp client="ChatGPT" steps={["Open Settings, then Connectors.", "Add a custom MCP server.", "Paste the server URL and sign in."]} />;
    case "cursor":
      return <Mcp client="Cursor" steps={["Add a remote MCP server in your tool's settings.", "Paste the server URL.", "Sign in when asked."]} />;
    default:
      return <Connect connector={c} />;
  }
}

const WHAT: Record<string, string[]> = {
  granola: ["Every finished meeting arrives as a transcript.", "We read it for ideas and candidate facts, and quotes link back to the call."],
  slack: ["We read the channels you pick.", "A weak answer in a thread is a content gap, never a fact."],
  newsletter: ["Past issues count toward Volume.", "We compare new posts against what you already sent."],
  framer: ["Reads your pages for audits.", "Publishes approved posts into your Framer site."],
  webflow: ["Reads a CMS collection.", "Publishes approved posts into it."],
  wordpress: ["Reads posts and pages.", "Publishes approved posts through the REST API."],
  ghost: ["Reads posts.", "Publishes approved posts through the Admin API."],
  squarespace: ["Reads public pages and RSS for audits and analytics.", "Squarespace has no way to publish into it, so nothing is written."],
};

function Connect({ connector: c }: { connector: Connector }) {
  const conn = useConnection(c.connection!);
  const [detail, setDetail] = useState(conn.detail);
  const requested = conn.status === "requested";
  return (
    <>
      <ul className="list-disc space-y-1 pl-5 text-sm text-secondary">
        {(WHAT[c.id] ?? []).map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {c.detailLabel && (
        <Input size="sm" label={c.detailLabel} placeholder={c.detailPlaceholder} value={detail} onChange={setDetail} isDisabled={requested} />
      )}
      {requested ? (
        <>
          <Note>Requested. This turns on when its server side ships. Nothing was sent to {c.name} and no credentials were stored.</Note>
          <Button size="sm" color="secondary" onClick={conn.clear}>Cancel request</Button>
        </>
      ) : (
        <Button
          size="sm"
          isDisabled={!!c.detailLabel && !detail.trim()}
          onClick={() => {
            conn.request(detail.trim());
            toast.add({ type: "success", title: `${c.name} requested` });
          }}
        >
          Connect
        </Button>
      )}
    </>
  );
}

function TranscriptUrl() {
  const url = transcriptUrlShape();
  const curl = `curl -X POST "${url}" \\\n  -H "Content-Type: text/plain" \\\n  --data-binary @transcript.txt`;
  return (
    <>
      <p className="text-sm text-secondary">Anyone can POST a transcript to this address: a recorder, a Zap, a script. No integration needed.</p>
      <CopyField label="Transcript URL" value={url} />
      <pre className="overflow-x-auto rounded-lg bg-secondary p-3 font-mono text-xs text-secondary">{curl}</pre>
      <Note>Your own URL, with its secret token, is created when the endpoint ships. Anyone holding it can send transcripts, so it will be shown once and can be replaced.</Note>
    </>
  );
}

function WatchedSites() {
  const { sites, add, remove } = useWatchedSites();
  const [url, setUrl] = useState("");
  const [topic, setTopic] = useState("");
  return (
    <>
      <p className="text-sm text-secondary">Specific pages we follow for ideas: a regulator's news page, a competitor's blog.</p>
      {sites.length > 0 && (
        <ul className="divide-y divide-secondary rounded-lg border border-secondary">
          {sites.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium text-primary">{s.url}</span>
              <span className="text-tertiary">{s.topic || "No topic"}</span>
              <Button size="sm" color="tertiary" aria-label={`Stop watching ${s.url}`} iconLeading={Trash01} onClick={() => remove(s.id)} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <Input size="sm" label="Address" placeholder="https://www.fda.gov/news" value={url} onChange={setUrl} wrapperClassName="flex-1" />
        <Input size="sm" label="Topic" placeholder="School nutrition" value={topic} onChange={setTopic} wrapperClassName="w-40" />
        <Button
          size="sm"
          color="secondary"
          iconLeading={Plus}
          isDisabled={!/^https?:\/\/.+\..+/.test(url.trim())}
          onClick={() => {
            add(url, topic);
            setUrl("");
            setTopic("");
          }}
        >
          Watch
        </Button>
      </div>
    </>
  );
}

const CAN = [
  "Search the knowledge base and read the claims behind an answer",
  "Read your posts, their versions and their flags",
  "Ask for a pitch or a draft, and see it land in the pipeline",
  "Remember a fact, which we check like any other",
];

/** The Claude plugin: an API token, the MCP server's address, and how to install it. */
function ClaudePlugin() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<{ id: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setTokens(await listApiTokens());
    } catch (err) {
      reportError("connections.apiTokens", err);
      setTokens([]);
    }
  };
  useEffect(() => void load(), []);

  const create = async () => {
    setBusy(true);
    try {
      const made = await createApiToken(label.trim() || "Claude");
      setFresh(made);
      setLabel("");
      await load();
    } catch (err) {
      reportError("connections.apiTokens.create", err);
      toast.add({ type: "error", title: userMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (t: ApiToken) => {
    try {
      await revokeApiToken(t.id);
      if (fresh?.id === t.id) setFresh(null);
      await load();
    } catch (err) {
      reportError("connections.apiTokens.revoke", err);
      toast.add({ type: "error", title: userMessage(err) });
    }
  };

  return (
    <>
      <p className="text-sm text-secondary">
        With the Propaganda plugin, Claude puts posts on your blog from wherever you are working: say "blog about this" and we take it from there, in your voice, for your review.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-secondary">
        <li>In Claude, open Settings, Connectors, and add a custom connector with the address below. With the Propaganda plugin installed, it is already listed: press Connect.</li>
        <li>Claude opens Propaganda: pick this blog and press Allow. Claude is connected; it shows up in the list below.</li>
        <li>In any chat, say "blog about this".</li>
      </ol>
      <CopyField label="MCP server URL" value={MCP_URL} />
      <Note>For scripts and other tools that can't sign in, make a token below and send it as a Bearer header.</Note>
      {fresh && (
        <div className="flex flex-col gap-2 rounded-lg border border-secondary p-3">
          <CopyField label="Your new token" value={fresh.token} />
          <Note>Copy it now: it is shown once. Anyone holding it can post to this blog as you, so keep it with your other keys.</Note>
        </div>
      )}
      {tokens && tokens.length > 0 && (
        <ul className="divide-y divide-secondary rounded-lg border border-secondary">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium text-primary">{t.label || "Claude"}</span>
              <span className="text-tertiary">{t.lastSeen ? `Used ${new Date(t.lastSeen).toLocaleDateString()}` : "Never used"}</span>
              <Button size="sm" color="tertiary" aria-label={`Revoke ${t.label || "Claude"}`} iconLeading={Trash01} onClick={() => void revoke(t)} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <Input size="sm" label="Token name" placeholder="Claude on my Mac" value={label} onChange={(v) => setLabel(String(v))} wrapperClassName="flex-1" />
        <Button size="sm" color="secondary" iconLeading={Plus} isLoading={busy} onClick={() => void create()}>
          Make a token
        </Button>
      </div>
      <Note>A token acts as you, on this blog only. Revoke one here and it stops at once.</Note>
    </>
  );
}

function Mcp({ client, steps }: { client: string; steps: string[] }) {
  return (
    <>
      <p className="text-sm text-secondary">
        Propaganda is an MCP server. {client} connects to it with its own model and works with your knowledge base and content.
      </p>
      <CopyField label="MCP server URL" value={mcpUrl()} />
      <ol className="list-decimal space-y-1 pl-5 text-sm text-secondary">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <div>
        <div className="mb-1.5 type-eyebrow text-quaternary">What it can do</div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-secondary">
          {CAN.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>
      <Note>You sign in with the same Google account or emailed code, so it only reaches tenants you belong to. The address has its real shape; the MCP server ships after the knowledge base API.</Note>
    </>
  );
}
