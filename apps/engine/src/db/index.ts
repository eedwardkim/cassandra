import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { config } from "../config.js";
import * as schema from "./schema.js";

export const sqlite = new Database(config.dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 5000");
export const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
export { schema };
