import type { LogoId } from "./logos";
import type { ConnectionId } from "@/lib/tenantConfig";

export type Group = "sources" | "ai" | "outside";

export interface Connector {
  id: string;
  group: Group;
  name: string;
  /** One line under the name in the list and at the top of the body. */
  summary: string;
  logo: LogoId;
  /** Set when "Connect" records a request (lib/tenantConfig.ts useConnection). */
  connection?: ConnectionId;
  detailLabel?: string;
  detailPlaceholder?: string;
}

export const GROUPS: { id: Group; label: string }[] = [
  { id: "sources", label: "Sources" },
  { id: "ai", label: "AI" },
  { id: "outside", label: "Outside CMSs" },
];

export const CONNECTORS: Connector[] = [
  { id: "granola", group: "sources", name: "Granola", logo: "granola", connection: "granola",
    summary: "Meeting notes and transcripts after every call." },
  { id: "transcript-url", group: "sources", name: "Transcript URL", logo: "transcript-url",
    summary: "An open address anyone can POST a transcript to." },
  { id: "slack", group: "sources", name: "Slack", logo: "slack", connection: "slack",
    summary: "Where ideas live and facts come from.", detailLabel: "Workspace", detailPlaceholder: "ledgerline.slack.com" },
  { id: "websites", group: "sources", name: "Websites we watch", logo: "websites",
    summary: "Pages the Scout follows, each tied to a topic." },
  { id: "newsletter", group: "sources", name: "Newsletter", logo: "newsletter", connection: "newsletter",
    summary: "Your existing archive, read into Propaganda.", detailLabel: "Archive or feed URL", detailPlaceholder: "https://example.com/newsletter/rss" },

  { id: "claude", group: "ai", name: "Claude", logo: "claude", summary: "Connect Claude to your knowledge base." },
  { id: "chatgpt", group: "ai", name: "ChatGPT", logo: "chatgpt", summary: "Connect ChatGPT to your knowledge base." },
  { id: "cursor", group: "ai", name: "Cursor and others", logo: "cursor", summary: "Any tool that speaks MCP." },

  { id: "framer", group: "outside", name: "Framer", logo: "framer", connection: "framer",
    summary: "Read your pages and publish approved posts." },
  { id: "webflow", group: "outside", name: "Webflow", logo: "webflow", connection: "webflow",
    summary: "Read a CMS collection and publish into it." },
  { id: "wordpress", group: "outside", name: "WordPress", logo: "wordpress", connection: "wordpress",
    summary: "Read posts and publish through the REST API." },
  { id: "ghost", group: "outside", name: "Ghost", logo: "ghost", connection: "ghost",
    summary: "Read posts and publish through the Admin API." },
  { id: "squarespace", group: "outside", name: "Squarespace", logo: "squarespace", connection: "squarespace",
    summary: "Read-only: public pages and RSS, for audits and analytics." },
];
