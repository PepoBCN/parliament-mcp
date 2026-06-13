#!/usr/bin/env node
/**
 * Fast liveness check for the ParlIQ MCP server.
 *
 * Spawns the built server over stdio, runs the MCP handshake, lists the tools,
 * and makes two cheap live calls. Exits 0 on success, 1 on any failure. Much
 * quicker than the full vitest e2e suite - handy for a manual sanity check.
 *
 *   pnpm build && pnpm smoke
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(__dirname, "../dist/index.js");

function text(res) {
  return (res.content ?? []).map((c) => c.text ?? "").join("\n");
}

async function main() {
  const client = new Client({ name: "parliq-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...process.env },
  });
  await client.connect(transport);
  console.log(`✓ connected to ${SERVER}`);

  const { tools } = await client.listTools();
  console.log(`✓ ${tools.length} tools listed: ${tools.map((t) => t.name).join(", ")}`);
  if (tools.length !== 14) throw new Error(`expected 14 tools, got ${tools.length}`);

  const committees = JSON.parse(text(await client.callTool({ name: "list_committees", arguments: {} })));
  console.log(`✓ list_committees -> ${committees.length} committees`);

  const stats = JSON.parse(text(await client.callTool({ name: "get_committee_stats", arguments: {} })));
  console.log(`✓ get_committee_stats -> ${stats.totalReports} reports, ${stats.uniqueWitnesses} witnesses`);

  await client.close();
  console.log("\nSMOKE PASS");
}

main().catch((err) => {
  console.error("\nSMOKE FAIL:", err.message);
  process.exit(1);
});
