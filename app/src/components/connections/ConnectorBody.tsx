// The right-hand side of Connections: what the picked connector is, and how to set it up.

import { useState } from "react";
import { Plus, Trash01 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { toast } from "@/components/base/toast/toast";
import { CopyField, Note } from "@/components/settings/ui";
import { mcpUrl, transcriptUrlShape, useConnection, useWatchedSites } from "@/lib/tenantConfig";
import type { Connector } from "./connectors";
import { Logo } from "./logos";

export function ConnectorBody({ connector: c }: { connector: Connector }) {
  return (
    <div>
      <div className="flex items-start gap-4 border-b border-secondary px-6 py-5">
        <Logo id={c.logo} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="font-title text-xl text-primary">{c.name}</h2>
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
      return <Mcp client="Claude" steps={["Open Settings, then Connectors.", "Choose Add custom connector.", "Paste the server URL and sign in."]} />;
    case "chatgpt":
      return <Mcp client="ChatGPT" steps={["Open Settings, then Connectors.", "Add a custom MCP server.", "Paste the server URL and sign in."]} />;
    case "cursor":
      return <Mcp client="Cursor" steps={["Add a remote MCP server in your tool's settings.", "Paste the server URL.", "Sign in when asked."]} />;
    default:
      return <Connect connector={c} />;
  }
}

const WHAT: Record<string, string[]> = {
  granola: ["Every finished meeting arrives as a transcript.", "The Listener reads it for ideas and candidate facts, and quotes link back to the call."],
  slack: ["The Listener reads the channels you pick.", "A weak answer in a thread is a content gap, never a fact."],
  newsletter: ["Past issues count toward Volume.", "The Checker compares new posts against what you already sent."],
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
      <p className="text-sm text-secondary">Specific pages the Scout follows for ideas: a regulator's news page, a competitor's blog.</p>
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
  "Remember a fact, which goes through the Guardian like any other",
];

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
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-quaternary">What it can do</div>
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
