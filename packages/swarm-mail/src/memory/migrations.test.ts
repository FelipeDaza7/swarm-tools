/**
 * Memory Schema Migration Tests
 *
 * Tests the semantic memory schema migrations (tables, indexes, pgvector).
 * Uses isolated temp databases per test following the PGlite + pgvector pattern.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { runMigrations } from "../streams/migrations";
import { memoryMigrations } from "./migrations";

/**
 * Create a unique temp database path for test isolation
 */
function makeTempDbPath(): string {
  return join(tmpdir(), `test-memory-migrations-${randomUUID()}`);
}

describe("Memory Migrations", () => {
  let db: PGlite;
  let dbPath: string;

  beforeAll(async () => {
    dbPath = makeTempDbPath();
    db = new PGlite(dbPath, {
      extensions: { vector },
    });

    // Run all migrations (including memory migrations)
    await runMigrations(db);
  });

  afterAll(async () => {
    await db.close();
    // PGlite stores data in a directory, not a file
    const dbDir = dbPath.replace(".db", "");
    rmSync(dbDir, { recursive: true, force: true });
  });

  test("memories table exists with correct schema", async () => {
    const result = await db.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'memories'
      ORDER BY ordinal_position
    `);

    const columns = result.rows.map((r) => ({
      name: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable,
    }));

    expect(columns).toContainEqual({
      name: "id",
      type: "text",
      nullable: "NO",
    });
    expect(columns).toContainEqual({
      name: "content",
      type: "text",
      nullable: "NO",
    });
    expect(columns).toContainEqual({
      name: "metadata",
      type: "jsonb",
      nullable: "YES",
    });
    expect(columns).toContainEqual({
      name: "collection",
      type: "text",
      nullable: "YES",
    });
    expect(columns).toContainEqual({
      name: "created_at",
      type: "timestamp with time zone",
      nullable: "YES",
    });
  });

  test("memory_embeddings table exists with pgvector column", async () => {
    const result = await db.query<{
      column_name: string;
      udt_name: string;
      is_nullable: string;
    }>(`
      SELECT column_name, udt_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'memory_embeddings'
      ORDER BY ordinal_position
    `);

    const columns = result.rows.map((r) => ({
      name: r.column_name,
      type: r.udt_name,
      nullable: r.is_nullable,
    }));

    expect(columns).toContainEqual({
      name: "memory_id",
      type: "text",
      nullable: "NO",
    });
    expect(columns).toContainEqual({
      name: "embedding",
      type: "vector",
      nullable: "NO",
    });
  });

  test("HNSW index exists on memory_embeddings", async () => {
    const result = await db.query<{ indexname: string; indexdef: string }>(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'memory_embeddings'
        AND indexname = 'memory_embeddings_hnsw_idx'
    `);

    expect(result.rows.length).toBe(1);
    const indexDef = result.rows[0].indexdef;
    expect(indexDef).toContain("hnsw");
    expect(indexDef).toContain("vector_cosine_ops");
  });

  test("full-text search index exists on memories", async () => {
    const result = await db.query<{ indexname: string; indexdef: string }>(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'memories'
        AND indexname = 'memories_content_idx'
    `);

    expect(result.rows.length).toBe(1);
    const indexDef = result.rows[0].indexdef;
    expect(indexDef).toContain("gin");
    expect(indexDef).toContain("to_tsvector");
  });

  test("collection index exists on memories", async () => {
    const result = await db.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'memories'
        AND indexname = 'idx_memories_collection'
    `);

    expect(result.rows.length).toBe(1);
  });

  test("can insert and query memory data", async () => {
    const memoryId = `mem_${randomUUID()}`;

    // Insert memory
    await db.query(
      `INSERT INTO memories (id, content, metadata, collection, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [memoryId, "Test memory content", JSON.stringify({ tag: "test" }), "test-collection"]
    );

    // Insert embedding (1024 dimensions)
    const embedding = new Array(1024).fill(0).map(() => Math.random());
    await db.query(
      `INSERT INTO memory_embeddings (memory_id, embedding)
       VALUES ($1, $2)`,
      [memoryId, JSON.stringify(embedding)]
    );

    // Query back
    const result = await db.query<{
      id: string;
      content: string;
      collection: string;
    }>(
      `SELECT m.id, m.content, m.collection
       FROM memories m
       JOIN memory_embeddings e ON m.id = e.memory_id
       WHERE m.id = $1`,
      [memoryId]
    );

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].content).toBe("Test memory content");
    expect(result.rows[0].collection).toBe("test-collection");
  });

  test("cascade delete removes embeddings when memory is deleted", async () => {
    const memoryId = `mem_${randomUUID()}`;

    // Insert memory and embedding
    await db.query(
      `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
      [memoryId, "Test content", "default"]
    );

    const embedding = new Array(1024).fill(0).map(() => Math.random());
    await db.query(
      `INSERT INTO memory_embeddings (memory_id, embedding) VALUES ($1, $2)`,
      [memoryId, JSON.stringify(embedding)]
    );

    // Delete memory
    await db.query(`DELETE FROM memories WHERE id = $1`, [memoryId]);

    // Check embedding is also deleted
    const result = await db.query(
      `SELECT * FROM memory_embeddings WHERE memory_id = $1`,
      [memoryId]
    );

    expect(result.rows.length).toBe(0);
  });

  test("memory migration version is correct", () => {
    // Memory migrations should start at version 9 (after hive's version 8)
    expect(memoryMigrations[0].version).toBe(9);
    expect(memoryMigrations[0].description).toContain("memory");
  });
});
