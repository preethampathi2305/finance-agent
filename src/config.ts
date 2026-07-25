import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export type PlaidEnv = "sandbox" | "development" | "production";

export const config = {
  plaidClientId: () => required("PLAID_CLIENT_ID"),
  plaidSecret: () => required("PLAID_SECRET"),
  plaidEnv: (): PlaidEnv =>
    (process.env.PLAID_ENV ?? "sandbox") as PlaidEnv,
  /** Required for many real banks (Chase, Amex, etc.). Must match a dashboard allowlisted URI. */
  plaidRedirectUri: (): string | undefined => {
    const value = process.env.PLAID_REDIRECT_URI?.trim();
    return value || undefined;
  },
  encryptionKey: () => required("ENCRYPTION_KEY"),
  databasePath: () => {
    if (process.env.DATABASE_PATH) {
      return path.resolve(process.env.DATABASE_PATH);
    }
    const env = process.env.PLAID_ENV ?? "sandbox";
    const file =
      env === "sandbox" ? "finance.sandbox.db" : "finance.live.db";
    return path.resolve(`./data/${file}`);
  },
  connectPort: () => Number(process.env.CONNECT_PORT ?? "4545"),
};
