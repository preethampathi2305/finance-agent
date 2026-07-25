# finance-agent

Conversational personal finance for Cursor:

- **Bank data** → [Plaid CLI](https://plaid.com/docs/resources/cli/) (`plaid link`, balances, transactions, …)
- **Planning memory** → this MCP + local SQLite (goals, monthly notes, category rules, nicknames)

No dashboard. Link accounts with the CLI, then plan in chat.

Requires Node.js 22+ and the Plaid CLI (`brew install plaid/plaid-cli/plaid`).

## Setup

```bash
# Plaid Trial / Production (one-time)
plaid login
plaid link --products transactions,liabilities,investments

# This MCP
cp .env.example .env
npm install
npm run build
```

Trial plans support up to 10 linked Items.

## Add to Cursor MCP

```json
{
  "mcpServers": {
    "finance-agent": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/finance-agent/dist/index.js"],
      "env": {
        "DATABASE_PATH": "/ABSOLUTE/PATH/TO/finance-agent/data/planning.db"
      }
    }
  }
}
```

The MCP shells out to `plaid … -j`, so the CLI must be on `PATH` for the Cursor process.

## Tools

| Tool | Source | Purpose |
|---|---|---|
| `list_linked_items` | CLI | Linked institutions |
| `get_balances` | CLI | Live balances |
| `get_transactions` | CLI | Transactions by date |
| `get_liabilities` | CLI | Cards/loans detail |
| `get_investments` | CLI | Holdings |
| `summarize_cashflow` | CLI + local rules | Monthly planning summary |
| `list_goals` / `upsert_goal` | SQLite | Persistent goals |
| `list_plan_notes` / `add_plan_note` | SQLite | Month-to-month notes |
| `add_category_rule` | SQLite | Merchant → category |
| `upsert_account_nickname` | SQLite | Friendly account names |

## Link more accounts

```bash
plaid link --products transactions,liabilities,investments
plaid item list
```
