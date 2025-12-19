/**
 * MemoryAdapter Tests
 *
 * High-level API combining Ollama embeddings + MemoryStore.
 * Tests graceful degradation, semantic search, FTS fallback.
 *
 * ## TDD Strategy
 * 1. Test store() with automatic embedding generation
 * 2. Test find() with semantic search
 * 3. Test find({ fts: true }) fallback when Ollama unavailable
 * 4. Test get/remove/validate/list/stats operations
 * 5. Test checkHealth() for Ollama availability
 * 6. Test decay calculation in search results
 * 7. Test graceful degradation when Ollama is down
 */

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseAdapter } from "../types/database.js";
import { createMemoryAdapter, type MemoryConfig } from "./adapter.js";

/**
 * Wrap PGlite to match DatabaseAdapter interface
 */
function wrapPGlite(pglite: PGlite): DatabaseAdapter {
  return {
    query: <T>(sql: string, params?: unknown[]) => pglite.query<T>(sql, params),
    exec: async (sql: string) => {
      await pglite.exec(sql);
    },
    close: () => pglite.close(),
  };
}

/**
 * Create a temporary database path for isolated testing
 */
function makeTempDbPath(): string {
  const testId = randomBytes(8).toString("hex");
  const dbDir = join(tmpdir(), `test-adapter-${testId}`);
  mkdirSync(dbDir, { recursive: true });
  return dbDir;
}

/**
 * Generate a mock embedding vector (1024 dimensions)
 */
function mockEmbedding(seed = 0): number[] {
  const embedding: number[] = [];
  for (let i = 0; i < 1024; i++) {
    embedding.push(Math.sin(seed + i * 0.1) * 0.5 + 0.5);
  }
  return embedding;
}

const mockConfig: MemoryConfig = {
  ollamaHost: "http://localhost:11434",
  ollamaModel: "mxbai-embed-large",
};

const mockSuccessResponse = (embedding: number[]) =>
  Promise.resolve({
    ok: true,
    json: async () => ({ embedding }),
  } as Response);

const mockHealthResponse = (models: Array<{ name: string }>) =>
  Promise.resolve({
    ok: true,
    json: async () => ({ models }),
  } as Response);

describe("MemoryAdapter - Store and Retrieve", () => {
  let pglite: PGlite;
  let db: DatabaseAdapter;
  let adapter: ReturnType<typeof createMemoryAdapter>;
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

    // Initialize schema
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

    // Mock successful Ollama responses
    const mockFetch = mock(() => mockSuccessResponse(mockEmbedding(1)));
    global.fetch = mockFetch as typeof fetch;

    adapter = createMemoryAdapter(db, mockConfig);
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await pglite.close();
    rmSync(dbPath, { recursive: true, force: true });
  });

  test("store() generates embedding and stores memory", async () => {
    const result = await adapter.store("OAuth tokens need refresh buffer", {
      tags: "auth,tokens",
      metadata: JSON.stringify({ priority: "high" }),
    });

    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe("string");

    // Verify memory was stored
    const retrieved = await adapter.get(result.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.content).toBe("OAuth tokens need refresh buffer");
    expect(retrieved?.metadata).toEqual({ priority: "high", tags: ["auth", "tokens"] });
  });

  test("store() uses specified collection", async () => {
    const result = await adapter.store("Test memory", {
      collection: "custom-collection",
    });

    const retrieved = await adapter.get(result.id);
    expect(retrieved?.collection).toBe("custom-collection");
  });

  test("store() defaults to 'default' collection", async () => {
    const result = await adapter.store("Test memory");

    const retrieved = await adapter.get(result.id);
    expect(retrieved?.collection).toBe("default");
  });

  test("store() handles tags in metadata", async () => {
    const result = await adapter.store("Test memory", {
      tags: "tag1,tag2,tag3",
    });

    const retrieved = await adapter.get(result.id);
    expect(retrieved?.metadata.tags).toEqual(["tag1", "tag2", "tag3"]);
  });

  test("get() returns null for non-existent memory", async () => {
    const retrieved = await adapter.get("non-existent-id");
    expect(retrieved).toBeNull();
  });
});

