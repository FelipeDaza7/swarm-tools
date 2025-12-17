/**
 * PGLite Convenience Layer - Simple API for PGLite users
 *
 * This file provides a simplified interface for users who just want to use
 * PGLite without manually setting up adapters. For advanced use cases (custom
 * database, connection pooling, etc.), use createSwarmMailAdapter directly.
 *
 * ## Simple API (this file)
 * ```typescript
 * import { getSwarmMail } from '@opencode/swarm-mail';
 *
 * const swarmMail = await getSwarmMail('/path/to/project');
 * await swarmMail.registerAgent(projectKey, 'agent-name');
 * ```
 *
 * ## Advanced API (adapter pattern)
 * ```typescript
 * import { createSwarmMailAdapter } from '@opencode/swarm-mail';
 * import { createCustomDbAdapter } from './my-adapter';
 *
 * const db = createCustomDbAdapter({ path: './custom.db' });
 * const swarmMail = createSwarmMailAdapter(db, '/path/to/project');
 * ```
 */

import { PGlite } from "@electric-sql/pglite";
import { createSwarmMailAdapter } from "./adapter";
import type { DatabaseAdapter, SwarmMailAdapter } from "./types";
import { existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createSocketAdapter } from "./socket-adapter";
import { isDaemonRunning, startDaemon, healthCheck } from "./daemon";

/**
 * Wrap PGLite to match DatabaseAdapter interface
 *
 * PGLite has query() and exec() methods that match DatabaseAdapter,
 * but TypeScript needs the explicit wrapper for type safety.
 * PGLite's exec() returns Results[] but DatabaseAdapter expects void.
 */
export function wrapPGlite(pglite: PGlite): DatabaseAdapter {
  return {
    query: <T>(sql: string, params?: unknown[]) => pglite.query<T>(sql, params),
    exec: async (sql: string) => {
      await pglite.exec(sql);
    },
    close: () => pglite.close(),
  };
}

/**
 * Generate a short hash for a project path
 *
 * Uses SHA256 and takes first 8 characters for uniqueness.
 *
 * @param projectPath - Project root path
 * @returns 8-character hash string
 */
export function hashProjectPath(projectPath: string): string {
  return createHash("sha256").update(projectPath).digest("hex").slice(0, 8);
}

/**
 * Get a human-readable project identifier with hash suffix
 *
 * Format: `opencode-<project-name>-<hash>`
 * Example: `opencode-my-project-a1b2c3d4`
 *
 * @param projectPath - Project root path
 * @returns Directory name for the project's temp storage
 */
export function getProjectTempDirName(projectPath: string): string {
  const projectName = basename(projectPath)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-") // sanitize for filesystem
    .replace(/-+/g, "-") // collapse multiple dashes
    .slice(0, 32); // limit length
  const hash = hashProjectPath(projectPath);
  return `opencode-${projectName}-${hash}`;
}

/**
 * Get database path in $TMPDIR (ephemeral storage)
 *
 * Streams data is ephemeral coordination state - messages, reservations,
 * agent registrations. It's safe to lose on reboot since:
 * - Beads are git-synced separately in .beads/
 * - Semantic memory is in ~/.opencode/memory/
 * - Agents re-register on session start
 *
 * Path format: `$TMPDIR/opencode-<project-name>-<hash>/streams`
 * Falls back to global `$TMPDIR/opencode-global/streams` if no project path.
 *
 * @param projectPath - Optional project root path
 * @returns Absolute path to database directory
 */
export function getDatabasePath(projectPath?: string): string {
  const tmp = tmpdir();
  
  if (projectPath) {
    const dirName = getProjectTempDirName(projectPath);
    const projectTmpDir = join(tmp, dirName);
    if (!existsSync(projectTmpDir)) {
      mkdirSync(projectTmpDir, { recursive: true });
    }
    return join(projectTmpDir, "streams");
  }
  
  // Global fallback for when no project path is provided
  const globalTmpDir = join(tmp, "opencode-global");
  if (!existsSync(globalTmpDir)) {
    mkdirSync(globalTmpDir, { recursive: true });
  }
  return join(globalTmpDir, "streams");
}

