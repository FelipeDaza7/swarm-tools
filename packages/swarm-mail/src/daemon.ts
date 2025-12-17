/**
 * Daemon Lifecycle Management for pglite-server
 *
 * Provides start/stop/health functionality for the pglite-server daemon process.
 * Uses detached child_process for background operation with PID file tracking.
 *
 * ## Usage
 * ```typescript
 * import { startDaemon, stopDaemon, isDaemonRunning, healthCheck } from 'swarm-mail/daemon';
 *
 * // Start daemon
 * const { pid, port } = await startDaemon({ port: 5433 });
 *
 * // Check health
 * const healthy = await healthCheck({ port: 5433 });
 *
 * // Stop daemon
 * await stopDaemon('/path/to/project');
 * ```
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabasePath, getProjectTempDirName } from "./pglite";

/**
 * Daemon start options
 */
export interface DaemonOptions {
  /** TCP port to bind (default: 5433) */
  port?: number;
  /** Host to bind (default: 127.0.0.1) */
  host?: string;
  /** Unix socket path (alternative to port/host) */
  path?: string;
  /** Database path (default: project .opencode/streams or ~/.opencode/streams) */
  dbPath?: string;
  /** Project path for PID file location (default: global ~/.opencode) */
  projectPath?: string;
}

/**
 * Daemon info returned by startDaemon
 */
export interface DaemonInfo {
  /** Process ID */
  pid: number;
  /** TCP port (if using TCP) */
  port?: number;
  /** Unix socket path (if using socket) */
  socketPath?: string;
}

/**
 * Get PID file path for a project
 *
 * Stores PID file in $TMPDIR alongside the streams database.
 * Path format: `$TMPDIR/opencode-<project-name>-<hash>/pglite-server.pid`
 * Falls back to global `$TMPDIR/opencode-global/pglite-server.pid`
 *
 * @param projectPath - Optional project root path
 * @returns Absolute path to PID file
 */
export function getPidFilePath(projectPath?: string): string {
  const tmp = tmpdir();
  
  if (projectPath) {
    const dirName = getProjectTempDirName(projectPath);
    const projectTmpDir = join(tmp, dirName);
    if (!existsSync(projectTmpDir)) {
      mkdirSync(projectTmpDir, { recursive: true });
    }
    return join(projectTmpDir, "pglite-server.pid");
  }
  
  // Global fallback
  const globalTmpDir = join(tmp, "opencode-global");
  if (!existsSync(globalTmpDir)) {
    mkdirSync(globalTmpDir, { recursive: true });
  }
  return join(globalTmpDir, "pglite-server.pid");
}

/**
 * Check if a process is alive
 *
 * Uses kill(pid, 0) which checks if process exists without sending a signal.
 *
 * @param pid - Process ID to check
 * @returns true if process is running
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    ) {
      return false; // No such process
    }
    // EPERM means process exists but we don't have permission to signal it
    // Still counts as "alive" for our purposes
    return true;
  }
}

/**
 * Read PID from PID file
 *
 * @param projectPath - Optional project root path
 * @returns Process ID, or null if file doesn't exist or is invalid
 */
