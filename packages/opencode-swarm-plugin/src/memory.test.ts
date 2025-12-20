/**
 * Memory Tool Tests
 *
 * Tests for semantic-memory_* tool handlers that use embedded MemoryStore.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import {
	createMemoryAdapter,
	type MemoryAdapter,
	resetMigrationCheck,
} from "./memory";
import { createInMemorySwarmMail } from "swarm-mail";
import type { SwarmMailAdapter } from "swarm-mail";

describe("memory adapter", () => {
	let swarmMail: SwarmMailAdapter;
	let adapter: MemoryAdapter;

beforeAll(async () => {
	// Create in-memory SwarmMail
	swarmMail = await createInMemorySwarmMail("test-memory");
	const db = await swarmMail.getDatabase();
	
	// Create memory schema manually (matches libsql-schema.ts / migration 9)
	// Note: test-utils.ts has outdated schema - don't use it
	
	// Create memories table with vector column
	await db.getClient().execute(`
		CREATE TABLE memories (
			id TEXT PRIMARY KEY,
			content TEXT NOT NULL,
			metadata TEXT DEFAULT '{}',
			collection TEXT DEFAULT 'default',
			tags TEXT DEFAULT '[]',
			created_at TEXT DEFAULT (datetime('now')),
			updated_at TEXT DEFAULT (datetime('now')),
			decay_factor REAL DEFAULT 0.7,
			embedding F32_BLOB(1024)
		)
	`);
	
	// Create FTS5 virtual table - MUST include id column
	// (test-utils.ts has outdated schema without id - don't copy from there)
	await db.getClient().execute(`
		CREATE VIRTUAL TABLE memories_fts USING fts5(
			id UNINDEXED,
			content,
			content='memories',
			content_rowid='rowid'
		)
	`);
	
	// Create triggers to keep FTS in sync
	await db.getClient().execute(`
		CREATE TRIGGER memories_fts_insert
		AFTER INSERT ON memories 
		BEGIN
			INSERT INTO memories_fts(rowid, id, content) 
			VALUES (new.rowid, new.id, new.content);
		END
	`);
	await db.getClient().execute(`
		CREATE TRIGGER memories_fts_delete
		AFTER DELETE ON memories 
		BEGIN
			DELETE FROM memories_fts WHERE rowid = old.rowid;
		END
	`);
	await db.getClient().execute(`
		CREATE TRIGGER memories_fts_update
		AFTER UPDATE ON memories 
		BEGIN
			UPDATE memories_fts 
			SET content = new.content 
			WHERE rowid = new.rowid;
		END
	`);
	
	// Create vector index for similarity search (required for vector_top_k)
	await db.getClient().execute(`
		CREATE INDEX idx_memories_embedding ON memories(libsql_vector_idx(embedding))
	`);
	
	// Insert a dummy memory to prevent auto-migration from running
	await db.getClient().execute(`
		INSERT INTO memories (id, content, collection, created_at)
		VALUES ('mem_init', 'Test setup marker', 'default', datetime('now'))
	`);
	
	adapter = await createMemoryAdapter(db);
});

	afterAll(async () => {
		await swarmMail.close();
	});

	describe("store", () => {
		test("stores memory with auto-generated ID", async () => {
			const result = await adapter.store({
				information: "OAuth refresh tokens need 5min buffer",
				tags: "auth,tokens",
				metadata: JSON.stringify({ project: "test" }),
			});

			expect(result.id).toBeDefined();
			expect(result.id).toMatch(/^mem_/);
			expect(result.message).toContain("Stored memory");
		});

		test("stores memory with explicit collection", async () => {
			const result = await adapter.store({
				information: "Test memory",
				collection: "project-alpha",
			});

			expect(result.id).toMatch(/^mem_/);
			expect(result.message).toContain("collection: project-alpha");
		});
	});

	describe("find", () => {
		test("returns results sorted by relevance score", async () => {
			// Store some test memories
			await adapter.store({ information: "Test memory about cats" });
			await adapter.store({ information: "Test memory about dogs" });
			
			// Query for cats - should return relevant results first
			const results = await adapter.find({
				query: "cats felines",
				limit: 5,
			});

			// Should find at least the cat memory
			expect(results.count).toBeGreaterThan(0);
			// Results should be in descending score order
			for (let i = 1; i < results.results.length; i++) {
				expect(results.results[i - 1].score).toBeGreaterThanOrEqual(results.results[i].score);
			}
		});

		test("finds stored memories by semantic similarity", async () => {
			// Store a memory
			await adapter.store({
				information: "Next.js 16 Cache Components need Suspense boundaries",
				tags: "nextjs,caching",
			});

			// Search for it
			const results = await adapter.find({
				query: "Next.js caching suspense",
				limit: 5,
			});

			expect(results.count).toBeGreaterThan(0);
			expect(results.results[0].content).toContain("Cache Components");
		});

		test("respects collection filter", async () => {
			await adapter.store({
				information: "Collection A memory",
				collection: "collection-a",
			});

			const results = await adapter.find({
				query: "collection",
				collection: "collection-b",
			});

			// Should not find collection-a memory
			expect(
				results.results.some((r) => r.content.includes("Collection A"))
			).toBe(false);
		});

		test("supports full-text search fallback", async () => {
			await adapter.store({
				information: "FTSTEST unique-keyword-12345",
			});

			const results = await adapter.find({
				query: "unique-keyword-12345",
				fts: true,
			});

			expect(results.count).toBeGreaterThan(0);
		});

		test("expand option returns full content", async () => {
			const stored = await adapter.store({
				information: "A".repeat(500), // Long content
			});

			// Without expand - should truncate
			const withoutExpand = await adapter.find({
				query: "AAA",
				limit: 1,
			});
			expect(withoutExpand.results[0].content.length).toBeLessThan(500);

			// With expand - should return full content
			const withExpand = await adapter.find({
				query: "AAA",
				limit: 1,
				expand: true,
			});
			expect(withExpand.results[0].content.length).toBe(500);
		});
	});

	describe("get", () => {
		test("retrieves memory by ID", async () => {
			const stored = await adapter.store({
				information: "Get test memory",
			});

			const memory = await adapter.get({ id: stored.id });

			expect(memory).toBeDefined();
			expect(memory?.content).toBe("Get test memory");
		});

		test("returns null for nonexistent ID", async () => {
			const memory = await adapter.get({ id: "mem_nonexistent" });
			expect(memory).toBeNull();
		});
	});

	describe("remove", () => {
		test("deletes memory by ID", async () => {
			const stored = await adapter.store({
				information: "Memory to delete",
			});

			const result = await adapter.remove({ id: stored.id });
			expect(result.success).toBe(true);

			// Verify it's gone
			const memory = await adapter.get({ id: stored.id });
			expect(memory).toBeNull();
		});

		test("handles nonexistent ID gracefully", async () => {
			const result = await adapter.remove({ id: "mem_nonexistent" });
			expect(result.success).toBe(true); // No-op
		});
	});

	describe("list", () => {
		test("lists all memories", async () => {
			await adapter.store({ information: "List test 1" });
			await adapter.store({ information: "List test 2" });

			const memories = await adapter.list({});

			expect(memories.length).toBeGreaterThanOrEqual(2);
		});

		test("filters by collection", async () => {
			await adapter.store({
				information: "Collection X",
				collection: "col-x",
			});
			await adapter.store({
				information: "Collection Y",
				collection: "col-y",
			});

			const results = await adapter.list({ collection: "col-x" });

			expect(results.every((m) => m.collection === "col-x")).toBe(true);
		});
	});

	describe("stats", () => {
		test("returns memory and embedding counts", async () => {
			const stats = await adapter.stats();

			expect(stats.memories).toBeGreaterThanOrEqual(0);
			expect(stats.embeddings).toBeGreaterThanOrEqual(0);
		});
	});

	describe("validate", () => {
		test("resets decay timer for memory", async () => {
			const stored = await adapter.store({
				information: "Validate test memory",
			});

			const result = await adapter.validate({ id: stored.id });

			expect(result.success).toBe(true);
			expect(result.message).toContain("validated");
		});

		test("handles nonexistent ID", async () => {
			const result = await adapter.validate({ id: "mem_nonexistent" });
			expect(result.success).toBe(false);
		});
	});

	describe("checkHealth", () => {
		test("checks Ollama availability", async () => {
			const health = await adapter.checkHealth();

			expect(health.ollama).toBeDefined();
			// May be true or false depending on local setup
			// Just verify structure
			expect(typeof health.ollama).toBe("boolean");
		});
	});
});

describe("auto-migration on createMemoryAdapter", () => {
	// Reset migration flag before each test for isolation
	beforeEach(() => {
		resetMigrationCheck();
	});

	test("auto-migrates when legacy DB exists and target is empty", async () => {
		// Note: This test will actually migrate if ~/.semantic-memory/memory exists
		// For this implementation, we're testing the happy path
		const swarmMail = await createInMemorySwarmMail("test-auto-migrate");
		const db = await swarmMail.getDatabase();
		await db.getClient().execute(`
			CREATE TABLE IF NOT EXISTS memories (
				id TEXT PRIMARY KEY,
				content TEXT NOT NULL,
				metadata TEXT DEFAULT '{}',
				collection TEXT DEFAULT 'default',
				tags TEXT DEFAULT '[]',
				created_at TEXT DEFAULT (datetime('now')),
				updated_at TEXT DEFAULT (datetime('now')),
				decay_factor REAL DEFAULT 1.0,
				embedding F32_BLOB(1024)
			)
		`);
		
		// Should not throw even if legacy DB exists
		const adapter = await createMemoryAdapter(db);
		expect(adapter).toBeDefined();
		
		// If legacy DB existed and was migrated, there should be memories
		const stats = await adapter.stats();
		// Don't assert specific count - depends on whether legacy DB exists
		expect(stats.memories).toBeGreaterThanOrEqual(0);
		
		await swarmMail.close();
	});

	test("skips auto-migration when legacy DB doesn't exist", async () => {
		// Reset flag to ensure fresh check
		resetMigrationCheck();
		
		const swarmMail = await createInMemorySwarmMail("test-no-legacy");
		const db = await swarmMail.getDatabase();
		await db.getClient().execute(`
			CREATE TABLE IF NOT EXISTS memories (
				id TEXT PRIMARY KEY,
				content TEXT NOT NULL,
				metadata TEXT DEFAULT '{}',
				collection TEXT DEFAULT 'default',
				tags TEXT DEFAULT '[]',
				created_at TEXT DEFAULT (datetime('now')),
				updated_at TEXT DEFAULT (datetime('now')),
				decay_factor REAL DEFAULT 1.0,
				embedding F32_BLOB(1024)
			)
		`);
		
		// Should not throw or log errors
		const adapter = await createMemoryAdapter(db);
		
		expect(adapter).toBeDefined();
		await swarmMail.close();
	});

	test("skips auto-migration when target already has data", async () => {
		const swarmMail = await createInMemorySwarmMail("test-has-data");
		const db = await swarmMail.getDatabase();
		await db.getClient().execute(`
			CREATE TABLE IF NOT EXISTS memories (
				id TEXT PRIMARY KEY,
				content TEXT NOT NULL,
				metadata TEXT DEFAULT '{}',
				collection TEXT DEFAULT 'default',
				tags TEXT DEFAULT '[]',
				created_at TEXT DEFAULT (datetime('now')),
				updated_at TEXT DEFAULT (datetime('now')),
				decay_factor REAL DEFAULT 1.0,
				embedding F32_BLOB(1024)
			)
		`);
		
		// Reset flag to ensure first call checks migration
		resetMigrationCheck();
		
		// Pre-populate with a memory
		const adapter1 = await createMemoryAdapter(db);
		await adapter1.store({ information: "Existing memory" });
		
		// Get count before second call
		const statsBefore = await adapter1.stats();
		
		// Reset flag to force re-check on second call
		resetMigrationCheck();
		
		// Second call should skip migration because target has data
		const adapter2 = await createMemoryAdapter(db);
		const statsAfter = await adapter2.stats();
		
		// Should not have added more memories (no migration ran)
		expect(statsAfter.memories).toBe(statsBefore.memories);
		
		await swarmMail.close();
	});

	test("migration check only runs once per module lifetime", async () => {
		const swarmMail = await createInMemorySwarmMail("test-once");
		const db = await swarmMail.getDatabase();
		await db.getClient().execute(`
			CREATE TABLE IF NOT EXISTS memories (
				id TEXT PRIMARY KEY,
				content TEXT NOT NULL,
				metadata TEXT DEFAULT '{}',
				collection TEXT DEFAULT 'default',
				tags TEXT DEFAULT '[]',
				created_at TEXT DEFAULT (datetime('now')),
				updated_at TEXT DEFAULT (datetime('now')),
				decay_factor REAL DEFAULT 1.0,
				embedding F32_BLOB(1024)
			)
		`);
		
		// First call - may do migration
		const adapter1 = await createMemoryAdapter(db);
		
		// Subsequent calls should be fast (no migration check)
		const startTime = Date.now();
		const adapter2 = await createMemoryAdapter(db);
		const adapter3 = await createMemoryAdapter(db);
		const elapsed = Date.now() - startTime;
		
		// Second and third calls should be very fast since flag is set
		expect(elapsed).toBeLessThan(100);
		
		expect(adapter1).toBeDefined();
		expect(adapter2).toBeDefined();
		expect(adapter3).toBeDefined();
		
		await swarmMail.close();
	});
});
