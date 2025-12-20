/**
 * Drizzle schema for memory subsystem (libSQL).
 *
 * Translates PGlite/pgvector memory schema to libSQL with F32_BLOB vectors.
 *
 * ## Key Differences from PGlite
 * - F32_BLOB(1024) instead of vector(1024)
 * - TEXT columns for JSON (metadata, tags)
 * - TEXT columns for timestamps (ISO 8601 strings)
 * - No separate embeddings table (embedding column inline)
 *
 * @module db/schema/memory
 */

import { customType, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Custom F32_BLOB vector type for libSQL.
 *
 * Handles conversion between JavaScript arrays and libSQL's native vector format.
 * Uses Buffer for efficient storage of Float32 arrays.
 *
 * @param dimension - Vector dimension (e.g., 1024 for mxbai-embed-large)
 */
const vector = (dimension: number) =>
  customType<{ data: number[]; driverData: Buffer }>({
    dataType() {
      return `F32_BLOB(${dimension})`;
    },
    toDriver(value: number[]): Buffer {
      return Buffer.from(new Float32Array(value).buffer);
    },
    fromDriver(value: Buffer): number[] {
      return Array.from(new Float32Array(value.buffer));
    },
  });

/**
 * Memories table schema.
 *
 * Stores semantic memory records with vector embeddings for similarity search.
 *
 * Schema matches libsql-schema.ts structure:
 * - id: Unique identifier (TEXT PRIMARY KEY)
 * - content: Memory content (TEXT NOT NULL)
 * - metadata: JSON metadata as TEXT (default '{}')
 * - collection: Memory collection/namespace (default 'default')
 * - tags: JSON array as TEXT (default '[]')
 * - created_at: ISO timestamp (default current datetime)
 * - updated_at: ISO timestamp (default current datetime)
 * - decay_factor: Confidence decay multiplier (default 1.0)
 * - embedding: F32_BLOB(1024) vector for semantic search
 */
export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(),
  content: text("content").notNull(),
  metadata: text("metadata").default("'{}'"),
  collection: text("collection").default("'default'"),
  tags: text("tags").default("'[]'"),
  created_at: text("created_at").default("(datetime('now'))"),
  updated_at: text("updated_at").default("(datetime('now'))"),
  decay_factor: real("decay_factor").default(1.0),
  embedding: vector(1024)("embedding"),
});

/**
 * TypeScript type for Memory record (inferred from schema).
 */
export type Memory = typeof memories.$inferSelect;

/**
 * TypeScript type for inserting Memory (inferred from schema).
 */
export type NewMemory = typeof memories.$inferInsert;
