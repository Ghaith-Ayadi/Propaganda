// Propaganda's MCP server, the small way: JSON-RPC over one POST (the
// Streamable HTTP transport, stateless, answering in JSON). What Claude's
// plugin talks to. A tool is a name, a description, an input schema and a
// function; adding one is adding an entry to TOOLS.
//
// Methods: initialize, ping, notifications/* (acknowledged), tools/list,
// tools/call. Nothing else is offered yet (no resources, no prompts).

import type { Pool } from "pg";
import type { ApiToken, Scope } from "./tokens.js";
import { AssignError, assignPost, checkAssign } from "./assign.js";
import { collections } from "../agents/store.js";

export const PROTOCOL = "2025-06-18";

export interface ToolContext {
  db: Pool;
  token: ApiToken;
}

export interface Tool {
  name: string;
  description: string;
  scope: Scope;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

export const TOOLS: Tool[] = [
  {
    name: "list_collections",
    description: "The blog's collections (sections), with the public description of each and the tenant's rules for posts in it. Pick one for assign_post.",
    scope: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (_args, ctx) => {
      const cols = await collections(ctx.token.site);
      return { collections: cols.filter((c) => !c.is_hidden).map((c) => ({ name: c.name, description: c.description, rules: c.rules ?? "" })) };
    },
  },
  {
    name: "assign_post",
    description:
      "Put a post on the blog: send the material it is written from (Markdown, already in the tenant's voice when you can) and the Writer drafts it in that collection, then a reviewer sees it. Images and PDFs go as assets. Returns the post's id and where to watch it.",
    scope: "assign",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The post's title (working title is fine)" },
        collection: { type: "string", description: "A collection name from list_collections; the first one when left out" },
        markdown: { type: "string", description: "The source material: the post as written, or notes, transcript, findings. Markdown." },
        assets: {
          type: "array",
          description: "Images to place in the post and PDFs to draw on. Each is a URL or base64 bytes.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              kind: { type: "string", enum: ["image", "pdf"] },
              url: { type: "string", description: "A public URL" },
              data: { type: "string", description: "The bytes, base64" },
              mediaType: { type: "string" },
            },
            required: ["name", "kind"],
          },
        },
      },
      required: ["title", "markdown"],
    },
    run: async (args, ctx) => {
      const input = checkAssign(args);
      const r = await assignPost(ctx.db, { ...input, site: ctx.token.site, user: ctx.token.createdBy, via: "mcp" });
      return {
        post: r.post,
        collection: r.collection,
        url: r.url,
        writer: r.run ? "drafting" : `not started: ${r.notStarted}`,
        assets: r.assets,
      };
    },
  },
];

interface Request {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

type Response = { jsonrpc: "2.0"; id: string | number | null; result: unknown } | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

const ok = (id: Request["id"], result: unknown): Response => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: Request["id"], code: number, message: string): Response => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

const text = (v: unknown) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }], structuredContent: typeof v === "object" && v ? v : undefined });

/** One JSON-RPC message; null for a notification (nothing goes back). */
export async function handle(msg: Request, ctx: ToolContext, tools: Tool[] = TOOLS): Promise<Response | null> {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(msg?.id, -32600, "Invalid request");
  const { id, method, params = {} } = msg;
  const notification = id === undefined;
  if (method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "propaganda", version: "1" },
        instructions: `Propaganda, the tenant's blog and its agents. Tools act on one site, as the member whose token this is.`,
      });
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: tools.filter((t) => ctx.token.scopes.includes(t.scope)).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const tool = tools.find((t) => t.name === name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${name}`);
      if (!ctx.token.scopes.includes(tool.scope)) return fail(id, -32602, `This token can't ${tool.scope}`);
      const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {};
      try {
        return ok(id, text(await tool.run(args, ctx)));
      } catch (err) {
        // A tool's own refusal is a result the model can act on, not a protocol error.
        const message = err instanceof AssignError ? err.message : `The tool failed: ${(err as Error).message}`;
        if (!(err instanceof AssignError)) console.error(`mcp ${name}:`, err);
        return ok(id, { ...text(message), isError: true });
      }
    }
    default:
      return notification ? null : fail(id, -32601, `Method not found: ${method}`);
  }
}

/** A request body (one message or a batch): the answers, or none for notifications only. */
export async function handleBody(body: unknown, ctx: ToolContext, tools: Tool[] = TOOLS): Promise<Response | Response[] | null> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m as Request, ctx, tools)))).filter((r): r is Response => r !== null);
    return out.length ? out : null;
  }
  return handle(body as Request, ctx, tools);
}
