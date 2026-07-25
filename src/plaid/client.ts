import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { config } from "../config.js";

let client: PlaidApi | null = null;

export function getPlaidClient(): PlaidApi {
  if (client) return client;

  const configuration = new Configuration({
    basePath: PlaidEnvironments[config.plaidEnv()],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": config.plaidClientId(),
        "PLAID-SECRET": config.plaidSecret(),
      },
    },
  });

  client = new PlaidApi(configuration);
  return client;
}
