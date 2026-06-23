import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "node:path";
import * as schema from "./schema";

// The SQLite file lives in data/app.db — gitignored, one per install.
const DB_PATH =
  process.env.DATABASE_URL ||
  path.join(process.cwd(), "data", "app.db");

// In demo mode the app runs on a read-only host (Vercel) with the database bundled
// alongside it, so we MUST open it read-only — WAL mode would try to create helper
// files next to the database and crash on the read-only filesystem.
const isDemo = process.env.DEMO_MODE === "true";

// better-sqlite3 is synchronous and single-threaded — no connection pool needed.
const sqlite = isDemo
  ? new Database(DB_PATH, { readonly: true, fileMustExist: true })
  : new Database(DB_PATH);

if (isDemo) {
  // No writes will happen; keep SQLite from attempting any journal/temp files.
  sqlite.pragma("query_only = true");
} else {
  // Enable WAL mode for better concurrent read performance (local dev/use only).
  sqlite.pragma("journal_mode = WAL");
}

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
