/**
 * MemoryAdapter Integration Test
 *
 * Smoke test to verify the adapter works with real PGlite + mocked Ollama.
 * Tests the happy path: store → find → get → validate → remove
 */

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryAdapter } from "./adapter.js";
import type { DatabaseAdapter } from "../types/database.js";

function wrapPGlite(pglite: PGlite): DatabaseAdapter {
  return {
    query: <T>(sql: string, params?: unknown[]) => pglite.query<T>(sql, params),
    exec: async (sql: string) => {
      await pglite.exec(sql);
    },
    close: () => pglite.close(),
  };
}

function makeTempDbPath(): string {
  const testId = randomBytes(8).toString("hex");
  const dbDir = join(tmpdir(), `test-integration-${testId}`);
  mkdirSync(dbDir, { recursive: true });
  return dbDir;
}

function mockEmbedding(seed = 0): number[] {
  const embedding: number[] = [];
  for (let i = 0; i < 1024; i++) {
    embedding.push(Math.sin(seed + i * 0.1) * 0.5 + 0.5);
  }
  return embedding;
}

describe("MemoryAdapter - Integration Smoke Test", () => {
  let pglite: PGlite;
  let db: DatabaseAdapter;
  let dbPath: string;
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;
    dbPath = makeTempDbPath();
    pglite = await PGlite.create({
      dataDir: dbPath,
      extensions: { vector },
    });
    db = wrapPGlite(pglite);

    // Initialize full schema
    await db.exec("CREATE EXTENSION IF NOT EXISTS vector;");
    await db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        collection TEXT DEFAULT 'default',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        confidence REAL DEFAULT 0.7
      )
    `);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS memory_embeddings (
        memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
        embedding vector(1024) NOT NULL
      )
    `);
    await db.exec(`
      CREATE INDEX IF NOT EXISTS memory_embeddings_hnsw_idx 
      ON memory_embeddings 
      USING hnsw (embedding vector_cosine_ops)
    `);
    await db.exec(`
      CREATE INDEX IF NOT EXISTS memories_content_idx 
      ON memories 
      USING gin (to_tsvector('english', content))
    `);
    await db.exec(
      `CREATE INDEX IF NOT EXISTS idx_memories_collection ON memories(collection)`
    );

    // Mock Ollama responses
    const mockFetch = mock((url: string, options?: RequestInit) => {
      if (url.includes("/api/embeddings")) {
        const body = JSON.parse((options?.body as string) || "{}");
        const prompt = body.prompt || "";
        const seed = prompt.includes("OAuth") ? 1 : 
                     prompt.includes("token") ? 1.1 : 
                     prompt.includes("refresh") ? 1.05 : 2;
        return Promise.resolve({
          ok: true,
          json: async () => ({ embedding: mockEmbedding(seed) }),
        } as Response);
      }
      // Health check
      return Promise.resolve({
        ok: true,
        json: async () => ({ models: [{ name: "mxbai-embed-large" }] }),
      } as Response);
    });
    global.fetch = mockFetch as typeof fetch;
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await pglite.close();
    rmSync(dbPath, { recursive: true, force: true });
  });

  test("full lifecycle: store → find → get → validate → remove", async () => {
    const config = {
      ollamaHost: "http://localhost:11434",
      ollamaModel: "mxbai-embed-large",
    };
    const adapter = createMemoryAdapter(db, config);

    // Health check
    const health = await adapter.checkHealth();
    expect(health.ollama).toBe(true);
    expect(health.model).toBe("mxbai-embed-large");

    // Store memories
    const mem1 = await adapter.store("OAuth tokens need 5min refresh buffer", {
      tags: "auth,oauth,tokens",
      metadata: JSON.stringify({ priority: "high" }),
      collection: "auth-patterns",
    });
    expect(mem1.id).toBeDefined();

    const mem2 = await adapter.store("Token refresh race conditions", {
      tags: "auth,tokens",
      collection: "auth-patterns",
    });
    expect(mem2.id).toBeDefined();

    // Find by semantic similarity
    const searchResults = await adapter.find("token refresh strategies");
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0].memory.content).toContain("refresh");

    // Get specific memory
    const retrieved = await adapter.get(mem1.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.content).toContain("OAuth");
    expect(retrieved?.metadata.tags).toEqual(["auth", "oauth", "tokens"]);
    expect(retrieved?.collection).toBe("auth-patterns");

    // List memories
    const allMemories = await adapter.list();
    expect(allMemories.length).toBe(2);

    const authMemories = await adapter.list({ collection: "auth-patterns" });
    expect(authMemories.length).toBe(2);

    // Stats
    const stats = await adapter.stats();
    expect(stats.memories).toBe(2);
    expect(stats.embeddings).toBe(2);

    // Validate (reset decay)
    await adapter.validate(mem1.id);
    const validated = await adapter.get(mem1.id);
    expect(validated).not.toBeNull();

    // Remove
    await adapter.remove(mem1.id);
    const removed = await adapter.get(mem1.id);
    expect(removed).toBeNull();

    // Final stats
    const finalStats = await adapter.stats();
    expect(finalStats.memories).toBe(1);
    expect(finalStats.embeddings).toBe(1);
  });

  test("FTS fallback works when Ollama unavailable", async () => {
    // First store with Ollama available
    const config = {
      ollamaHost: "http://localhost:11434",
      ollamaModel: "mxbai-embed-large",
    };
    const adapter = createMemoryAdapter(db, config);

    await adapter.store("TypeScript type safety", { collection: "tech" });
    await adapter.store("JavaScript dynamic typing", { collection: "tech" });

    // Now break Ollama
    const mockBrokenFetch = mock(() =>
      Promise.reject(new Error("ECONNREFUSED"))
    );
    global.fetch = mockBrokenFetch as typeof fetch;

    // FTS should still work
    const results = await adapter.find("TypeScript", { fts: true });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchType).toBe("fts");
    expect(results[0].memory.content).toContain("TypeScript");
  });
});
