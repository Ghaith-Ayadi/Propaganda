import { mcpUrl } from "@/lib/tenantConfig";
import { Card, CopyField, Note } from "@/components/settings/ui";

const CAPABILITIES = [
  "Search the knowledge base and read the claims behind an answer",
  "Read your posts, their versions and their flags",
  "Ask for a pitch or a draft, and see it land in the pipeline",
  "Remember a fact, which goes through the Guardian like any other",
];

const CLIENTS = [
  { name: "Claude", how: "Settings, Connectors, Add custom connector, paste the URL." },
  { name: "ChatGPT", how: "Settings, Connectors, add a custom MCP server, paste the URL." },
  { name: "Cursor and others", how: "Add a remote MCP server with the URL. Sign in when asked." },
];

export function AiTab() {
  const url = mcpUrl();
  return (
    <div className="space-y-6">
      <Card
        title="Use Propaganda from your AI tools"
        description="Propaganda is an MCP server. Your own assistant connects to it and works with your knowledge base and content. You bring no model or key of ours; your assistant brings its own."
      >
        <div className="space-y-3">
          <CopyField label="MCP server URL" value={url} />
          <p className="text-xs text-tertiary">You sign in with the same Google account or emailed code, so it can only reach tenants you belong to.</p>
          <Note>The address is shaped like the real one; the MCP server itself ships after the knowledge base API.</Note>
        </div>
      </Card>
      <Card title="Add it to your tool">
        <ul className="divide-y divide-secondary rounded-lg border border-secondary">
          {CLIENTS.map((c) => (
            <li key={c.name} className="px-4 py-3">
              <div className="text-sm font-medium text-primary">{c.name}</div>
              <div className="text-xs text-tertiary">{c.how}</div>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="What it can do">
        <ul className="list-disc space-y-1 pl-5 text-sm text-secondary">
          {CAPABILITIES.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
