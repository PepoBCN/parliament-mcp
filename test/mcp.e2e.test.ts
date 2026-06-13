/**
 * End-to-end test of the ParlIQ MCP server.
 *
 * This is a LIVE test: it spawns the built server (dist/index.js) over the real
 * MCP stdio protocol and calls every tool against the live ParlIQ API. It proves
 * three things at once:
 *   1. the server speaks MCP correctly (initialize handshake + tool listing),
 *   2. every tool maps to a real, working ParlIQ endpoint,
 *   3. failures are returned as graceful MCP errors, not crashes.
 *
 * Requires `pnpm build` first (run automatically by the `test` script) and
 * network access to PARLIQ_API_URL (default https://parliq.feldberg.co).
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(__dirname, "../dist/index.js");

const EXPECTED_TOOLS = [
  "search_evidence",
  "list_committees",
  "get_committee",
  "get_member_profile",
  "get_member_activity",
  "get_member_votes",
  "compare_say_vs_vote",
  "list_witnesses",
  "get_witness",
  "list_submitters",
  "list_reports",
  "get_report_summary",
  "get_committee_stats",
  "search_by_source_type",
];

let client: Client;

/** Call a tool, assert it did not error, and return its text payload. */
async function callOk(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text?: string }[];
    isError?: boolean;
  };
  const text = res.content.map((c) => c.text ?? "").join("\n");
  expect(res.isError, `${name} returned an error: ${text.slice(0, 300)}`).toBeFalsy();
  expect(text.length, `${name} returned empty content`).toBeGreaterThan(0);
  return text;
}

// IDs discovered live so the suite can't go stale.
let memberId: number;
let witnessId: number;
let reportId: number;

beforeAll(async () => {
  client = new Client({ name: "parliq-e2e", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...process.env } as Record<string, string>,
  });
  await client.connect(transport);

  // Discover real IDs to exercise the parameterised tools.
  const cttee = JSON.parse(await callOk("get_committee", { slug: "science-innovation-technology" }));
  memberId = (cttee.members ?? [])[0]?.memberId ?? (cttee.members ?? [])[0]?.id;

  const witnesses = JSON.parse(await callOk("list_witnesses"));
  witnessId = witnesses[0].id;

  const reports = JSON.parse(await callOk("list_reports"));
  reportId = reports[0].id;
}, 120_000);

afterAll(async () => {
  await client?.close();
});

describe("MCP protocol", () => {
  test("lists exactly the expected 14 tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
  });
});

describe("tools return live data", () => {
  test("search_evidence", async () => {
    const text = await callOk("search_evidence", { query: "AI regulation", limit: 3 });
    const data = JSON.parse(text);
    expect(data).toHaveProperty("answer");
    expect(Array.isArray(data.sources)).toBe(true);
  });

  test("list_committees returns the six tracked committees", async () => {
    const data = JSON.parse(await callOk("list_committees"));
    expect(data.length).toBe(6);
    expect(data.map((c: { slug: string }) => c.slug)).toContain("science-innovation-technology");
  });

  test("get_committee", async () => {
    const data = JSON.parse(await callOk("get_committee", { slug: "justice" }));
    expect(data.name).toMatch(/justice/i);
    expect(Array.isArray(data.members)).toBe(true);
  });

  test("get_member_profile", async () => {
    const data = JSON.parse(await callOk("get_member_profile", { memberId }));
    expect(data).toHaveProperty("memberName");
    expect(data).toHaveProperty("profile");
  });

  test("get_member_activity", async () => {
    const data = JSON.parse(await callOk("get_member_activity", { memberId }));
    expect(data).toHaveProperty("contributions");
  });

  test("get_member_votes", async () => {
    const data = JSON.parse(await callOk("get_member_votes", { memberId }));
    expect(data).toHaveProperty("votes");
  });

  test("compare_say_vs_vote", async () => {
    const data = JSON.parse(
      await callOk("compare_say_vs_vote", {
        memberId,
        memberName: "Chi Onwurah",
        topic: "artificial intelligence",
      })
    );
    expect(data).toHaveProperty("speech_and_evidence");
    expect(data).toHaveProperty("voting_record");
  });

  test("list_witnesses", async () => {
    const data = JSON.parse(await callOk("list_witnesses"));
    expect(data.length).toBeGreaterThan(100);
    expect(data[0]).toHaveProperty("name");
  });

  test("get_witness", async () => {
    const data = JSON.parse(await callOk("get_witness", { witnessId }));
    expect(data).toHaveProperty("name");
  });

  test("list_submitters", async () => {
    const data = JSON.parse(await callOk("list_submitters"));
    expect(data.length).toBeGreaterThan(100);
  });

  test("list_reports", async () => {
    const data = JSON.parse(await callOk("list_reports"));
    expect(data.length).toBeGreaterThan(100);
    expect(data[0]).toHaveProperty("id");
  });

  test("get_report_summary", async () => {
    const data = JSON.parse(await callOk("get_report_summary", { reportId }));
    expect(data).toHaveProperty("summary");
    expect(String(data.summary).length).toBeGreaterThan(50);
  });

  test("get_committee_stats", async () => {
    const data = JSON.parse(await callOk("get_committee_stats"));
    expect(data.totalReports).toBeGreaterThan(100);
    expect(data).toHaveProperty("uniqueWitnesses");
  });

  test("search_by_source_type", async () => {
    const data = JSON.parse(
      await callOk("search_by_source_type", { query: "net zero", sourceType: "oral_evidence", limit: 3 })
    );
    expect(data).toHaveProperty("answer");
  });
});

describe("graceful error handling", () => {
  test("unknown report ID returns an MCP error, not a crash", async () => {
    const res = (await client.callTool({
      name: "get_report_summary",
      arguments: { reportId: 999999999 },
    })) as { content: { text?: string }[]; isError?: boolean };
    expect(res.isError).toBe(true);
    expect(res.content.map((c) => c.text ?? "").join("")).toMatch(/error/i);
  });

  test("invalid arguments are rejected by schema validation", async () => {
    // memberId must be a positive integer; a string is rejected before the
    // handler runs and comes back as a graceful MCP validation error.
    const res = (await client.callTool({
      name: "get_member_profile",
      arguments: { memberId: "not-a-number" },
    })) as { content: { text?: string }[]; isError?: boolean };
    expect(res.isError).toBe(true);
    expect(res.content.map((c) => c.text ?? "").join("")).toMatch(/validation/i);
  });
});