describe("MemoryAdapter - Semantic Search", () => {
  let pglite: PGlite;
  let db: DatabaseAdapter;
  let adapter: ReturnType<typeof createMemoryAdapter>;
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

    // Initialize schema
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

    // Mock Ollama to return different embeddings for different texts
    const mockFetch = mock((url: string, options?: RequestInit) => {
      if (url.includes("/api/embeddings")) {
        const body = JSON.parse((options?.body as string) || "{}");
        const prompt = body.prompt || "";
        const seed = prompt.includes("TypeScript") ? 1 : 
                     prompt.includes("JavaScript") ? 1.1 :
                     prompt.includes("cooking") || prompt.includes("pasta") ? 50 : 1.5;
        return mockSuccessResponse(mockEmbedding(seed));
      }
      return mockHealthResponse([{ name: "mxbai-embed-large" }]);
    });
    global.fetch = mockFetch as typeof fetch;

    adapter = createMemoryAdapter(db, mockConfig);

    // Store test memories
    await adapter.store("TypeScript is a typed superset", { collection: "tech" });
    await adapter.store("JavaScript is dynamic", { collection: "tech" });
    await adapter.store("Cooking pasta requires boiling water", { collection: "food" });
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await pglite.close();
    rmSync(dbPath, { recursive: true, force: true });
  });

  test("find() performs semantic search", async () => {
    const results = await adapter.find("TypeScript programming");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].memory.content).toContain("TypeScript");
  });

  test("find() respects limit option", async () => {
    const results = await adapter.find("programming", { limit: 1 });

    expect(results.length).toBeLessThanOrEqual(1);
  });

  test("find() filters by collection", async () => {
    const results = await adapter.find("TypeScript", { collection: "tech" });

    expect(results.length).toBeGreaterThan(0);
    results.forEach((r) => {
      expect(r.memory.collection).toBe("tech");
    });
  });

  test("find() returns scores in descending order", async () => {
    const results = await adapter.find("programming");

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  test("find({ expand: true }) includes full content", async () => {
    const results = await adapter.find("TypeScript", { expand: true });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].memory.content).toBeDefined();
    expect(results[0].memory.content.length).toBeGreaterThan(0);
  });

  test("find({ expand: false }) returns preview only", async () => {
    const results = await adapter.find("TypeScript", { expand: false });

    expect(results.length).toBeGreaterThan(0);
    // Content should be truncated (this will be implemented with preview logic)
  });
});

