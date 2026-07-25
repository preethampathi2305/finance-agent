import { INSTITUTION_NAMES, runPlaid } from "../plaid-cli.js";
import { categorizeName } from "../store/planning.js";

type Tx = {
  amount?: number;
  pending?: boolean;
  name?: string;
  merchant_name?: string | null;
  category?: unknown;
  date?: string;
  account_id?: string;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function extractTransactions(payload: unknown): Tx[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as { items?: unknown };
  const items = asArray<{ transactions?: unknown }>(root.items);
  const txs: Tx[] = [];
  for (const item of items) {
    txs.push(...asArray<Tx>(item.transactions));
  }
  if (txs.length) return txs;

  // Single-item shape
  const single = payload as { transactions?: unknown };
  return asArray<Tx>(single.transactions);
}

function categoryFor(tx: Tx): string {
  const fromRule = categorizeName(tx.merchant_name ?? tx.name ?? "");
  if (fromRule) return fromRule;
  if (Array.isArray(tx.category) && tx.category.length) {
    return String(tx.category[0]);
  }
  if (typeof tx.category === "string") return tx.category;
  return "UNCATEGORIZED";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function summarizeCashflow(input: {
  startDate: string;
  endDate: string;
}) {
  const [txResult, balanceResult] = await Promise.all([
    runPlaid([
      "transactions",
      "list",
      "--all",
      "--start-date",
      input.startDate,
      "--end-date",
      input.endDate,
      "--count",
      "250",
    ]),
    runPlaid(["balance", "--all"]),
  ]);

  if (!txResult.ok) {
    throw new Error(txResult.stderr || "Failed to fetch transactions via Plaid CLI");
  }
  if (!balanceResult.ok) {
    throw new Error(balanceResult.stderr || "Failed to fetch balances via Plaid CLI");
  }

  const transactions = extractTransactions(txResult.data);
  let inflow = 0;
  let outflow = 0;
  const byCategory: Record<string, number> = {};

  for (const tx of transactions) {
    if (tx.pending) continue;
    const amount = Number(tx.amount ?? 0);
    if (amount < 0) {
      inflow += Math.abs(amount);
    } else {
      outflow += amount;
      const cat = categoryFor(tx);
      byCategory[cat] = (byCategory[cat] ?? 0) + amount;
    }
  }

  type BalanceAccount = {
    name?: string;
    type?: string;
    available?: number | null;
    current?: number | null;
    balances?: {
      available?: number | null;
      current?: number | null;
      limit?: number | null;
    };
    limit?: number | null;
  };
  type BalanceItem = {
    item?: { institution_id?: string };
    accounts?: BalanceAccount[];
  };

  const balanceRoot = balanceResult.data as { items?: BalanceItem[] };
  const liquid: unknown[] = [];
  const credit: unknown[] = [];
  for (const item of asArray<BalanceItem>(balanceRoot.items)) {
    const institutionId = item.item?.institution_id ?? "";
    const institution =
      INSTITUTION_NAMES[institutionId] ?? (institutionId || "unknown");
    for (const account of asArray<BalanceAccount>(item.accounts)) {
      const bal = account.balances ?? account;
      const current = bal.current ?? account.current ?? null;
      const available = bal.available ?? account.available ?? null;
      const limit = bal.limit ?? account.limit ?? null;
      if (account.type === "credit") {
        credit.push({
          name: account.name,
          institution,
          current_balance: current,
          available,
          limit,
        });
      } else if (account.type === "depository") {
        liquid.push({
          name: account.name,
          institution,
          available,
          current,
        });
      }
    }
  }

  return {
    period: { start: input.startDate, end: input.endDate },
    inflow: round2(inflow),
    outflow: round2(outflow),
    net: round2(inflow - outflow),
    category_breakdown: Object.entries(byCategory)
      .map(([category, amount]) => ({ category, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount),
    liquid_accounts: liquid,
    credit_accounts: credit,
    transaction_count: transactions.filter((t) => !t.pending).length,
    source: "plaid-cli",
  };
}
