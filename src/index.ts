import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "./db/index.js";
import {
  getLiveBalances,
  getTransactions,
  summarizeCashflow,
  syncAccountMetadata,
} from "./finance/plaid-data.js";
import { listItems, listStoredAccounts } from "./store/items.js";
import {
  addCategoryRule,
  addPlanNote,
  listCategoryRules,
  listGoals,
  listPlanNotes,
  upsertGoal,
} from "./store/planning.js";

getDb();

const server = new McpServer({
  name: "finance-agent",
  version: "0.1.0",
});

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

server.tool(
  "list_connections",
  "List connected Plaid institutions/items (banks and cards already linked).",
  {},
  async () => {
    try {
      return json({ items: listItems(), accounts: listStoredAccounts() });
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  "sync_accounts",
  "Refresh stored account metadata from Plaid for all connected items.",
  {},
  async () => {
    try {
      return json(await syncAccountMetadata());
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  "get_balances",
  "Fetch live balances for all connected bank and credit accounts.",
  {},
  async () => {
    try {
      const items = listItems();
      if (!items.length) {
        return json({
          message:
            "No accounts connected yet. Run `npm run connect` and link an institution in the browser.",
          balances: [],
        });
      }
      return json(await getLiveBalances());
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  "get_transactions",
  "Fetch transactions in a date range. Optional filters: account_id, search text, limit.",
  {
    start_date: z
      .string()
      .describe("Start date YYYY-MM-DD"),
    end_date: z.string().describe("End date YYYY-MM-DD"),
    account_id: z.string().optional().describe("Plaid account_id filter"),
    search: z
      .string()
      .optional()
      .describe("Case-insensitive match on name/merchant"),
    limit: z.number().int().min(1).max(500).optional(),
  },
  async ({ start_date, end_date, account_id, search, limit }) => {
    try {
      return json(
        await getTransactions({
          startDate: start_date,
          endDate: end_date,
          accountId: account_id,
          search,
          limit,
        }),
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  "summarize_cashflow",
  "Summarize inflow/outflow, category spend, and account balances for a period. Use for monthly planning.",
  {
    start_date: z.string().describe("Start date YYYY-MM-DD"),
    end_date: z.string().describe("End date YYYY-MM-DD"),
  },
  async ({ start_date, end_date }) => {
    try {
      return json(
        await summarizeCashflow({
          startDate: start_date,
          endDate: end_date,
        }),
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  "list_goals",
  "List saved financial goals the agent should remember across chats.",
  {
    status: z
      .string()
      .optional()
      .describe("Optional filter, e.g. active or done"),
  },
  async ({ status }) => {
    try {
      return json(listGoals(status));
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  "upsert_goal",
  "Create or update a financial goal (debt payoff, savings target, etc.).",
  {
    id: z.number().int().optional().describe("Existing goal id to update"),
    title: z.string(),
    target_amount: z.number().optional().nullable(),
    current_amount: z.number().optional().nullable(),
    due_date: z.string().optional().nullable().describe("YYYY-MM-DD"),
    notes: z.string().optional().nullable(),
    status: z.string().optional().describe("active | done | paused"),
  },
  async (args) => {
    try {
      return json(upsertGoal(args));
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  "list_plan_notes",
  "List monthly planning notes saved from prior conversations.",
  {
    month: z
      .string()
      .optional()
      .describe("YYYY-MM; omit for recent notes across months"),
  },
  async ({ month }) => {
    try {
      return json(listPlanNotes(month));
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  "add_plan_note",
  "Save a planning note for a month so future chats keep context (e.g. 'keep dining under $400').",
  {
    month: z.string().describe("YYYY-MM"),
    content: z.string(),
  },
  async ({ month, content }) => {
    try {
      return json(addPlanNote(month, content));
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  "list_category_rules",
  "List merchant substring → category rules used to improve transaction labeling.",
  {},
  async () => {
    try {
      return json(listCategoryRules());
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  "add_category_rule",
  "Add a categorization rule: if merchant/name contains match_text, assign category.",
  {
    match_text: z.string().describe("Case-insensitive substring"),
    category: z.string(),
  },
  async ({ match_text, category }) => {
    try {
      return json(addCategoryRule(match_text, category));
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  "setup_help",
  "Explain how to connect Plaid accounts and use this finance agent.",
  {},
  async () =>
    json({
      steps: [
        "Copy .env.example to .env and fill PLAID_CLIENT_ID, PLAID_SECRET, ENCRYPTION_KEY.",
        "Use PLAID_ENV=sandbox first; switch to development for real US banks after Plaid approval.",
        "Run `npm run connect` and open the printed localhost URL to link accounts via Plaid Link.",
        "Add this MCP server in Cursor (see README). Then ask things like balances, cashflow, or monthly plans.",
        "Tax portals usually need CSV/manual notes — store estimates with add_plan_note / upsert_goal.",
      ],
      example_prompts: [
        "What are my balances right now?",
        "Summarize cashflow for 2026-07-01 to 2026-07-25 and suggest a plan for the rest of the month.",
        "Save a note for 2026-07: keep dining under $400 and put $800 toward the card.",
        "Create a goal to pay the Chase card down to $0 by December.",
      ],
    }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
