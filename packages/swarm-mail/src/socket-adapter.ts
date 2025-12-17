/**
 * Socket Adapter - postgres.js wrapper for DatabaseAdapter interface
 *
 * Wraps postgres.js client to match DatabaseAdapter interface, supporting both
 * TCP (host/port) and Unix socket (path) connections.
 *
 * ## Usage
 * ```typescript
 * // TCP connection
 * const sql = postgres({ host: '127.0.0.1', port: 5432 });
 * const db = wrapPostgres(sql);
 *
 * // Unix socket connection
 * const sql = postgres({ path: '/tmp/pglite.sock' });
 * const db = wrapPostgres(sql);
 *
 * // Factory function
 * const db = await createSocketAdapter({ path: '/tmp/pglite.sock' });
 * ```
 */

import postgres from "postgres";
import type { DatabaseAdapter, QueryResult } from "./types";

/**
 * Options for socket adapter creation
 */
export interface SocketAdapterOptions {
	/** Unix socket path */
	path?: string;
	/** TCP host */
	host?: string;
	/** TCP port */
	port?: number;
	/** Connection timeout in seconds */
	timeout?: number;
	/** Maximum number of connections */
	max?: number;
}

/**
 * Wrap postgres.js client to match DatabaseAdapter interface
 *
 * postgres.js uses tagged template literals for queries, but DatabaseAdapter
 * uses (sql, params) signature. This adapter bridges the difference.
 *
 * @param sql - postgres.js client instance
 * @returns DatabaseAdapter compatible wrapper
 *
 * @example
 * ```typescript
 * const sql = postgres({ path: '/tmp/pglite.sock' });
 * const db = wrapPostgres(sql);
 * const result = await db.query<{ id: number }>(
 *   "SELECT id FROM agents WHERE name = $1",
 *   ["BlueLake"]
 * );
 * ```
 */
export function wrapPostgres(
	sql: postgres.Sql<Record<string, unknown>>,
): DatabaseAdapter {
	return {
		query: async <T>(sqlString: string, params?: unknown[]) => {
			// postgres.js uses .unsafe() for raw SQL with parameters
			// It returns an array directly (not wrapped in { rows: [] })
			// Type assertion needed because postgres.js unsafe returns Row[] but we need T[]
			const rows = (await sql.unsafe(sqlString, params ?? [])) as unknown as T[];
			return { rows } as QueryResult<T>;
		},

		exec: async (sqlString: string) => {
			// exec doesn't return results, just execute the SQL
			await sql.unsafe(sqlString);
		},

	transaction: async <T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> => {
		// postgres.js begin() returns a transaction object that behaves like sql
		// We need to wrap it in the same way
		// Type assertion needed because postgres.js begin() unwraps promise arrays
		const result = await sql.begin(async (transaction: postgres.Sql<Record<string, unknown>>) => {
			const txAdapter = wrapPostgres(transaction);
			return await fn(txAdapter);
		});
		return result as T;
	},

		close: async () => {
			await sql.end();
		},
	};
}

/**
 * Create socket adapter with connection validation
 *
 * Factory function that creates postgres.js client and wraps it.
 * Validates connection before returning adapter.
 *
 * @param options - Socket connection options (path OR host/port)
 * @returns DatabaseAdapter instance
 * @throws Error if connection fails or invalid options
 *
 * @example
 * ```typescript
 * // Unix socket
 * const db = await createSocketAdapter({ path: '/tmp/pglite.sock' });
 *
 * // TCP connection
 * const db = await createSocketAdapter({ host: '127.0.0.1', port: 5432 });
 * ```
 */
export async function createSocketAdapter(
	options: SocketAdapterOptions,
): Promise<DatabaseAdapter> {
	// Validate options: must have either path OR (host + port)
	if (!options.path && (!options.host || !options.port)) {
		throw new Error(
			"Socket adapter requires either 'path' (unix socket) or 'host' + 'port' (TCP)",
		);
	}

	if (options.path && (options.host || options.port)) {
		throw new Error(
			"Socket adapter: cannot specify both 'path' and 'host'/'port'. Choose one connection method.",
		);
	}

	try {
		// Create postgres.js client
		const sql = postgres({
			path: options.path,
			host: options.host,
			port: options.port,
			connect_timeout: options.timeout,
			max: options.max ?? 10,
			// Disable connection pooling idle timeout - keep connections alive
			idle_timeout: 0,
			// Disable max lifetime - connections persist until explicitly closed
			max_lifetime: null,
		});

		// Validate connection with a simple query
		await sql`SELECT 1 as ping`;

		// Wrap and return
		return wrapPostgres(sql);
	} catch (error) {
		const connType = options.path ? `unix socket: ${options.path}` : `TCP: ${options.host}:${options.port}`;
		throw new Error(
			`Failed to connect to PostgreSQL via ${connType}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
