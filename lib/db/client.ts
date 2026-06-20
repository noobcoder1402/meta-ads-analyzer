import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "node:path";
import * as schema from "./schema";

// The SQLite file lives in data/app.db — gitignored, one per install.
const DB_PATH =
  process.env.DATABASE_URL ||
  path.join(process.cwd(), "data", "app.db");

// better-sqlite3 is synchronous and single-threaded — no connection pool needed.
const sqlite = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
