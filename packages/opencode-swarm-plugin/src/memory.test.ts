/**
 * Memory Tool Tests
 *
 * Tests for semantic-memory_* tool handlers that use embedded MemoryStore.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
	createMemoryAdapter,
	type MemoryAdapter,
} from "./memory";
import { createInMemorySwarmMail } from "swarm-mail";
import type { SwarmMailAdapter } from "swarm-mail";

describe("memory adapter", () => {
	let swarmMail: SwarmMailAdapter;
	let adapter: MemoryAdapter;

	beforeAll(async () => {
		// Create in-memory SwarmMail with memory support
		swarmMail = await createInMemorySwarmMail("test-memory");
		const db = await swarmMail.getDatabase();
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
		test("returns low-score results for unrelated query", async () => {
			// Query something completely unrelated
			const results = await adapter.find({
				query: "xyzabc123-totally-unrelated-unique-keyword",
				limit: 5,
			});

			// May return some low-score matches, but score should be low
			if (results.count > 0) {
				expect(results.results[0].score).toBeLessThan(0.6);
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
