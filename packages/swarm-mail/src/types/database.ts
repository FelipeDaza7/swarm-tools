/**
 * DatabaseAdapter - Database-agnostic interface for swarm-mail
 *
 * Abstracts PGLite-specific operations to support multiple database backends.
 * Based on coursebuilder's adapter-drizzle pattern.
 *
 * ## Design Goals
 * - Zero PGLite types in this interface
 * - Support for PGLite, better-sqlite3, libsql, PostgreSQL
 * - Transaction support optional (some adapters may not support it)
 *
 * ## Implementation Strategy
 * - Accept database instance via dependency injection
 * - Adapters implement this interface for their specific database
 * - Query results use plain objects (no driver-specific types)
 */

/**
 * Query result with rows array
 *
 * All database adapters return results in this shape.
 */
export interface QueryResult<T = unknown> {
	/** Array of result rows */
	rows: T[];
}

/**
 * DatabaseAdapter interface
 *
 * Minimal interface for executing SQL queries and managing transactions.
 * Adapters implement this for PGLite, SQLite, PostgreSQL, etc.
 */
export interface DatabaseAdapter {
	/**
	 * Execute a query and return results
	 *
	 * @param sql - SQL query string (parameterized)
	 * @param params - Query parameters ($1, $2, etc.)
	 * @returns Query result with rows array
	 *
	 * @example
	 * ```typescript
	 * const result = await db.query<{ id: number }>(
	 *   "SELECT id FROM agents WHERE name = $1",
	 *   ["BlueLake"]
	 * );
	 * const id = result.rows[0]?.id;
	 * ```
	 */
	query<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;

	/**
	 * Execute a SQL statement without returning results
	 *
	 * Used for DDL (CREATE TABLE, etc.), DML (INSERT/UPDATE/DELETE), and transactions.
	 *
	 * @param sql - SQL statement(s) to execute
	 *
	 * @example
	 * ```typescript
	 * await db.exec("BEGIN");
	 * await db.exec("COMMIT");
	 * await db.exec("CREATE TABLE users (id SERIAL PRIMARY KEY)");
	 * ```
	 */
	exec(sql: string): Promise<void>;

	/**
	 * Execute a function within a transaction (optional)
	 *
	 * If the adapter doesn't support transactions, it can omit this method
	 * or throw an error. The swarm-mail layer will handle transaction
	 * fallback (using manual BEGIN/COMMIT/ROLLBACK).
	 *
	 * @param fn - Function to execute within transaction context
	 * @returns Result of the function
	 *
	 * @example
	 * ```typescript
	 * const result = await db.transaction?.(async (tx) => {
	 *   await tx.query("INSERT INTO events ...", [...]);
	 *   await tx.query("UPDATE agents ...", [...]);
	 *   return { success: true };
	 * });
	 * ```
	 */
	transaction?<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T>;

	/**
	 * Close the database connection (optional)
	 *
	 * Some adapters (like PGLite) need explicit cleanup.
	 * If not provided, swarm-mail assumes connection is managed externally.
	 */
	close?(): Promise<void>;

	/**
	 * Force a checkpoint to flush WAL to data files (optional)
	 *
	 * PostgreSQL CHECKPOINT command forces write-ahead log (WAL) to be written
	 * to data files, allowing WAL to be recycled. Critical for preventing WAL
	 * bloat in embedded databases like PGLite.
	 *
	 * Root cause from pdf-brain: PGLite accumulated 930 WAL files (930MB) without
	 * explicit CHECKPOINT, causing WASM OOM crash.
	 *
	 * Call after batch operations:
	 * - Migration batches
	 * - Bulk event appends
	 * - Large projection updates
	 *
	 * @example
	 * ```typescript
	 * await db.exec("CREATE TABLE ...");
	 * await db.checkpoint?.(); // Force WAL flush
	 * ```
	 */
	checkpoint?(): Promise<void>;

	/**
	 * Get WAL statistics (optional)
	 *
	 * Returns current size and file count of write-ahead log (WAL) files.
	 * Use for monitoring WAL bloat to prevent WASM OOM crashes in PGLite.
	 *
	 * For PGLite: checks pg_wal directory in dataDir
	 * For PostgreSQL: queries pg_stat_wal (if available)
	 *
	 * @returns WAL stats with size in bytes and file count
	 *
	 * @example
	 * ```typescript
	 * const stats = await db.getWalStats?.();
	 * console.log(`WAL: ${stats.walSize / 1024 / 1024}MB, ${stats.walFileCount} files`);
	 * ```
	 */
	getWalStats?(): Promise<{ walSize: number; walFileCount: number }>;

	/**
	 * Check WAL health against threshold (optional)
	 *
	 * Monitors WAL size and warns when it exceeds a configurable threshold.
	 * Default threshold: 100MB (warns before critical 930MB from pdf-brain crash).
	 *
	 * Returns health status with message describing current WAL state.
	 *
	 * @param thresholdMb - Warning threshold in megabytes (default: 100)
	 * @returns Health result with boolean status and descriptive message
	 *
	 * @example
	 * ```typescript
	 * const health = await db.checkWalHealth?.(100);
	 * if (!health.healthy) {
	 *   console.warn(health.message);
	 *   await db.checkpoint?.(); // Trigger checkpoint
	 * }
	 * ```
	 */
	checkWalHealth?(
		thresholdMb?: number,
	): Promise<{ healthy: boolean; message: string }>;
}

/**
 * Database configuration options
 *
 * Passed to adapter factory functions to create DatabaseAdapter instances.
 */
export interface DatabaseConfig {
	/** Path to database file or connection string */
	path: string;
	/** Optional timeout in milliseconds for queries */
	timeout?: number;
	/** Optional flags for database initialization */
	flags?: {
		/** Create database if it doesn't exist */
		create?: boolean;
		/** Enable foreign key constraints */
		foreignKeys?: boolean;
		/** Enable WAL mode (SQLite) */
		wal?: boolean;
	};
}

/**
 * Type guard to check if adapter supports transactions
 */
export function supportsTransactions(
	adapter: DatabaseAdapter,
): adapter is Required<Pick<DatabaseAdapter, "transaction">> & DatabaseAdapter {
	return typeof adapter.transaction === "function";
}
