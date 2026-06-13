# ParlIQ MCP Server

MCP (Model Context Protocol) server for ParlIQ - Parliamentary Intelligence. Gives Claude Desktop (or any MCP client) direct access to UK parliamentary data: committee reports, oral and written evidence, Hansard debates, voting records, and witnesses.

## What it does

14 tools that proxy to the ParlIQ API:

| Tool | What it returns |
|---|---|
| `search_evidence` | Semantic search across all parliamentary evidence, with an AI answer + citations |
| `search_by_source_type` | Same search, filtered to one source type (oral evidence, written evidence, etc.) |
| `list_committees` | The six tracked select committees, with IDs and slugs |
| `get_committee` | A committee's profile: members, reports, focus areas |
| `get_committee_stats` | Aggregate counts across all committees |
| `list_reports` | All reports and oral-evidence sessions, with IDs |
| `get_report_summary` | AI-generated summary of a specific report |
| `get_member_profile` | AI-generated profile of an MP or Lord |
| `get_member_activity` | A member's Hansard debate contributions |
| `get_member_votes` | A member's voting record |
| `compare_say_vs_vote` | A member's stated position on a topic vs how they voted |
| `list_witnesses` | Everyone who has given oral evidence |
| `get_witness` | A specific witness's details and sessions |
| `list_submitters` | Everyone who has submitted written evidence |

The typical flow: a `list_*` tool gives you IDs, then a `get_*` tool fetches detail (e.g. `list_reports` → `get_report_summary`, `list_committees` → `get_committee` → `get_member_profile`).

## Setup

```bash
pnpm install
pnpm build
```

## Configuration

All environment variables are optional (see `.env.example`):

| Variable | Description | Default |
|---|---|---|
| `PARLIQ_API_URL` | ParlIQ API base URL | `https://parliq.feldberg.co` |
| `PARLIQ_API_KEY` | API key for authentication | (none - public endpoints don't currently require one) |
| `PARLIQ_TIMEOUT_MS` | Per-request timeout in ms | `60000` |

## Claude Desktop config

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "parliq": {
      "command": "node",
      "args": ["/absolute/path/to/parliq-mcp/dist/index.js"],
      "env": {
        "PARLIQ_API_URL": "https://parliq.feldberg.co"
      }
    }
  }
}
```

Replace the path with your actual checkout. `PARLIQ_API_KEY` is optional.

## Testing

```bash
pnpm smoke   # fast (~10s) liveness check: handshake + tool list + two calls
pnpm test    # full live e2e suite: builds, then exercises all 14 tools over MCP stdio
```

Both run against the live API (`PARLIQ_API_URL`), so they need network access. The e2e suite spawns the built server over the real MCP stdio protocol, discovers IDs dynamically, and asserts every tool returns live data plus that errors and invalid arguments are handled gracefully.

## Development

```bash
pnpm build       # compile TypeScript to dist/
pnpm start       # run the server (stdio transport)
pnpm test:watch  # vitest in watch mode
```

## Scope

Current parliamentary session only (2024-25). Covers six select committees: Science, Innovation and Technology; Energy Security and Net Zero; Environmental Audit; Justice; Treasury; and Business and Trade.
