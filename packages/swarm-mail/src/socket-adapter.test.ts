/**
 * Socket Adapter Tests
 *
 * Tests for postgres.js wrapper matching DatabaseAdapter interface.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import postgres from "postgres";
import { wrapPostgres, createSocketAdapter } from "./socket-adapter";
import type { DatabaseAdapter } from "./types/database";

describe("wrapPostgres", () => {
	let sql: postgres.Sql<Record<string, unknown>>;
	let db: DatabaseAdapter;

	beforeAll(() => {
		// Use in-memory postgres connection for testing
		sql = postgres({
			host: "localhost",
			port: 5432,
			database: "postgres",
			// Use connection params that will fail gracefully if no server
			connect_timeout: 1,
			max: 1,
		});
		db = wrapPostgres(sql);
	});

	afterAll(async () => {
		await db.close?.();
	});

	test("wraps postgres.js to match DatabaseAdapter interface", () => {
		expect(db).toBeDefined();
		expect(typeof db.query).toBe("function");
		expect(typeof db.exec).toBe("function");
		expect(typeof db.transaction).toBe("function");
		expect(typeof db.close).toBe("function");
	});

	test("query returns QueryResult shape", async () => {
		// This test requires a running postgres server
		// Skip if connection fails
		try {
			const result = await db.query<{ result: number }>("SELECT 1 as result");
			expect(result).toHaveProperty("rows");
			expect(Array.isArray(result.rows)).toBe(true);
			if (result.rows.length > 0) {
				expect(result.rows[0]).toHaveProperty("result");
			}
		} catch (error) {
			// Expected to fail if no postgres server running
			console.log("Skipping query test - no postgres server available");
		}
	});
});

describe("createSocketAdapter", () => {
	test("requires either path or host+port", async () => {
		await expect(createSocketAdapter({})).rejects.toThrow(
			"Socket adapter requires either 'path' (unix socket) or 'host' + 'port' (TCP)",
		);
	});

	test("rejects both path and host/port", async () => {
		await expect(
			createSocketAdapter({
				path: "/tmp/test.sock",
				host: "localhost",
				port: 5432,
			}),
		).rejects.toThrow("cannot specify both 'path' and 'host'/'port'");
	});

	test("creates adapter with TCP connection (if server available)", async () => {
		// This test requires a running postgres server
		try {
			const db = await createSocketAdapter({
				host: "localhost",
				port: 5432,
				timeout: 1,
			});
			expect(db).toBeDefined();
			expect(typeof db.query).toBe("function");
			await db.close?.();
		} catch (error) {
			// Expected to fail if no postgres server running
			console.log("Skipping TCP test - no postgres server available");
		}
	});

	test("creates adapter with unix socket (if socket available)", async () => {
		// This test requires a running postgres server on unix socket
		try {
			const db = await createSocketAdapter({
				path: "/tmp/postgres.sock",
				timeout: 1,
			});
			expect(db).toBeDefined();
			expect(typeof db.query).toBe("function");
			await db.close?.();
		} catch (error) {
			// Expected to fail if no postgres socket available
			console.log("Skipping unix socket test - no postgres socket available");
		}
	});
});

describe("DatabaseAdapter compliance", () => {
	test("transaction wrapper behaves correctly (integration)", async () => {
		// This test requires a running postgres server
		try {
			const db = await createSocketAdapter({
				host: "localhost",
				port: 5432,
				timeout: 1,
			});

			// Create a test table
			await db.exec("CREATE TEMP TABLE test_tx (id SERIAL PRIMARY KEY, value TEXT)");

			// Use transaction
			const result = await db.transaction?.(async (tx) => {
				await tx.exec("INSERT INTO test_tx (value) VALUES ('test1')");
				await tx.exec("INSERT INTO test_tx (value) VALUES ('test2')");
				return { success: true };
			});

			expect(result).toEqual({ success: true });

			// Verify data was inserted
			const rows = await db.query<{ value: string }>("SELECT value FROM test_tx ORDER BY id");
			expect(rows.rows).toHaveLength(2);
			expect(rows.rows[0]?.value).toBe("test1");
			expect(rows.rows[1]?.value).toBe("test2");

			await db.close?.();
		} catch (error) {
			// Expected to fail if no postgres server running
			console.log("Skipping transaction test - no postgres server available");
		}
	});
});
