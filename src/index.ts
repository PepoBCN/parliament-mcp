#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v3";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const API_URL = (process.env.PARLIQ_API_URL || "https://parliq.feldberg.co").replace(/\/+$/, "");
const API_KEY = process.env.PARLIQ_API_KEY || "";
// Search and report-summary calls can take time (embeddings + Claude). Generous
// default so a slow-but-valid response isn't killed; override via env.
const TIMEOUT_MS = Number(process.env.PARLIQ_TIMEOUT_MS) || 60000;

// ---------------------------------------------------------------------------
// HTTP layer: every request is bounded by a timeout and surfaces a clear error.
// ---------------------------------------------------------------------------
async function fetchJson(
  path: string,
  init: { method: string; body?: string }
): Promise<unknown> {
  const url = `${API_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: init.method,
      body: init.body,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `ParlIQ API ${res.status} ${res.statusText} for ${path}` +
          (text ? `: ${text.slice(0, 300)}` : "")
      );
    }
    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`ParlIQ API request timed out after ${TIMEOUT_MS}ms for ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function apiGet(path: string): Promise<unknown> {
  return fetchJson(path, { method: "GET" });
}

function apiPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  return fetchJson(path, { method: "POST", body: JSON.stringify(body) });
}

// ---------------------------------------------------------------------------
// tRPC helpers. ParlIQ uses a superjson transformer, so input is wrapped in
// `{ json: ... }` and output is unwrapped from `result.data.json`.
// ---------------------------------------------------------------------------
function unwrapTrpc(data: unknown): unknown {
  const d = data as Record<string, unknown>;
  const result = d?.result as Record<string, unknown> | undefined;
  const inner = result?.data as Record<string, unknown> | undefined;
  return inner?.json ?? data;
}

async function trpcQuery(proc: string, input?: unknown): Promise<unknown> {
  const qs =
    input === undefined
      ? ""
      : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  return unwrapTrpc(await apiGet(`/api/trpc/${proc}${qs}`));
}

async function trpcMutation(proc: string, input: unknown): Promise<unknown> {
  return unwrapTrpc(await apiPost(`/api/trpc/${proc}`, { json: input }));
}

// REST search endpoint (not tRPC) returns its payload directly.
function mcpSearch(body: Record<string, unknown>): Promise<unknown> {
  return apiPost("/api/mcp/search", body);
}

// ---------------------------------------------------------------------------
// MCP response helpers. Tool handlers never throw: failures come back as an
// MCP error result so the client sees a clean message instead of a crash.
// ---------------------------------------------------------------------------
type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function formatResult(data: unknown): string {
  if (typeof data === "string") return data;
  return JSON.stringify(data, null, 2);
}

