import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

try {
  process.loadEnvFile();
} catch {
  // Next.js loads .env itself; this covers non-Next entrypoints.
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://pathways:pathways@localhost:5433/pathways",
  max: 5,
});

export const db = drizzle(pool, { schema });

export type Db = typeof db;