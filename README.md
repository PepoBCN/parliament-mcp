# ParlIQ MCP Server

MCP (Model Context Protocol) server for ParlIQ - Parliamentary Intelligence. Gives Claude Desktop (or any MCP client) direct access to UK parliamentary data: committee reports, oral and written evidence, Hansard debates, voting records, and written questions.

## What it does

14 tools that proxy to the ParlIQ Express API:

- **search_evidence** - Semantic search across all parliamentary evidence
- **list_committees** / **get_committee** - Browse select committees and their profiles
- **get_member_profile** - AI-generated MP/Lord profiles
- **get_member_activity** - Hansard debate contributions
- **get_member_votes** - Voting records
- **get_member_written_questions** - Written questions tabled
- **compare_say_vs_vote** - Compare rhetoric vs voting behaviour
- **list_witnesses** / **get_witness** - Oral evidence witnesses
- **list_submitters** - Written evidence submitters
- **get_report_summary** - AI summaries of committee reports
- **get_committee_stats** - Aggregate statistics
- **search_by_source_type** - Search filtered to a specific evidence type

## Setup

```bash
pnpm install
pnpm build
```

## Configuration

Two environment variables:

| Variable | Description | Default |
|---|---|---|
| `PARLIQ_API_URL` | ParlIQ API base URL | `https://diplomatic-mindfulness-parliq-dev.up.railway.app` |
| `PARLIQ_API_KEY` | API key for authentication | (none) |

## Claude Desktop config

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "parliq": {
      "command": "node",
      "args": ["/absolute/path/to/parliament-mcp/dist/index.js"],
      "env": {
        "PARLIQ_API_URL": "https://diplomatic-mindfulness-parliq-dev.up.railway.app",
        "PARLIQ_API_KEY": "your-api-key"
      }
    }
  }
}
```

Replace the path and API key with your actual values.

## Development

```bash
pnpm build    # compile TypeScript
pnpm start    # run the server (stdio transport)
```

## Scope

Current parliamentary session only (2024-25). Covers six select committees: Science & Technology, Energy & Net Zero, Environmental Audit, Justice, Treasury, and Business & Trade.
