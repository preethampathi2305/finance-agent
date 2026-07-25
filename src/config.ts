import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv();

export const config = {
  databasePath: () =>
    path.resolve(process.env.DATABASE_PATH ?? "./data/planning.db"),
};