/**
 * Singleton cache for SwarmMail instances
 *
 * Key is database path, value is the adapter + PGLite instance (or socket adapter)
 */
const instances = new Map<
  string,
  { adapter: SwarmMailAdapter; pglite?: PGlite; isSocket?: boolean }
>();

/**
 * Get or create SwarmMail instance for a project
 *
 * Uses singleton pattern - one instance per database path.
 * Safe to call multiple times for the same project.
 *
 * **Socket Mode (SWARM_MAIL_SOCKET=true):**
 * - Checks if daemon is running, starts if needed
 * - Validates health before connecting
 * - Falls back to embedded PGLite on any failure
 *
 * **Embedded Mode (default):**
 * - Uses embedded PGLite database
 * - No daemon required
 *
 * @param projectPath - Optional project root path (defaults to global)
 * @returns SwarmMailAdapter instance
 *
 * @example
 * ```typescript
 * // Project-local database (embedded or socket based on env)
 * const swarmMail = await getSwarmMail('/path/to/project');
 *
 * // Global database (shared across all projects)
 * const swarmMail = await getSwarmMail();
 *
 * // Explicit socket mode
 * process.env.SWARM_MAIL_SOCKET = 'true';
 * const swarmMail = await getSwarmMail('/path/to/project');
 * ```
 */
export async function getSwarmMail(
  projectPath?: string,
): Promise<SwarmMailAdapter> {
  const dbPath = getDatabasePath(projectPath);
  const projectKey = projectPath || dbPath;

  if (!instances.has(dbPath)) {
    // Check for socket mode via env var
    const useSocket = process.env.SWARM_MAIL_SOCKET === 'true';

    if (useSocket) {
      try {
        // Try socket mode with auto-daemon management
        const adapter = await getSwarmMailSocketInternal(projectPath);
        instances.set(dbPath, { adapter, isSocket: true });
        return adapter;
      } catch (error) {
        console.warn(
          `[swarm-mail] Socket mode failed, falling back to embedded PGLite: ${error instanceof Error ? error.message : String(error)}`
        );
        // Fall through to embedded mode
      }
    }

    // Embedded PGlite mode (default or fallback)
    const pglite = new PGlite(dbPath);
    const db = wrapPGlite(pglite);
    const adapter = createSwarmMailAdapter(db, projectKey);
    await adapter.runMigrations();
    instances.set(dbPath, { adapter, pglite });
  }

  return instances.get(dbPath)!.adapter;
}

/**
 * Get SwarmMail instance using socket adapter (explicit socket mode)
 *
 * Always uses socket connection to pglite-server daemon.
 * Auto-starts daemon if not running, validates health before connecting.
 *
 * **Port/Path Resolution:**
 * - Checks SWARM_MAIL_SOCKET_PATH env var for Unix socket
 * - Falls back to TCP on SWARM_MAIL_SOCKET_PORT (default: 5433)
 * - Host defaults to 127.0.0.1
 *
 * @param projectPath - Optional project root path
 * @returns SwarmMailAdapter instance using socket connection
 * @throws Error if daemon fails to start or health check fails
 *
 * @example
 * ```typescript
 * // Unix socket (preferred)
 * process.env.SWARM_MAIL_SOCKET_PATH = '/tmp/swarm-mail.sock';
 * const swarmMail = await getSwarmMailSocket('/path/to/project');
 *
 * // TCP socket
 * process.env.SWARM_MAIL_SOCKET_PORT = '5433';
 * const swarmMail = await getSwarmMailSocket('/path/to/project');
 * ```
 */
export async function getSwarmMailSocket(
  projectPath?: string,
): Promise<SwarmMailAdapter> {
  const dbPath = getDatabasePath(projectPath);

  if (!instances.has(dbPath)) {
    const adapter = await getSwarmMailSocketInternal(projectPath);
    instances.set(dbPath, { adapter, isSocket: true });
  }

  return instances.get(dbPath)!.adapter;
}

