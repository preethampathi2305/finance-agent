import { Products, CountryCode } from "plaid";
import { config } from "../config.js";
import { getPlaidClient } from "../plaid/client.js";
import {
  getAccessToken,
  listItems,
  listStoredAccounts,
  refreshAccountsForItem,
} from "../store/items.js";
import { categorizeName } from "../store/planning.js";

export async function createLinkToken(): Promise<string> {
  const plaid = getPlaidClient();
  const redirectUri = config.plaidRedirectUri();
  const response = await plaid.linkTokenCreate({
    user: { client_user_id: "finance-agent-local" },
    client_name: "Finance Agent",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
    ...(redirectUri ? { redirect_uri: redirectUri } : {}),
  });
  return response.data.link_token;
}

export async function getLiveBalances() {
  const items = listItems();
  const plaid = getPlaidClient();
  const results = [];

  for (const item of items) {
    const accessToken = getAccessToken(item.item_id);
    const resp = await plaid.accountsBalanceGet({ access_token: accessToken });
    results.push({
      item_id: item.item_id,
      institution_name: item.institution_name,
      accounts: resp.data.accounts.map((account) => ({
        account_id: account.account_id,
        name: account.name,
        official_name: account.official_name,
        mask: account.mask,
        type: account.type,
        subtype: account.subtype,
        current: account.balances.current,
        available: account.balances.available,
        limit: account.balances.limit,
        currency: account.balances.iso_currency_code ?? "USD",
      })),
    });
  }

  return results;
}

export async function getTransactions(input: {
  startDate: string;
  endDate: string;
  accountId?: string;
  search?: string;
  limit?: number;
}) {
  const items = listItems();
  const plaid = getPlaidClient();
  const all = [];

  for (const item of items) {
    const accessToken = getAccessToken(item.item_id);
    const resp = await plaid.transactionsGet({
      access_token: accessToken,
      start_date: input.startDate,
      end_date: input.endDate,
      options: {
        account_ids: input.accountId ? [input.accountId] : undefined,
        count: Math.min(input.limit ?? 100, 500),
        offset: 0,
      },
    });

    for (const tx of resp.data.transactions) {
      if (
        input.search &&
        !`${tx.name} ${tx.merchant_name ?? ""}`
          .toLowerCase()
          .includes(input.search.toLowerCase())
      ) {
        continue;
      }
      all.push({
        transaction_id: tx.transaction_id,
        account_id: tx.account_id,
        institution_name: item.institution_name,
        date: tx.date,
        name: tx.name,
        merchant_name: tx.merchant_name,
        amount: tx.amount,
        // Plaid: positive = money out for depository
        category:
          categorizeName(tx.merchant_name ?? tx.name) ??
          tx.personal_finance_category?.primary ??
          tx.category?.[0] ??
          null,
        pending: tx.pending,
        currency: tx.iso_currency_code ?? "USD",
      });
    }
  }

  all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return all.slice(0, input.limit ?? 100);
}

export async function summarizeCashflow(input: {
  startDate: string;
  endDate: string;
}) {
  const transactions = await getTransactions({
    ...input,
    limit: 500,
  });
  const balances = await getLiveBalances();

  let inflow = 0;
  let outflow = 0;
  const byCategory: Record<string, number> = {};

  for (const tx of transactions) {
    if (tx.pending) continue;
    if (tx.amount < 0) {
      inflow += Math.abs(tx.amount);
    } else {
      outflow += tx.amount;
      const cat = tx.category ?? "UNCATEGORIZED";
      byCategory[cat] = (byCategory[cat] ?? 0) + tx.amount;
    }
  }

  const categoryBreakdown = Object.entries(byCategory)
    .map(([category, amount]) => ({ category, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount);

  const liquid = balances.flatMap((item) =>
    item.accounts
      .filter((a) => a.type === "depository")
      .map((a) => ({
        name: a.name,
        institution: item.institution_name,
        available: a.available ?? a.current,
        current: a.current,
      })),
  );

  const credit = balances.flatMap((item) =>
    item.accounts
      .filter((a) => a.type === "credit")
      .map((a) => ({
        name: a.name,
        institution: item.institution_name,
        current_balance: a.current,
        limit: a.limit,
        available: a.available,
      })),
  );

  return {
    period: { start: input.startDate, end: input.endDate },
    inflow: round2(inflow),
    outflow: round2(outflow),
    net: round2(inflow - outflow),
    category_breakdown: categoryBreakdown,
    liquid_accounts: liquid,
    credit_accounts: credit,
    transaction_count: transactions.filter((t) => !t.pending).length,
  };
}

export async function syncAccountMetadata() {
  const items = listItems();
  const synced = [];
  for (const item of items) {
    const accounts = await refreshAccountsForItem(item.item_id);
    synced.push({
      item_id: item.item_id,
      institution_name: item.institution_name,
      accounts,
    });
  }
  return synced.length ? synced : listStoredAccounts();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
