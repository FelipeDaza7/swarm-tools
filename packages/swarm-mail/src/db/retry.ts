import { Effect, Schedule } from "effect";

/**
 * Retry schedule for SQLite operations
 * - Exponential backoff starting at 100ms
 * - Max 3 retries (4 total attempts)
 * - Delays: 100ms, 200ms, 400ms
 */
const retrySchedule = Schedule.exponential("100 millis").pipe(
	Schedule.compose(Schedule.recurs(3)),
);

/**
 * Checks if an error is a retryable SQLite error
 */
const isRetryableError = (error: unknown): boolean => {
	if (!(error instanceof Error)) {
		return false;
	}
	return (
		error.message.includes("SQLITE_BUSY") ||
		error.message.includes("SQLITE_LOCKED")
	);
};

/**
 * Wraps an Effect operation with retry logic for SQLite BUSY/LOCKED errors
 *
 * Retries on:
 * - SQLITE_BUSY: database is locked by another connection
 * - SQLITE_LOCKED: database table is locked
 *
 * Fails immediately on:
 * - SQLITE_CONSTRAINT: constraint violation (e.g., unique, foreign key)
 * - SQLITE_MISMATCH: type mismatch
 * - Other errors
 *
 * Uses exponential backoff: 100ms, 200ms, 400ms (3 retries max)
 *
 * @example
 * ```typescript
 * const operation = Effect.tryPromise(() => db.execute("INSERT ..."));
 * const withRetry = withSqliteRetry(operation);
 * await Effect.runPromise(withRetry);
 * ```
 */
export const withSqliteRetry = <A, E>(
	operation: Effect.Effect<A, E>,
): Effect.Effect<A, E> => {
	// Catch defects (thrown exceptions) and convert to failures for retry logic
	return operation.pipe(
		Effect.catchAllDefect((defect) => Effect.fail(defect as E)),
		Effect.retry({
			schedule: retrySchedule,
			while: isRetryableError,
		}),
	);
};