/**
 * Internal helper for socket mode setup
 *
 * Handles daemon lifecycle, health check, and adapter creation.
 *
 * @param projectPath - Optional project root path
 * @returns SwarmMailAdapter instance
 * @throws Error if daemon management or connection fails
 */
async function getSwarmMailSocketInternal(
  projectPath?: string,
): Promise<SwarmMailAdapter> {
  const projectKey = projectPath || getDatabasePath(projectPath);
  const dbPath = getDatabasePath(projectPath);

  // Resolve socket path or port from env
  const socketPath = process.env.SWARM_MAIL_SOCKET_PATH;
  const port = process.env.SWARM_MAIL_SOCKET_PORT
    ? Number.parseInt(process.env.SWARM_MAIL_SOCKET_PORT, 10)
    : 5433;
  const host = process.env.SWARM_MAIL_SOCKET_HOST || '127.0.0.1';

  // Check if daemon is running
  const running = await isDaemonRunning(projectPath);

  if (!running) {
    // Start daemon with appropriate connection mode
    const daemonOptions = socketPath
      ? { path: socketPath, dbPath, projectPath }
      : { port, host, dbPath, projectPath };

    await startDaemon(daemonOptions);
  }

  // Health check before connecting
  const healthOptions = socketPath ? { path: socketPath } : { port, host };
  const healthy = await healthCheck(healthOptions);

  if (!healthy) {
    throw new Error(
      `Daemon health check failed after startup (${socketPath ? `socket: ${socketPath}` : `TCP: ${host}:${port}`})`
    );
  }

  // Create socket adapter
  const adapterOptions = socketPath
    ? { path: socketPath }
    : { host, port };

  const db = await createSocketAdapter(adapterOptions);
  const adapter = createSwarmMailAdapter(db, projectKey);
  await adapter.runMigrations();

  return adapter;
}

/**
 * Create in-memory SwarmMail instance (for testing)
 *
 * Not cached - each call creates a new instance.
 * Data is lost when instance is closed or process exits.
 *
 * @param projectKey - Project identifier (defaults to 'test')
 * @returns SwarmMailAdapter instance
 *
 * @example
 * ```typescript
 * const swarmMail = await createInMemorySwarmMail('test-project');
 * await swarmMail.registerAgent('test-project', 'test-agent');
 * // ... test code ...
 * await swarmMail.close();
 * ```
 */
export async function createInMemorySwarmMail(
  projectKey = "test",
): Promise<SwarmMailAdapter> {
  const pglite = new PGlite(); // in-memory
  const db = wrapPGlite(pglite);
  const adapter = createSwarmMailAdapter(db, projectKey);
  await adapter.runMigrations();
  return adapter;
}

/**
 * Close specific SwarmMail instance
 *
 * Closes the database connection and removes from cache.
 *
 * @param projectPath - Optional project root path (defaults to global)
 *
 * @example
 * ```typescript
 * await closeSwarmMail('/path/to/project');
 * ```
 */
export async function closeSwarmMail(projectPath?: string): Promise<void> {
  const dbPath = getDatabasePath(projectPath);
  const instance = instances.get(dbPath);
  if (instance) {
    if (instance.pglite) {
      await instance.pglite.close();
    } else {
      // Socket adapter - close via adapter's close method
      await instance.adapter.close();
    }
    instances.delete(dbPath);
  }
}

/**
 * Close all SwarmMail instances
 *
 * Closes all cached database connections.
 * Useful for cleanup in test teardown or process shutdown.
 *
 * @example
 * ```typescript
 * // Test teardown
 * afterAll(async () => {
 *   await closeAllSwarmMail();
 * });
 * ```
 */
export async function closeAllSwarmMail(): Promise<void> {
  for (const [path, instance] of instances) {
    if (instance.pglite) {
      await instance.pglite.close();
    } else {
      // Socket adapter - close via adapter's close method
      await instance.adapter.close();
    }
    instances.delete(path);
  }
}

// Re-export PGlite for consumers who need it
export { PGlite };