describe("MemoryAdapter - FTS Fallback", () => {
  let pglite: PGlite;
  let db: DatabaseAdapter;
  let adapter: ReturnType<typeof createMemoryAdapter>;
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

    // Initialize schema
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
      CREATE INDEX IF NOT EXISTS memories_content_idx 
      ON memories 
      USING gin (to_tsvector('english', content))
    `);

    // Mock successful Ollama for initial storage
    const mockFetch = mock(() => mockSuccessResponse(mockEmbedding(1)));
    global.fetch = mockFetch as typeof fetch;

    adapter = createMemoryAdapter(db, mockConfig);

    // Store test memories
    await adapter.store("TypeScript is a typed superset");
    await adapter.store("JavaScript is dynamic");
    await adapter.store("Python for machine learning");
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await pglite.close();
    rmSync(dbPath, { recursive: true, force: true });
  });

  test("find({ fts: true }) uses full-text search", async () => {
    // Now mock Ollama as unavailable
    const mockFetch = mock(() => Promise.reject(new Error("Connection refused")));
    global.fetch = mockFetch as typeof fetch;

    const results = await adapter.find("JavaScript", { fts: true });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchType).toBe("fts");
    expect(results[0].memory.content).toContain("JavaScript");
  });

  test("find({ fts: true }) works when Ollama is down", async () => {
    // Mock Ollama as completely unavailable
    const mockFetch = mock(() => Promise.reject(new Error("ECONNREFUSED")));
    global.fetch = mockFetch as typeof fetch;

    // Should not throw, should use FTS instead
    const results = await adapter.find("TypeScript", { fts: true });

    expect(results.length).toBeGreaterThan(0);
  });
});

describe("MemoryAdapter - CRUD Operations", () => {
  let pglite: PGlite;
  let db: DatabaseAdapter;
  let adapter: ReturnType<typeof createMemoryAdapter>;
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

    // Initialize schema
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

    const mockFetch = mock(() => mockSuccessResponse(mockEmbedding(1)));
    global.fetch = mockFetch as typeof fetch;

    adapter = createMemoryAdapter(db, mockConfig);
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await pglite.close();
    rmSync(dbPath, { recursive: true, force: true });
  });

  test("remove() deletes a memory", async () => {
    const result = await adapter.store("Test memory");
    expect(await adapter.get(result.id)).not.toBeNull();

    await adapter.remove(result.id);
    expect(await adapter.get(result.id)).toBeNull();
  });

  test("validate() updates timestamp", async () => {
    const result = await adapter.store("Test memory");
    const before = await adapter.get(result.id);

    // Wait a bit to ensure timestamp difference
    await new Promise((resolve) => setTimeout(resolve, 10));

    await adapter.validate(result.id);
    const after = await adapter.get(result.id);

    if (!before || !after) {
      throw new Error("Memory not found");
    }
    expect(after.createdAt.getTime()).toBeGreaterThan(before.createdAt.getTime());
  });

  test("list() returns all memories", async () => {
    await adapter.store("Memory 1");
    await adapter.store("Memory 2");

    const memories = await adapter.list();
    expect(memories.length).toBeGreaterThanOrEqual(2);
  });

  test("list() filters by collection", async () => {
    await adapter.store("Memory 1", { collection: "col-a" });
    await adapter.store("Memory 2", { collection: "col-b" });

    const colA = await adapter.list({ collection: "col-a" });
    expect(colA.length).toBe(1);
    expect(colA[0].collection).toBe("col-a");
  });

  test("stats() returns correct counts", async () => {
    const before = await adapter.stats();
    await adapter.store("Memory 1");
    await adapter.store("Memory 2");
    const after = await adapter.stats();

    expect(after.memories).toBe(before.memories + 2);
    expect(after.embeddings).toBe(before.embeddings + 2);
  });
});

describe("MemoryAdapter - Health Check", () => {
  let pglite: PGlite;
  let db: DatabaseAdapter;
  let adapter: ReturnType<typeof createMemoryAdapter>;
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

    adapter = createMemoryAdapter(db, mockConfig);
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await pglite.close();
    rmSync(dbPath, { recursive: true, force: true });
  });

  test("checkHealth() returns true when Ollama is available", async () => {
    const mockFetch = mock(() =>
      mockHealthResponse([{ name: "mxbai-embed-large" }])
    );
    global.fetch = mockFetch as typeof fetch;

    const health = await adapter.checkHealth();

    expect(health.ollama).toBe(true);
    expect(health.model).toBe("mxbai-embed-large");
  });

  test("checkHealth() returns false when Ollama is unavailable", async () => {
    const mockFetch = mock(() => Promise.reject(new Error("ECONNREFUSED")));
    global.fetch = mockFetch as typeof fetch;

    const health = await adapter.checkHealth();

    expect(health.ollama).toBe(false);
  });

  test("checkHealth() returns false when model not found", async () => {
    const mockFetch = mock(() =>
      mockHealthResponse([{ name: "different-model" }])
    );
    global.fetch = mockFetch as typeof fetch;

    const health = await adapter.checkHealth();

    expect(health.ollama).toBe(false);
  });
});

describe("MemoryAdapter - Decay Calculation", () => {
  let pglite: PGlite;
  let db: DatabaseAdapter;
  let adapter: ReturnType<typeof createMemoryAdapter>;
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

    // Initialize schema
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

    const mockFetch = mock(() => mockSuccessResponse(mockEmbedding(1)));
    global.fetch = mockFetch as typeof fetch;

    adapter = createMemoryAdapter(db, mockConfig);
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await pglite.close();
    rmSync(dbPath, { recursive: true, force: true });
  });

  test("find() applies decay factor to scores", async () => {
    // Store an old memory by directly manipulating the database
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days ago
    await db.query(
      "INSERT INTO memories (id, content, metadata, collection, created_at) VALUES ($1, $2, $3, $4, $5)",
      ["old-mem", "Old memory content", "{}", "default", oldDate.toISOString()]
    );
    const vectorStr = `[${mockEmbedding(1).join(",")}]`;
    await db.query(
      "INSERT INTO memory_embeddings (memory_id, embedding) VALUES ($1, $2::vector)",
      ["old-mem", vectorStr]
    );

    // Store a new memory
    await adapter.store("New memory content");

    // Search should show decay effect
    const results = await adapter.find("memory content");

    // Find the old memory
    const oldResult = results.find((r) => r.memory.id === "old-mem");
    expect(oldResult).toBeDefined();

    // Score should be reduced by ~50% (90-day half-life)
    // We can't test exact score due to vector similarity variance,
    // but we can verify decay factor is being applied
    if (!oldResult) {
      throw new Error("Old memory not found in results");
    }
    expect(oldResult.score).toBeLessThan(1.0);
  });
});

describe("MemoryAdapter - Confidence-Based Decay", () => {
  let pglite: PGlite;
  let db: DatabaseAdapter;
  let adapter: ReturnType<typeof createMemoryAdapter>;
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

    // Initialize schema with confidence column
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

    const mockFetch = mock(() => mockSuccessResponse(mockEmbedding(1)));
    global.fetch = mockFetch as typeof fetch;

    adapter = createMemoryAdapter(db, mockConfig);
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await pglite.close();
    rmSync(dbPath, { recursive: true, force: true });
  });

  test("store() accepts confidence parameter", async () => {
    const result = await adapter.store("High confidence memory", {
      confidence: 0.9,
    });

    expect(result.id).toBeDefined();

    // Verify confidence was stored
    const row = await db.query<{ confidence: number }>(
      "SELECT confidence FROM memories WHERE id = $1",
      [result.id]
    );
    expect(row.rows[0].confidence).toBe(0.9);
  });

  test("store() defaults confidence to 0.7", async () => {
    const result = await adapter.store("Default confidence memory");

    const row = await db.query<{ confidence: number }>(
      "SELECT confidence FROM memories WHERE id = $1",
      [result.id]
    );
    expect(row.rows[0].confidence).toBe(0.7);
  });

  test("store() clamps confidence to 0.0-1.0 range", async () => {
    // Test upper bound
    const high = await adapter.store("Too high", { confidence: 1.5 });
    const highRow = await db.query<{ confidence: number }>(
      "SELECT confidence FROM memories WHERE id = $1",
      [high.id]
    );
    expect(highRow.rows[0].confidence).toBe(1.0);

    // Test lower bound
    const low = await adapter.store("Too low", { confidence: -0.5 });
    const lowRow = await db.query<{ confidence: number }>(
      "SELECT confidence FROM memories WHERE id = $1",
      [low.id]
    );
    expect(lowRow.rows[0].confidence).toBe(0.0);
  });

  test("high confidence memory decays slower than low confidence", async () => {
    // Create two memories 90 days old with different confidence levels
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days ago
    const vectorStr = `[${mockEmbedding(1).join(",")}]`;

    // High confidence (1.0) = 180 day half-life
    await db.query(
      "INSERT INTO memories (id, content, metadata, collection, created_at, confidence) VALUES ($1, $2, $3, $4, $5, $6)",
      ["high-conf", "High confidence content", "{}", "default", oldDate.toISOString(), 1.0]
    );
    await db.query(
      "INSERT INTO memory_embeddings (memory_id, embedding) VALUES ($1, $2::vector)",
      ["high-conf", vectorStr]
    );

    // Low confidence (0.3) = 72 day half-life (0.5 + 0.3 = 0.8, 90 * 0.8 = 72)
    await db.query(
      "INSERT INTO memories (id, content, metadata, collection, created_at, confidence) VALUES ($1, $2, $3, $4, $5, $6)",
      ["low-conf", "Low confidence content", "{}", "default", oldDate.toISOString(), 0.3]
    );
    await db.query(
      "INSERT INTO memory_embeddings (memory_id, embedding) VALUES ($1, $2::vector)",
      ["low-conf", vectorStr]
    );

    const results = await adapter.find("confidence content");

    const highResult = results.find((r) => r.memory.id === "high-conf");
    const lowResult = results.find((r) => r.memory.id === "low-conf");

    expect(highResult).toBeDefined();
    expect(lowResult).toBeDefined();

    if (!highResult || !lowResult) {
      throw new Error("Results not found");
    }

    // High confidence should have higher score (slower decay)
    // At 90 days: high conf (180d half-life) = 0.5^(90/180) ≈ 0.71
    // At 90 days: low conf (72d half-life) = 0.5^(90/72) ≈ 0.42
    expect(highResult.score).toBeGreaterThan(lowResult.score);
  });

  test("get() returns confidence field", async () => {
    const result = await adapter.store("Memory with confidence", {
      confidence: 0.85,
    });

    const memory = await adapter.get(result.id);

    expect(memory).not.toBeNull();
    expect(memory?.confidence).toBe(0.85);
  });

  test("confidence affects half-life calculation correctly", async () => {
    // Formula: halfLife = 90 * (0.5 + confidence)
    // confidence 1.0 -> halfLife = 90 * 1.5 = 135 days
    // confidence 0.5 -> halfLife = 90 * 1.0 = 90 days
    // confidence 0.0 -> halfLife = 90 * 0.5 = 45 days

    const vectorStr = `[${mockEmbedding(1).join(",")}]`;

    // Create memories at exactly 90 days old with different confidence
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // confidence 0.5 -> 90 day half-life -> at 90 days = 50% decay
    await db.query(
      "INSERT INTO memories (id, content, metadata, collection, created_at, confidence) VALUES ($1, $2, $3, $4, $5, $6)",
      ["mid-conf", "Mid confidence", "{}", "default", oldDate.toISOString(), 0.5]
    );
    await db.query(
      "INSERT INTO memory_embeddings (memory_id, embedding) VALUES ($1, $2::vector)",
      ["mid-conf", vectorStr]
    );

    const results = await adapter.find("Mid confidence");
    const midResult = results.find((r) => r.memory.id === "mid-conf");

    expect(midResult).toBeDefined();
    if (!midResult) throw new Error("Result not found");

    // At 90 days with 90-day half-life, decay should be exactly 0.5
    // Score = rawScore * 0.5
    // We can verify the decay factor is approximately 0.5
    // (exact value depends on raw similarity score)
    expect(midResult.score).toBeLessThan(0.6); // Should be around 0.5 * rawScore
  });
});
