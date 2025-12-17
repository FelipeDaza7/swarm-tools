/**
 * Leader Election for PGLite Multi-Process Access
 *
 * PGLite is single-connection only. When multiple processes (e.g., swarm workers)
 * try to initialize PGLite at the same database path, they corrupt each other.
 *
 * This module implements file-based leader election:
 * 1. Acquire exclusive lock on .opencode/streams.lock before PGLite init
 * 2. If lock acquired → proceed with initialization
 * 3. If lock fails → wait and retry (another process is initializing)
 * 4. Release lock after initialization (PGLite handles its own internal locking)
 *
 * The lock is only held during initialization, not during normal operation.
 * This prevents the WASM corruption that occurs when multiple instances
 * try to create/open the same database files simultaneously.
 *
 * @see https://pglite.dev/docs/multi-tab-worker for browser equivalent
 */

import { lock, unlock, check } from "proper-lockfile";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

/** Lock file name */
const LOCK_FILE = "streams.lock";

/** Maximum time to wait for lock (ms) */
const LOCK_TIMEOUT_MS = 30000;

/** Retry interval when lock is held (ms) */
const LOCK_RETRY_INTERVAL_MS = 100;

/** Stale lock threshold (ms) - if lock is older than this, consider it stale */
const STALE_THRESHOLD_MS = 60000;

/**
 * Get the lock file path for a database path
 */
export function getLockFilePath(dbPath: string): string {
  const dir = dirname(dbPath);
  return join(dir, LOCK_FILE);
}

/**
 * Ensure lock file exists (proper-lockfile requires the file to exist)
 */
function ensureLockFile(lockPath: string): void {
  const dir = dirname(lockPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(lockPath)) {
    writeFileSync(lockPath, `${process.pid}\n`);
  }
}

/**
 * Acquire exclusive lock for database initialization
 *
 * @param dbPath - Path to the database directory
 * @returns Release function to call when done
 * @throws Error if lock cannot be acquired within timeout
 */
export async function acquireInitLock(
  dbPath: string
): Promise<() => Promise<void>> {
  const lockPath = getLockFilePath(dbPath);
  ensureLockFile(lockPath);

  const startTime = Date.now();

  while (true) {
    try {
      // Try to acquire lock
      const release = await lock(lockPath, {
        stale: STALE_THRESHOLD_MS,
        retries: 0, // We handle retries ourselves for better timeout control
      });

      // Lock acquired! Return release function
      return async () => {
        try {
          await release();
        } catch (err) {
          // Ignore release errors (lock may have been stolen if stale)
          console.warn(
            `[swarm-mail] Warning: Failed to release init lock: ${(err as Error).message}`
          );
        }
      };
    } catch (err) {
      const error = err as Error;

      // Check if we've exceeded timeout
      if (Date.now() - startTime > LOCK_TIMEOUT_MS) {
        throw new Error(
          `Failed to acquire database init lock after ${LOCK_TIMEOUT_MS}ms. ` +
            `Another process may be stuck. Lock file: ${lockPath}. ` +
            `Original error: ${error.message}`
        );
      }

      // Lock is held by another process, wait and retry
      await new Promise((resolve) =>
        setTimeout(resolve, LOCK_RETRY_INTERVAL_MS)
      );
    }
  }
}

/**
 * Check if the database is currently being initialized by another process
 *
 * @param dbPath - Path to the database directory
 * @returns true if lock is held (initialization in progress)
 */
export async function isInitializationInProgress(
  dbPath: string
): Promise<boolean> {
  const lockPath = getLockFilePath(dbPath);

  if (!existsSync(lockPath)) {
    return false;
  }

  try {
    const isLocked = await check(lockPath, {
      stale: STALE_THRESHOLD_MS,
    });
    return isLocked;
  } catch {
    // If check fails, assume not locked
    return false;
  }
}

/**
 * Force release a stale lock (use with caution)
 *
 * @param dbPath - Path to the database directory
 */
export async function forceReleaseLock(dbPath: string): Promise<void> {
  const lockPath = getLockFilePath(dbPath);

  if (!existsSync(lockPath)) {
    return;
  }

  try {
    await unlock(lockPath);
  } catch {
    // Ignore errors - lock may not exist or already released
  }
}
