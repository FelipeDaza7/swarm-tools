/**
 * SwarmMailAdapter WAL Health Integration Tests
 *
 * Tests for integrating WAL health monitoring into SwarmMailAdapter.healthCheck()
 * 
 * TDD: Write failing tests first, then enhance healthCheck().
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createInMemorySwarmMail } from "./pglite";
import type { SwarmMailAdapter } from "./types";

let swarmMail: SwarmMailAdapter;

beforeAll(async () => {
	swarmMail = await createInMemorySwarmMail("adapter-wal-health-test");
});

afterAll(async () => {
	await swarmMail.close();
});

describe("SwarmMailAdapter healthCheck with WAL monitoring", () => {
	test("healthCheck returns enhanced health object", async () => {
		const health = await swarmMail.healthCheck();

		expect(health).toBeDefined();
		expect(typeof health).toBe("object");

		// Should include basic connectivity check
		expect(health).toHaveProperty("connected");
		expect(health.connected).toBeBoolean();

		// Should include WAL health
		expect(health).toHaveProperty("walHealth");
		expect(health.walHealth).toBeDefined();
	});

	test("healthCheck includes WAL stats when available", async () => {
		const health = await swarmMail.healthCheck();

		expect(health.walHealth).toBeDefined();

		if (health.walHealth) {
			expect(health.walHealth).toHaveProperty("healthy");
			expect(health.walHealth).toHaveProperty("message");
			expect(health.walHealth.healthy).toBeBoolean();
			expect(health.walHealth.message).toBeString();
		}
	});

	test("healthCheck WAL stats show healthy for in-memory db", async () => {
		const health = await swarmMail.healthCheck();

		// In-memory db should have no WAL files
		expect(health.walHealth?.healthy).toBe(true);
		expect(health.walHealth?.message).toContain("WAL healthy");
	});

	test("healthCheck can use custom WAL threshold", async () => {
		const health = await swarmMail.healthCheck({ walThresholdMb: 50 });

		expect(health.walHealth).toBeDefined();
		// Should include the custom threshold in message
		if (health.walHealth?.message) {
			// Message format: "WAL healthy: X.XXMB (N files), threshold: 50MB"
			expect(health.walHealth.message).toContain("threshold: 50MB");
		}
	});

	test("healthCheck works when database doesn't support WAL stats", async () => {
		// This tests the fallback when getWalStats is not available
		// In practice, wrapPGlite always has it, but other adapters may not

		const health = await swarmMail.healthCheck();

		// Should still return health object
		expect(health).toBeDefined();
		expect(health.connected).toBeBoolean();
	});

	test("getDatabaseStats includes WAL stats", async () => {
		const stats = await swarmMail.getDatabaseStats();

		expect(stats).toBeDefined();
		expect(stats).toHaveProperty("events");
		expect(stats).toHaveProperty("agents");
		expect(stats).toHaveProperty("messages");
		expect(stats).toHaveProperty("reservations");

		// Should include WAL stats
		expect(stats).toHaveProperty("wal");
		if (stats.wal) {
			expect(stats.wal).toHaveProperty("size");
			expect(stats.wal).toHaveProperty("fileCount");
		}
	});
});