async function call(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const data = await fn();
    return { content: [{ type: "text", text: formatResult(data) }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "parliq",
  version: "1.1.0",
});

// 1. search_evidence
server.tool(
  "search_evidence",
  "Search parliamentary evidence (reports, oral evidence, written evidence, Hansard debates) using semantic search. Returns an AI-generated answer with source citations.",
  {
    query: z.string().min(1).max(2000).describe("The search query"),
    reportIds: z
      .array(z.number().int().positive())
      .optional()
      .describe("Optional array of report IDs to filter by (see list_reports)"),
    limit: z
      .number().int().min(1).max(100)
      .optional()
      .describe("Max number of source chunks to return (default 10)"),
    mode: z
      .enum(["fast", "deep"])
      .optional()
      .describe("Search mode: 'fast' (concise, quicker) or 'deep' (detailed, more thorough)"),
    sourceTypes: z
      .array(z.string())
      .optional()
      .describe(
        "Filter by source type: report_section, oral_evidence, written_evidence, hansard_contribution, written_question"
      ),
  },
  async (args) =>
    call(() => {
      const body: Record<string, unknown> = { query: args.query };
      if (args.reportIds) body.reportIds = args.reportIds;
      if (args.limit) body.limit = args.limit;
      if (args.mode) body.mode = args.mode;
      if (args.sourceTypes) body.sourceTypes = args.sourceTypes;
      return mcpSearch(body);
    })
);

// 2. list_committees
server.tool(
  "list_committees",
  "List all parliamentary select committees tracked by ParlIQ, including their IDs and slugs.",
  async () => call(() => trpcQuery("committees.list"))
);

// 3. get_committee
server.tool(
  "get_committee",
  "Get a committee's profile including its members, recent reports, and focus areas.",
  {
    slug: z
      .string()
      .min(1)
      .describe(
        "Committee slug. One of: science-innovation-technology, energy-security-net-zero, environmental-audit, justice, treasury, business-trade"
      ),
  },
  async (args) => call(() => trpcQuery("committees.profile", { slug: args.slug }))
);

// 4. get_member_profile
server.tool(
  "get_member_profile",
  "Get an AI-generated profile of a committee member (MP or Lord), including their background, interests, and committee roles.",
  {
    memberId: z.number().int().positive().describe("The member's numeric ID"),
  },
  async (args) =>
    call(() => apiGet(`/api/mcp/members/${args.memberId}/profile`))
);

// 5. get_member_activity
server.tool(
  "get_member_activity",
  "Get a member's Hansard debate contributions - what they've said in Parliament.",
  {
    memberId: z.number().int().positive().describe("The member's numeric ID"),
  },
  async (args) =>
    call(() => trpcQuery("committees.memberActivity", { memberId: args.memberId }))
);

// 6. get_member_votes
server.tool(
  "get_member_votes",
  "Get a member's voting record in Parliament - how they voted on divisions.",
  {
    memberId: z.number().int().positive().describe("The member's numeric ID"),
  },
  async (args) =>
    call(() => trpcQuery("committees.memberVotes", { memberId: args.memberId }))
);

// 7. compare_say_vs_vote
server.tool(
  "compare_say_vs_vote",
  "Compare what a member has said about a topic (via semantic search) with how they've voted. Useful for spotting consistency or contradictions between rhetoric and voting behaviour.",
  {
    memberId: z.number().int().positive().describe("The member's numeric ID"),
    memberName: z.string().min(1).max(100).describe("The member's name (for the search query)"),
    topic: z.string().min(1).max(500).describe("The topic to compare (e.g. 'renewable energy', 'AI regulation')"),
  },
  async (args) =>
    call(async () => {
      const [speech, votes] = await Promise.all([
        mcpSearch({ query: `What has ${args.memberName} said about ${args.topic}` }),
        trpcQuery("committees.memberVotes", { memberId: args.memberId }),
      ]);
      return {
        description: `Comparison of what ${args.memberName} has said about "${args.topic}" vs how they voted`,
        speech_and_evidence: speech,
        voting_record: votes,
      };
    })
);

// 8. list_witnesses
server.tool(
  "list_witnesses",
  "List all witnesses who have given oral evidence to parliamentary select committees.",
  async () => call(() => trpcQuery("witnesses.list"))
);

// 9. get_witness
server.tool(
  "get_witness",
  "Get details about a specific witness including their evidence sessions and testimony.",
  {
    witnessId: z.number().int().positive().describe("The witness's numeric ID (see list_witnesses)"),
  },
  async (args) => call(() => trpcQuery("witnesses.get", { id: args.witnessId }))
);

// 10. list_submitters
server.tool(
  "list_submitters",
  "List all organisations and individuals who have submitted written evidence to parliamentary committees.",
  async () => call(() => trpcQuery("submitters.list"))
);

// 11. list_reports
server.tool(
  "list_reports",
  "List all parliamentary committee reports and oral-evidence sessions tracked by ParlIQ, with their IDs, titles, committees, and publication dates. Use the IDs with get_report_summary or to filter search_evidence.",
  async () => call(() => trpcQuery("search.listReports"))
);

// 12. get_report_summary
server.tool(
  "get_report_summary",
  "Get an AI-generated summary of a specific parliamentary committee report. Use list_reports to find report IDs.",
  {
    reportId: z.number().int().positive().describe("The report's numeric ID (see list_reports)"),
  },
  async (args) =>
    call(() => trpcMutation("search.summarizeReport", { reportId: args.reportId }))
);

// 13. get_committee_stats
server.tool(
  "get_committee_stats",
  "Get aggregate statistics across all committees - report counts, evidence counts, voting records, debates, written questions, and witness counts.",
  async () => call(() => trpcQuery("committees.stats"))
);

// 14. search_by_source_type
server.tool(
  "search_by_source_type",
  "Search parliamentary evidence filtered to a specific source type. Source types: report_section, oral_evidence, written_evidence, hansard_contribution, written_question.",
  {
    query: z.string().min(1).max(2000).describe("The search query"),
    sourceType: z
      .enum([
        "report_section",
        "oral_evidence",
        "written_evidence",
        "hansard_contribution",
        "written_question",
      ])
      .describe("The source type to filter by"),
    limit: z
      .number().int().min(1).max(100)
      .optional()
      .describe("Max number of source chunks to return (default 10)"),
    mode: z
      .enum(["fast", "deep"])
      .optional()
      .describe("Search mode: 'fast' (concise, quicker) or 'deep' (detailed, more thorough)"),
  },
  async (args) =>
    call(() => {
      const body: Record<string, unknown> = {
        query: args.query,
        sourceTypes: [args.sourceType],
      };
      if (args.limit) body.limit = args.limit;
      if (args.mode) body.mode = args.mode;
      return mcpSearch(body);
    })
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`ParlIQ MCP server running on stdio (API: ${API_URL})`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
