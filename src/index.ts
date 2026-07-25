import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "./db/index.js";
import { summarizeCashflow } from "./finance/cashflow.js";
import { INSTITUTION_NAMES, runPlaid } from "./plaid-cli.js";
import {
  addCategoryRule,
  addPlanNote,
  listAccountNicknames,
  listCategoryRules,
  listGoals,
  listPlanNotes,
  upsertAccountNickname,
  upsertGoal,
} from "./store/planning.js";

getDb();

const server = new McpServer({
  name: "finance-agent",
  version: "0.2.0",
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

function enrichInstitutions(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const root = data as { items?: Array<{ item?: { institution_id?: string }; institution_id?: string }> };
  if (!Array.isArray(root.items)) return data;
  return {
    ...root,
    items: root.items.map((entry) => {
      const institutionId =
        entry.item?.institution_id ?? entry.institution_id ?? "";
      return {
        ...entry,
        institution_name:
          INSTITUTION_NAMES[institutionId] ?? (institutionId || null),
      };
    }),
  };
}

async function cliOrError(args: string[]) {
  const result = await runPlaid(args);
  if (!result.ok) {
    return errorResult(result.stderr || "Plaid CLI command failed");
  }
  return json(enrichInstitutions(result.data));
}

// ── Bank data via Plaid CLI ───────────────────────────────────────────────

server.tool(
  "list_linked_items",
  "List Plaid Items linked via the Plaid CLI (Trial/Production). Prefer this over any local connect DB.",
  {},
  async () => cliOrError(["item", "list"]),
);

server.tool(
  "get_balances",
  "Fetch live balances for all linked Items using `plaid balance --all`.",
  {},
  async () => cliOrError(["balance", "--all"]),
);

server.tool(
  "get_transactions",
  "Fetch transactions via Plaid CLI for a date range across all linked Items.",
  {
    start_date: z.string().describe("YYYY-MM-DD"),
    end_date: z.string().describe("YYYY-MM-DD"),
    count: z.number().int().min(1).max(250).optional(),
    item_id: z
      .string()
      .optional()
      .describe("Optional Item id; default is --all"),
  },
  async ({ start_date, end_date, count, item_id }) => {
    const args = [
      "transactions",
      "list",
      "--start-date",
      start_date,
      "--end-date",
      end_date,
      "--count",
      String(count ?? 100),
    ];
    if (item_id) args.push("--item", item_id);
    else args.push("--all");
    return cliOrError(args);
  },
);

server.tool(
  "get_liabilities",
  "Fetch credit/loan liability details via `plaid liabilities --all`.",
  {},
  async () => cliOrError(["liabilities", "--all"]),
);

server.tool(
  "get_investments",
  "Fetch investment holdings via `plaid investments holdings --all`.",
  {},
  async () => cliOrError(["investments", "holdings", "--all"]),
);

server.tool(
  "summarize_cashflow",
  "Summarize inflow/outflow and category spend for a period using Plaid CLI data + local category rules. Use for monthly planning.",
  {
    start_date: z.string().describe("YYYY-MM-DD"),
    end_date: z.string().describe("YYYY-MM-DD"),
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

// ── Local planning memory ─────────────────────────────────────────────────

server.tool(
  "list_goals",
  "List saved financial goals the agent should remember across chats.",
  {
    status: z.string().optional().describe("Optional filter, e.g. active"),
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
    id: z.number().int().optional(),
    title: z.string(),
    target_amount: z.number().optional().nullable(),
    current_amount: z.number().optional().nullable(),
    due_date: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    status: z.string().optional(),
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
    month: z.string().optional().describe("YYYY-MM"),
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
  "Save a planning note for a month so future chats keep context.",
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
  "List merchant substring → category rules used when summarizing cashflow.",
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
    match_text: z.string(),
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
  "list_account_nicknames",
  "List human-friendly nicknames for Plaid account_ids.",
  {},
  async () => {
    try {
      return json(listAccountNicknames());
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  "upsert_account_nickname",
  "Save a nickname for an account_id (e.g. 'Chase checking', 'Amex BCE').",
  {
    account_id: z.string(),
    nickname: z.string(),
    institution_hint: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  },
  async (args) => {
    try {
      return json(upsertAccountNickname(args));
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  "setup_help",
  "Explain how banking (Plaid CLI) and planning memory (this MCP) work together.",
  {},
  async () =>
    json({
      architecture: {
        bank_data: "Plaid CLI (link, balances, transactions, investments, liabilities)",
        planning_memory:
          "This MCP + local SQLite (goals, monthly notes, category rules, nicknames)",
      },
      link_accounts: [
        "plaid login",
        "plaid link --products transactions,liabilities,investments",
        "Trial plan: up to 10 Items",
      ],
      agent_bank_tools: [
        "list_linked_items",
        "get_balances",
        "get_transactions",
        "get_liabilities",
        "get_investments",
        "summarize_cashflow",
      ],
      agent_planning_tools: [
        "list_goals / upsert_goal",
        "list_plan_notes / add_plan_note",
        "add_category_rule",
        "upsert_account_nickname",
      ],
      example_prompts: [
        "What are my balances and card utilization right now?",
        "Summarize cashflow for this month and suggest a plan for the rest of July.",
        "Save a note for 2026-07: keep dining under $400 and put $800 toward Amex.",
        "Create a goal to pay the Chase card under $200 by September.",
      ],
    }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
