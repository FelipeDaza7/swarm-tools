/**
 * Integration tests for SwarmMailAdapter retry logic
 *
 * Tests that concurrent write operations don't fail with SQLITE_BUSY errors
 * when using the withSqliteRetry() wrapper.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createInMemorySwarmMailLibSQL } from "./libsql.convenience";
import type { SwarmMailAdapter } from "./types/adapter";

describe("SwarmMailAdapter - Retry Logic", () => {
	let adapter: SwarmMailAdapter;

	beforeAll(async () => {
		adapter = await createInMemorySwarmMailLibSQL("test-retry");
	});

	afterAll(async () => {
		await adapter.close();
	});

	test("concurrent resetDatabase calls should not fail with SQLITE_BUSY", async () => {
		// Setup: add some data first
		await adapter.registerAgent("test-project", "agent1");
		await adapter.registerAgent("test-project", "agent2");

		// Act: concurrent resets (this would fail without retry)
		const resetPromises = Array.from({ length: 5 }, () =>
			adapter.resetDatabase(),
		);

		// Assert: all should succeed without SQLITE_BUSY errors
		await expect(Promise.all(resetPromises)).resolves.toBeDefined();

		// Verify database is actually empty
		const stats = await adapter.getDatabaseStats();
		expect(stats.events).toBe(0);
		expect(stats.agents).toBe(0);
		expect(stats.messages).toBe(0);
	});

	test("concurrent write operations (register agents) should not fail", async () => {
		// Act: concurrent agent registrations
		const registerPromises = Array.from({ length: 10 }, (_, i) =>
			adapter.registerAgent("test-project", `agent-${i}`),
		);

		// Assert: all should succeed
		const results = await Promise.all(registerPromises);
		expect(results).toHaveLength(10);

		// Verify all agents were registered
		const agents = await adapter.getAgents("test-project");
		expect(agents).toHaveLength(10);
	});

	test("mixed concurrent operations (read/write) should work", async () => {
		// Setup
		await adapter.resetDatabase();
		await adapter.registerAgent("test-project", "sender");

		// Act: mix of writes and reads
		const operations = [
			adapter.sendMessage(
				"test-project",
				"sender",
				["receiver1"],
				"Message 1",
				"Body 1",
			),
			adapter.getAgents("test-project"),
			adapter.sendMessage(
				"test-project",
				"sender",
				["receiver2"],
				"Message 2",
				"Body 2",
			),
			adapter.getDatabaseStats(),
			adapter.sendMessage(
				"test-project",
				"sender",
				["receiver3"],
				"Message 3",
				"Body 3",
			),
		];

		// Assert: all should complete successfully
		const results = await Promise.all(operations);
		expect(results).toHaveLength(5);
	});

	test("resetDatabase with checkpoint should handle retries", async () => {
		// Setup: create some data
		await adapter.resetDatabase();
		for (let i = 0; i < 20; i++) {
			await adapter.registerAgent("test-project", `agent-${i}`);
		}

		// Act: concurrent resets with checkpoints
		// This is more likely to trigger SQLITE_BUSY because resetDatabase
		// does multiple DELETE operations
		const resetPromises = Array.from({ length: 3 }, async () => {
			await adapter.resetDatabase();
			// Force checkpoint after reset (write operation)
			const db = await adapter.getDatabase();
			if (db.checkpoint) {
				await db.checkpoint();
			}
		});

		// Assert: should complete without errors
		await Promise.all(resetPromises);

		// Verify clean state
		const stats = await adapter.getDatabaseStats();
		expect(stats.events).toBe(0);
		expect(stats.agents).toBe(0);
	});
});