async function readPidFile(projectPath?: string): Promise<number | null> {
  const pidFilePath = getPidFilePath(projectPath);
  if (!existsSync(pidFilePath)) {
    return null;
  }
  try {
    const content = await readFile(pidFilePath, "utf-8");
    const pid = Number.parseInt(content.trim(), 10);
    if (Number.isNaN(pid) || pid <= 0) {
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

/**
 * Write PID to PID file
 *
 * @param pid - Process ID
 * @param projectPath - Optional project root path
 */
async function writePidFile(pid: number, projectPath?: string): Promise<void> {
  const pidFilePath = getPidFilePath(projectPath);
  await writeFile(pidFilePath, pid.toString(), "utf-8");
}

/**
 * Delete PID file
 *
 * @param projectPath - Optional project root path
 */
async function deletePidFile(projectPath?: string): Promise<void> {
  const pidFilePath = getPidFilePath(projectPath);
  try {
    await unlink(pidFilePath);
  } catch {
    // Ignore errors - file may not exist
  }
}

/**
 * Wait for condition with timeout
 *
 * Polls a condition function until it returns true or timeout is reached.
 *
 * @param condition - Async function that returns true when ready
 * @param timeoutMs - Maximum wait time in milliseconds
 * @param intervalMs - Polling interval in milliseconds
 * @returns true if condition met, false if timeout
 */
async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 100,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/**
 * Check if daemon is running
 *
 * Checks both PID file existence and process liveness.
 *
 * @param projectPath - Optional project root path
 * @returns true if daemon is running
 *
 * @example
 * ```typescript
 * if (!await isDaemonRunning()) {
 *   await startDaemon();
 * }
 * ```
 */
export async function isDaemonRunning(projectPath?: string): Promise<boolean> {
  const pid = await readPidFile(projectPath);
  if (!pid) {
    return false;
  }
  return isProcessAlive(pid);
}

/**
 * Health check - verify daemon is responding
 *
 * Connects to the daemon and runs SELECT 1 query.
 * Times out after 5 seconds.
 *
 * @param options - Connection options (port/host or path)
 * @returns true if daemon is healthy
 *
 * @example
 * ```typescript
 * const healthy = await healthCheck({ port: 5433 });
 * if (!healthy) {
 *   console.error('Daemon not responding');
 * }
 * ```
 */
export async function healthCheck(
  options: Pick<DaemonOptions, "port" | "host" | "path">,
): Promise<boolean> {
  try {
    // Dynamic import to avoid bundling postgres.js in library consumers
    const postgres = await import("postgres").then((m) => m.default);

    const sql = options.path
      ? postgres({ path: options.path })
      : postgres({
          host: options.host || "127.0.0.1",
          port: options.port || 5433,
          max: 1, // Single connection for health check
        });

    try {
      await Promise.race([
        sql`SELECT 1`,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Health check timeout")), 5000),
        ),
      ]);
      return true;
    } finally {
      await sql.end();
    }
  } catch {
    return false;
  }
}

/**
 * Start pglite-server daemon
 *
 * Spawns pglite-server as a detached background process.
 * Writes PID file and waits for server to be ready via health check.
 *
 * If daemon is already running, returns existing daemon info.
 *
 * @param options - Daemon configuration
 * @returns Daemon info (PID and connection details)
 * @throws Error if daemon fails to start
 *
 * @example
 * ```typescript
 * // Start with TCP port
 * const { pid, port } = await startDaemon({ port: 5433 });
 *
 * // Start with Unix socket
 * const { pid, socketPath } = await startDaemon({
 *   path: '/tmp/swarm-mail-pglite.sock'
 * });
 *
 * // Start with custom database path
 * const { pid, port } = await startDaemon({
 *   port: 5433,
 *   dbPath: '/custom/path/to/db'
 * });
 * ```
 */
export async function startDaemon(
  options: DaemonOptions = {},
): Promise<DaemonInfo> {
  const { port = 5433, host = "127.0.0.1", path, dbPath, projectPath } = options;

  // Check if daemon is already running
  if (await isDaemonRunning(projectPath)) {
    const pid = await readPidFile(projectPath);
    if (!pid) {
      throw new Error("Daemon appears to be running but PID file is invalid");
    }
    return {
      pid,
      port: path ? undefined : port,
      socketPath: path,
    };
  }

  // Determine database path
  const finalDbPath = dbPath || getDatabasePath(projectPath);

  // Build command arguments
  const args: string[] = [`--db=${finalDbPath}`];
  if (path) {
    args.push(`--path=${path}`);
  } else {
    args.push(`--port=${port}`);
    args.push(`--host=${host}`);
  }

  // Spawn detached process
  const child = spawn("pglite-server", args, {
    detached: true,
    stdio: "ignore", // Don't inherit stdio - daemon runs in background
  });

  // Unref so parent process can exit
  child.unref();

  if (!child.pid) {
    throw new Error("Failed to spawn pglite-server - no PID returned");
  }

  // Write PID file
  await writePidFile(child.pid, projectPath);

  // Wait for server to be ready (health check)
  const healthOptions = path ? { path } : { port, host };
  const ready = await waitFor(
    () => healthCheck(healthOptions),
    10000, // 10 second timeout
  );

  if (!ready) {
    // Clean up PID file if health check fails
    await deletePidFile(projectPath);
    throw new Error(
      "pglite-server failed to start - health check timeout after 10s",
    );
  }

  return {
    pid: child.pid,
    port: path ? undefined : port,
    socketPath: path,
  };
}

/**
 * Stop pglite-server daemon
 *
 * Sends SIGTERM to the daemon process and waits for clean shutdown.
 * Cleans up PID file after process exits.
 *
 * If daemon is not running, this is a no-op (not an error).
 *
 * @param projectPath - Optional project root path
 * @throws Error if daemon doesn't stop within timeout
 *
 * @example
 * ```typescript
 * await stopDaemon('/path/to/project');
 * ```
 */
export async function stopDaemon(projectPath?: string): Promise<void> {
  const pid = await readPidFile(projectPath);
  if (!pid) {
    // No PID file - daemon not running
    return;
  }

  if (!isProcessAlive(pid)) {
    // Process already dead - just clean up PID file
    await deletePidFile(projectPath);
    return;
  }

  // Send SIGTERM
  try {
    process.kill(pid, "SIGTERM");
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    ) {
      // Process already gone
      await deletePidFile(projectPath);
      return;
    }
    throw error;
  }

  // Wait for process to exit
  const stopped = await waitFor(() => Promise.resolve(!isProcessAlive(pid)), 5000);

  if (!stopped) {
    // Force kill if SIGTERM didn't work
    try {
      process.kill(pid, "SIGKILL");
      await waitFor(() => Promise.resolve(!isProcessAlive(pid)), 2000);
    } catch {
      // Ignore errors on SIGKILL
    }
  }

  // Clean up PID file
  await deletePidFile(projectPath);
}
