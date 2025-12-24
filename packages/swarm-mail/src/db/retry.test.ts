import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import { withSqliteRetry } from "./retry.js";

describe("withSqliteRetry", () => {
	test("retries on SQLITE_BUSY error", async () => {
		let attempts = 0;
		const operation = Effect.sync(() => {
			attempts++;
			if (attempts < 3) {
				const error = new Error("database is locked");
				error.message = "SQLITE_BUSY: database is locked";
				throw error;
			}
			return "success";
		});

		const result = await Effect.runPromise(withSqliteRetry(operation));

		expect(result).toBe("success");
		expect(attempts).toBe(3);
	});

	test("retries on SQLITE_LOCKED error", async () => {
		let attempts = 0;
		const operation = Effect.sync(() => {
			attempts++;
			if (attempts < 2) {
				const error = new Error("database is locked");
				error.message = "SQLITE_LOCKED: database table is locked";
				throw error;
			}
			return "success";
		});

		const result = await Effect.runPromise(withSqliteRetry(operation));

		expect(result).toBe("success");
		expect(attempts).toBe(2);
	});

	test("fails immediately on SQLITE_CONSTRAINT error", async () => {
		let attempts = 0;
		const operation = Effect.sync(() => {
			attempts++;
			const error = new Error("constraint violation");
			error.message = "SQLITE_CONSTRAINT: UNIQUE constraint failed";
			throw error;
		});

		await expect(Effect.runPromise(withSqliteRetry(operation))).rejects.toThrow(
			"SQLITE_CONSTRAINT",
		);
		expect(attempts).toBe(1);
	});

	test("fails immediately on SQLITE_MISMATCH error", async () => {
		let attempts = 0;
		const operation = Effect.sync(() => {
			attempts++;
			const error = new Error("type mismatch");
			error.message = "SQLITE_MISMATCH: datatype mismatch";
			throw error;
		});

		await expect(Effect.runPromise(withSqliteRetry(operation))).rejects.toThrow(
			"SQLITE_MISMATCH",
		);
		expect(attempts).toBe(1);
	});

	test("respects max retries (3 attempts)", async () => {
		let attempts = 0;
		const operation = Effect.sync(() => {
			attempts++;
			const error = new Error("database is locked");
			error.message = "SQLITE_BUSY: database is locked";
			throw error;
		});

		await expect(Effect.runPromise(withSqliteRetry(operation))).rejects.toThrow(
			"SQLITE_BUSY",
		);
		// Initial attempt + 3 retries = 4 total attempts
		expect(attempts).toBe(4);
	});

	test("uses exponential backoff timing", async () => {
		const timestamps: number[] = [];
		let attempts = 0;

		const operation = Effect.sync(() => {
			attempts++;
			timestamps.push(Date.now());
			if (attempts < 4) {
				const error = new Error("database is locked");
				error.message = "SQLITE_BUSY: database is locked";
				throw error;
			}
			return "success";
		});

		const start = Date.now();
		await Effect.runPromise(withSqliteRetry(operation));
		const elapsed = Date.now() - start;

		// Should have 4 timestamps (initial + 3 retries)
		expect(timestamps.length).toBe(4);

		// Verify exponential backoff pattern
		// Delays should be approximately: 100ms, 200ms, 400ms
		// Total minimum delay: 700ms (allowing for execution overhead)
		expect(elapsed).toBeGreaterThanOrEqual(600);

		// Check individual delays (with 50ms tolerance for execution time)
		if (timestamps.length >= 2 && timestamps[1] && timestamps[0]) {
			const delay1 = timestamps[1] - timestamps[0];
			expect(delay1).toBeGreaterThanOrEqual(80); // ~100ms
			expect(delay1).toBeLessThan(200);
		}

		if (timestamps.length >= 3 && timestamps[2] && timestamps[1]) {
			const delay2 = timestamps[2] - timestamps[1];
			expect(delay2).toBeGreaterThanOrEqual(150); // ~200ms
			expect(delay2).toBeLessThan(350);
		}

		if (timestamps.length >= 4 && timestamps[3] && timestamps[2]) {
			const delay3 = timestamps[3] - timestamps[2];
			expect(delay3).toBeGreaterThanOrEqual(300); // ~400ms
			expect(delay3).toBeLessThan(600);
		}
	});

	test("succeeds immediately if no error", async () => {
		let attempts = 0;
		const operation = Effect.sync(() => {
			attempts++;
			return "success";
		});

		const result = await Effect.runPromise(withSqliteRetry(operation));

		expect(result).toBe("success");
		expect(attempts).toBe(1);
	});

	test("fails immediately on non-Error throws", async () => {
		let attempts = 0;
		const operation = Effect.sync(() => {
			attempts++;
			throw "string error";
		});

		await expect(
			Effect.runPromise(withSqliteRetry(operation)),
		).rejects.toThrow("string error");
		expect(attempts).toBe(1);
	});
});
