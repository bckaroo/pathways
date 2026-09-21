import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile();
} catch {
  // .env optional when DATABASE_URL comes from the environment
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://pathways:pathways@localhost:5433/pathways",
  },
});