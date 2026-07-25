import { CountryCode } from "plaid";
import { encrypt, decrypt } from "../crypto.js";
import {
  getDb,
  type AccountRow,
  type PlaidItemRow,
} from "../db/index.js";
import { getPlaidClient } from "../plaid/client.js";

export function listItems(): Array<Omit<PlaidItemRow, "access_token_enc">> {
  return getDb()
    .prepare(
      `SELECT item_id, institution_id, institution_name, created_at, updated_at
       FROM plaid_items ORDER BY created_at`,
    )
    .all() as Array<Omit<PlaidItemRow, "access_token_enc"> & {
      created_at: string;
      updated_at: string;
    }>;
}

export function getAccessToken(itemId: string): string {
  const row = getDb()
    .prepare(`SELECT access_token_enc FROM plaid_items WHERE item_id = ?`)
    .get(itemId) as { access_token_enc: string } | undefined;
  if (!row) throw new Error(`Unknown Plaid item: ${itemId}`);
  return decrypt(row.access_token_enc);
}

export function listStoredAccounts(): AccountRow[] {
  return getDb()
    .prepare(
      `SELECT account_id, item_id, name, official_name, mask, type, subtype, currency
       FROM accounts ORDER BY name`,
    )
    .all() as AccountRow[];
}

export async function saveItemFromPublicToken(publicToken: string): Promise<{
  itemId: string;
  institutionName: string | null;
  accounts: AccountRow[];
}> {
  const plaid = getPlaidClient();
  const exchange = await plaid.itemPublicTokenExchange({
    public_token: publicToken,
  });
  const accessToken = exchange.data.access_token;
  const itemId = exchange.data.item_id;

  const itemResp = await plaid.itemGet({ access_token: accessToken });
  const institutionId = itemResp.data.item.institution_id ?? null;
  let institutionName: string | null = null;
  if (institutionId) {
    const inst = await plaid.institutionsGetById({
      institution_id: institutionId,
      country_codes: [CountryCode.Us],
    });
    institutionName = inst.data.institution.name;
  }

  const accountsResp = await plaid.accountsGet({ access_token: accessToken });
  const db = getDb();
  const upsertItem = db.prepare(`
    INSERT INTO plaid_items (item_id, access_token_enc, institution_id, institution_name)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET
      access_token_enc = excluded.access_token_enc,
      institution_id = excluded.institution_id,
      institution_name = excluded.institution_name,
      updated_at = datetime('now')
  `);
  const upsertAccount = db.prepare(`
    INSERT INTO accounts (
      account_id, item_id, name, official_name, mask, type, subtype, currency
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET
      name = excluded.name,
      official_name = excluded.official_name,
      mask = excluded.mask,
      type = excluded.type,
      subtype = excluded.subtype,
      currency = excluded.currency,
      updated_at = datetime('now')
  `);

  db.exec("BEGIN");
  try {
    upsertItem.run(
      itemId,
      encrypt(accessToken),
      institutionId,
      institutionName,
    );
    for (const account of accountsResp.data.accounts) {
      upsertAccount.run(
        account.account_id,
        itemId,
        account.name,
        account.official_name ?? null,
        account.mask ?? null,
        account.type,
        account.subtype ?? null,
        account.balances.iso_currency_code ?? "USD",
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    itemId,
    institutionName,
    accounts: listStoredAccounts().filter((a) => a.item_id === itemId),
  };
}

export async function refreshAccountsForItem(itemId: string): Promise<AccountRow[]> {
  const accessToken = getAccessToken(itemId);
  const plaid = getPlaidClient();
  const accountsResp = await plaid.accountsGet({ access_token: accessToken });
  const db = getDb();
  const upsertAccount = db.prepare(`
    INSERT INTO accounts (
      account_id, item_id, name, official_name, mask, type, subtype, currency
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET
      name = excluded.name,
      official_name = excluded.official_name,
      mask = excluded.mask,
      type = excluded.type,
      subtype = excluded.subtype,
      currency = excluded.currency,
      updated_at = datetime('now')
  `);

  db.exec("BEGIN");
  try {
    for (const account of accountsResp.data.accounts) {
      upsertAccount.run(
        account.account_id,
        itemId,
        account.name,
        account.official_name ?? null,
        account.mask ?? null,
        account.type,
        account.subtype ?? null,
        account.balances.iso_currency_code ?? "USD",
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return listStoredAccounts().filter((a) => a.item_id === itemId);
}
