import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DB_PATH =
  process.env.DATABASE_URL ||
  path.join(process.cwd(), "data", "app.db");

// Ensure data/ directory exists before creating the DB file
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");

const db = drizzle(sqlite);

console.log("Running migrations...");
migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
console.log("Migrations complete.");

sqlite.close();
