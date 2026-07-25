# finance-agent

Plaid-backed MCP server for conversational US personal finance planning in Cursor. No dashboard — connect accounts once, then plan in chat.

Requires Node.js 22+ (uses built-in `node:sqlite`).

## Setup

```bash
cp .env.example .env
# Fill PLAID_CLIENT_ID, PLAID_SECRET, ENCRYPTION_KEY
npm install
npm run build
```

Get Plaid keys at [dashboard.plaid.com](https://dashboard.plaid.com/developers/keys). Start with `PLAID_ENV=sandbox`, then move to live banks with `PLAID_ENV=production` (Plaid’s old separate Development environment is deprecated).

### Live banks (Production / Trial)

1. In the Plaid Dashboard, enable **Production** access (Trial or Limited Production is enough for personal use).
2. Copy the **Production** secret into `.env` (`PLAID_SECRET`) and set `PLAID_ENV=production`.
3. For Chase / Amex / Capital One / etc., set an HTTPS `PLAID_REDIRECT_URI` (ngrok is fine) ending in `/oauth`, and allowlist that exact URI under Team → API → Allowed redirect URIs.
4. Run `npm run connect` and link real accounts. Live items are stored in `data/finance.live.db` (sandbox stays separate).

## Connect accounts

```bash
npm run connect
```

Open the printed `localhost` URL and complete Plaid Link. Access tokens are encrypted in local SQLite.

## Add to Cursor MCP

In Cursor MCP settings, add:

```json
{
  "mcpServers": {
    "finance-agent": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/finance-agent/dist/index.js"],
      "env": {
        "PLAID_CLIENT_ID": "your-client-id",
        "PLAID_SECRET": "your-secret",
        "PLAID_ENV": "sandbox",
        "ENCRYPTION_KEY": "your-long-random-string",
        "DATABASE_PATH": "/ABSOLUTE/PATH/TO/finance-agent/data/finance.live.db"
      }
    }
  }
}
```

Or point `command` at `npx`/`tsx` and `args` at `src/index.ts` during development.

## Agent tools

| Tool | Purpose |
|---|---|
| `list_connections` | Linked institutions/accounts |
| `get_balances` | Live balances |
| `get_transactions` | Transactions by date range |
| `summarize_cashflow` | Inflow/outflow + categories for planning |
| `list_goals` / `upsert_goal` | Persistent goals |
| `list_plan_notes` / `add_plan_note` | Month-to-month planning memory |
| `add_category_rule` | Merchant → category rules |
| `setup_help` | Setup reminders |

Tax portals are not available via Plaid — store estimates and due dates as goals/notes.
