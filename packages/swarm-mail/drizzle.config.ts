import type { Config } from "drizzle-kit";

/**
 * Drizzle Kit configuration for libSQL migrations.
 * 
 * This config is used by drizzle-kit to generate and apply migrations:
 * - `bunx drizzle-kit generate` - Generate migration files from schema
 * - `bunx drizzle-kit migrate` - Apply migrations to database
 * - `bunx drizzle-kit push` - Push schema changes without migrations
 * - `bunx drizzle-kit studio` - Launch Drizzle Studio GUI
 */
export default {
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "sqlite",
  driver: "turso",
} satisfies Config;
