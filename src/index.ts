#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v3";

// Configuration
const API_URL =
  process.env.PARLIQ_API_URL ||
  "https://diplomatic-mindfulness-parliq-dev.up.railway.app";
const API_KEY = process.env.PARLIQ_API_KEY || "";

// Helper: make API requests to ParlIQ
async function apiGet(path: string): Promise<unknown> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function apiPost(
  path: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

// Helper: unwrap tRPC response format
function unwrapTrpc(data: unknown): unknown {
  const d = data as Record<string, unknown>;
  const result = d?.result as Record<string, unknown> | undefined;
  const inner = result?.data as Record<string, unknown> | undefined;
  return inner?.json ?? data;
}

// Format any value as readable text for MCP response
function formatResult(data: unknown): string {
  if (typeof data === "string") return data;
  return JSON.stringify(data, null, 2);
}

// Create MCP server
const server = new McpServer({
  name: "parliq",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// 1. search_evidence
// ---------------------------------------------------------------------------
server.tool(
  "search_evidence",
  "Search parliamentary evidence (reports, oral evidence, written evidence, Hansard debates) using semantic search. Returns an AI-generated answer with source citations.",
  {
    query: z.string().describe("The search query"),
    reportIds: z
      .array(z.number())
      .optional()
      .describe("Optional array of report IDs to filter by"),
    limit: z
      .number()
      .optional()
      .describe("Max number of source chunks to return (default 10)"),
    mode: z
      .enum(["fast", "deep"])
      .optional()
      .describe("Search mode: 'fast' (Haiku) or 'deep' (Sonnet)"),
    sourceTypes: z
      .array(z.string())
      .optional()
      .describe(
        "Filter by source type: report_section, oral_evidence, written_evidence, hansard_contribution, written_question"
      ),
  },
  async (args) => {
    const body: Record<string, unknown> = { query: args.query };
    if (args.reportIds) body.reportIds = args.reportIds;
    if (args.limit) body.limit = args.limit;
    if (args.mode) body.mode = args.mode;
    if (args.sourceTypes) body.sourceTypes = args.sourceTypes;

    const data = await apiPost("/api/mcp/search", body);
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

// ---------------------------------------------------------------------------
// 2. list_committees
// ---------------------------------------------------------------------------
server.tool(
  "list_committees",
  "List all parliamentary select committees tracked by ParlIQ, including their IDs and slugs.",
  async () => {
    const raw = await apiGet("/api/trpc/committees.list");
    const data = unwrapTrpc(raw);
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

// ---------------------------------------------------------------------------
// 3. get_committee
// ---------------------------------------------------------------------------
server.tool(
  "get_committee",
  "Get a committee's profile including its members, recent reports, and focus areas.",
  {
    slug: z
      .string()
      .describe(
        "Committee slug (e.g. 'science-innovation-and-technology', 'energy-security-and-net-zero')"
      ),
  },
  async (args) => {
    const input = encodeURIComponent(JSON.stringify({ json: { slug: args.slug } }));
    const raw = await apiGet(`/api/trpc/committees.profile?input=${input}`);
    const data = unwrapTrpc(raw);
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

// ---------------------------------------------------------------------------
// 4. get_member_profile
// ---------------------------------------------------------------------------
server.tool(
  "get_member_profile",
  "Get an AI-generated profile of a committee member (MP or Lord), including their background, interests, and committee roles.",
  {
    memberId: z.number().describe("The member's numeric ID"),
  },
  async (args) => {
    const data = await apiGet(`/api/mcp/members/${args.memberId}/profile`);
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

// ---------------------------------------------------------------------------
// 5. get_member_activity
// ---------------------------------------------------------------------------
server.tool(
  "get_member_activity",
  "Get a member's Hansard debate contributions - what they've said in Parliament.",
  {
    memberId: z.number().describe("The member's numeric ID"),
  },
  async (args) => {
    const input = encodeURIComponent(
      JSON.stringify({ json: { memberId: args.memberId } })
    );
    const raw = await apiGet(
      `/api/trpc/committees.memberActivity?input=${input}`
    );
    const data = unwrapTrpc(raw);
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

// ---------------------------------------------------------------------------
// 6. get_member_votes
// ---------------------------------------------------------------------------
server.tool(
  "get_member_votes",
  "Get a member's voting record in Parliament - how they voted on divisions.",
  {
    memberId: z.number().describe("The member's numeric ID"),
  },
  async (args) => {
    const input = encodeURIComponent(
      JSON.stringify({ json: { memberId: args.memberId } })
    );
    const raw = await apiGet(
      `/api/trpc/committees.memberVotes?input=${input}`
    );
    const data = unwrapTrpc(raw);
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

// ---------------------------------------------------------------------------
// 7. get_member_written_questions
// ---------------------------------------------------------------------------
server.tool(
  "get_member_written_questions",
  "Get written questions tabled by a member of Parliament.",
  {
    memberId: z.number().describe("The member's numeric ID"),
  },
  async (args) => {
    const input = encodeURIComponent(
      JSON.stringify({ json: { memberId: args.memberId } })
    );
    const raw = await apiGet(
      `/api/trpc/committees.memberWrittenQuestions?input=${input}`
    );
    const data = unwrapTrpc(raw);
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

// ---------------------------------------------------------------------------
// 8. compare_say_vs_vote
// ---------------------------------------------------------------------------
server.tool(
  "compare_say_vs_vote",
  "Compare what a member has said about a topic (via semantic search) with how they've voted. Useful for spotting consistency or contradictions between rhetoric and voting behaviour.",
  {
    memberId: z.number().describe("The member's numeric ID"),
    memberName: z.string().describe("The member's name (for the search query)"),
    topic: z.string().describe("The topic to compare (e.g. 'renewable energy', 'AI regulation')"),
  },
  async (args) => {
    // Run both calls in parallel
    const [searchResult, votesRaw] = await Promise.all([
      apiPost("/api/mcp/search", {
        query: `What has ${args.memberName} said about ${args.topic}`,
      }),
      (async () => {
        const input = encodeURIComponent(
          JSON.stringify({ json: { memberId: args.memberId } })
        );
        return apiGet(`/api/trpc/committees.memberVotes?input=${input}`);
      })(),
    ]);

    const votes = unwrapTrpc(votesRaw);

    const combined = {
      description: `Comparison of what ${args.memberName} has said about "${args.topic}" vs how they voted`,
      speech_and_evidence: searchResult,
      voting_record: votes,
    };

    return {
      content: [{ type: "text" as const, text: formatResult(combined) }],
    };
  }
);

// ---------------------------------------------------------------------------
// 9. list_witnesses
// ---------------------------------------------------------------------------
server.tool(
  "list_witnesses",
  "List all witnesses who have given oral evidence to parliamentary select committees.",
  async () => {
    const raw = await apiGet("/api/trpc/witnesses.list");
    const data = unwrapTrpc(raw);
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

// ---------------------------------------------------------------------------
// 10. get_witness
// ---------------------------------------------------------------------------
server.tool(
  "get_witness",
  "Get details about a specific witness including their evidence sessions and testimony.",
  {
    witnessId: z.string().describe("The witness ID"),
  },
  async (args) => {
    const input = encodeURIComponent(
      JSON.stringify({ json: { id: args.witnessId } })
    );
    const raw = await apiGet(`/api/trpc/witnesses.get?input=${input}`);
    const data = unwrapTrpc(raw);
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

// ---------------------------------------------------------------------------
// 11. list_submitters
// ---------------------------------------------------------------------------
server.tool(
  "list_submitters",
  "List all organisations and individuals who have submitted written evidence to parliamentary committees.",
  async () => {
    const raw = await apiGet("/api/trpc/submitters.list");
    const data = unwrapTrpc(raw);
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

// ---------------------------------------------------------------------------
// 12. get_report_summary
// ---------------------------------------------------------------------------
server.tool(
  "get_report_summary",
  "Get an AI-generated summary of a specific parliamentary committee report.",
  {
    reportId: z.number().describe("The report's numeric ID"),
  },
  async (args) => {
    const input = encodeURIComponent(
      JSON.stringify({ json: { reportId: args.reportId } })
    );
    const raw = await apiGet(
      `/api/trpc/committees.reportSummary?input=${input}`
    );
    const data = unwrapTrpc(raw);
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

// ---------------------------------------------------------------------------
// 13. get_committee_stats
// ---------------------------------------------------------------------------
server.tool(
  "get_committee_stats",
  "Get aggregate statistics across all committees - report counts, evidence counts, member counts, and breakdowns.",
  async () => {
    const raw = await apiGet("/api/trpc/committees.stats");
    const data = unwrapTrpc(raw);
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

// ---------------------------------------------------------------------------
// 14. search_by_source_type
// ---------------------------------------------------------------------------
server.tool(
  "search_by_source_type",
  "Search parliamentary evidence filtered to a specific source type. Source types: report_section, oral_evidence, written_evidence, hansard_contribution, written_question.",
  {
    query: z.string().describe("The search query"),
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
      .number()
      .optional()
      .describe("Max number of source chunks to return (default 10)"),
    mode: z
      .enum(["fast", "deep"])
      .optional()
      .describe("Search mode: 'fast' (Haiku) or 'deep' (Sonnet)"),
  },
  async (args) => {
    const body: Record<string, unknown> = {
      query: args.query,
      sourceTypes: [args.sourceType],
    };
    if (args.limit) body.limit = args.limit;
    if (args.mode) body.mode = args.mode;

    const data = await apiPost("/api/mcp/search", body);
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ParlIQ MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
