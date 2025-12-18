/**
 * Memory Tools Integration Tests
 *
 * Tests for semantic-memory_* tool registration and execution.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { memoryTools, resetMemoryCache } from "./memory-tools";
import { closeAllSwarmMail } from "swarm-mail";

describe("memory tools integration", () => {
	afterAll(async () => {
		resetMemoryCache();
		await closeAllSwarmMail();
	});

	test("all tools are registered with correct names", () => {
		const toolNames = Object.keys(memoryTools);
		expect(toolNames).toContain("semantic-memory_store");
		expect(toolNames).toContain("semantic-memory_find");
		expect(toolNames).toContain("semantic-memory_get");
		expect(toolNames).toContain("semantic-memory_remove");
		expect(toolNames).toContain("semantic-memory_validate");
		expect(toolNames).toContain("semantic-memory_list");
		expect(toolNames).toContain("semantic-memory_stats");
		expect(toolNames).toContain("semantic-memory_check");
	});

	test("tools have execute functions", () => {
		for (const [name, tool] of Object.entries(memoryTools)) {
			expect(typeof tool.execute).toBe("function");
		}
	});

	describe("semantic-memory_store", () => {
		test("executes and returns JSON", async () => {
			const tool = memoryTools["semantic-memory_store"];
			const result = await tool.execute(
				{
					information: "Test memory for tools integration",
					tags: "test",
				},
				{ sessionID: "test-session" } as any,
			);

			expect(typeof result).toBe("string");
			const parsed = JSON.parse(result);
			expect(parsed.id).toBeDefined();
			expect(parsed.id).toMatch(/^mem_/);
			expect(parsed.message).toContain("Stored memory");
		});
	});

	describe("semantic-memory_find", () => {
		test("executes and returns JSON array", async () => {
			// Store a memory first
			const storeTool = memoryTools["semantic-memory_store"];
			await storeTool.execute(
				{
					information: "Findable test memory with unique keyword xyztest123",
				},
				{ sessionID: "test-session" } as any,
			);

			// Search for it
			const findTool = memoryTools["semantic-memory_find"];
			const result = await findTool.execute(
				{
					query: "xyztest123",
					limit: 5,
				},
				{ sessionID: "test-session" } as any,
			);

			expect(typeof result).toBe("string");
			const parsed = JSON.parse(result);
			expect(parsed.results).toBeDefined();
			expect(Array.isArray(parsed.results)).toBe(true);
			expect(parsed.count).toBeGreaterThanOrEqual(0);
		});
	});

	describe("semantic-memory_stats", () => {
		test("returns memory and embedding counts", async () => {
			const tool = memoryTools["semantic-memory_stats"];
			const result = await tool.execute(
				{},
				{ sessionID: "test-session" } as any,
			);

			expect(typeof result).toBe("string");
			const parsed = JSON.parse(result);
			expect(typeof parsed.memories).toBe("number");
			expect(typeof parsed.embeddings).toBe("number");
		});
	});

	describe("semantic-memory_check", () => {
		test("checks Ollama health", async () => {
			const tool = memoryTools["semantic-memory_check"];
			const result = await tool.execute(
				{},
				{ sessionID: "test-session" } as any,
			);

			expect(typeof result).toBe("string");
			const parsed = JSON.parse(result);
			expect(typeof parsed.ollama).toBe("boolean");
		});
	});
});
