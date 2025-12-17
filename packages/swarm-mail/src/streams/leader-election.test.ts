/**
 * Leader Election Tests
 *
 * Tests for the file-based leader election mechanism that prevents
 * PGLite corruption from concurrent multi-process initialization.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  acquireInitLock,
  getLockFilePath,
  isInitializationInProgress,
  forceReleaseLock,
} from "./leader-election";

// ============================================================================
// Test Helpers
// ============================================================================

function testDbPath(prefix = "test"): string {
  return join(tmpdir(), `streams-leader-${prefix}-${randomUUID()}`);
}

let testPaths: string[] = [];

function trackPath(path: string): string {
  testPaths.push(path);
  return path;
}

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
  testPaths = [];
});

afterEach(async () => {
  // Clean up test directories
  for (const path of testPaths) {
    try {
      await forceReleaseLock(path);
      if (existsSync(path)) {
        rmSync(path, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }
  testPaths = [];
});

// ============================================================================
// Tests
// ============================================================================

describe("getLockFilePath", () => {
  it("returns lock file path in parent directory", () => {
    const dbPath = "/tmp/test/streams";
    const lockPath = getLockFilePath(dbPath);
    expect(lockPath).toBe("/tmp/test/streams.lock");
  });
});

describe("acquireInitLock", () => {
  it("acquires lock and returns release function", async () => {
    const dbPath = trackPath(testDbPath("acquire"));
    mkdirSync(dbPath, { recursive: true });

    const release = await acquireInitLock(dbPath);
    expect(typeof release).toBe("function");

    // Lock should be held
    const inProgress = await isInitializationInProgress(dbPath);
    expect(inProgress).toBe(true);

    // Release the lock
    await release();

    // Lock should be released
    const stillInProgress = await isInitializationInProgress(dbPath);
    expect(stillInProgress).toBe(false);
  });

  it("blocks concurrent acquisition until released", async () => {
    const dbPath = trackPath(testDbPath("concurrent"));
    mkdirSync(dbPath, { recursive: true });

    // Acquire first lock
    const release1 = await acquireInitLock(dbPath);

    // Try to acquire second lock (should block)
    let secondAcquired = false;
    const secondPromise = acquireInitLock(dbPath).then((release) => {
      secondAcquired = true;
      return release;
    });

    // Give it a moment - should still be blocked
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(secondAcquired).toBe(false);

    // Release first lock
    await release1();

    // Second should now acquire
    const release2 = await secondPromise;
    expect(secondAcquired).toBe(true);

    await release2();
  });

  it("handles multiple sequential acquisitions", async () => {
    const dbPath = trackPath(testDbPath("sequential"));
    mkdirSync(dbPath, { recursive: true });

    for (let i = 0; i < 3; i++) {
      const release = await acquireInitLock(dbPath);
      await release();
    }

    // Should complete without error
    expect(true).toBe(true);
  });
});

describe("isInitializationInProgress", () => {
  it("returns false when no lock exists", async () => {
    const dbPath = trackPath(testDbPath("no-lock"));
    const inProgress = await isInitializationInProgress(dbPath);
    expect(inProgress).toBe(false);
  });

  it("returns true when lock is held", async () => {
    const dbPath = trackPath(testDbPath("held"));
    mkdirSync(dbPath, { recursive: true });

    const release = await acquireInitLock(dbPath);
    const inProgress = await isInitializationInProgress(dbPath);
    expect(inProgress).toBe(true);

    await release();
  });
});

describe("forceReleaseLock", () => {
  it("releases a held lock", async () => {
    const dbPath = trackPath(testDbPath("force"));
    mkdirSync(dbPath, { recursive: true });

    const release = await acquireInitLock(dbPath);

    // Force release (simulating stale lock cleanup)
    await forceReleaseLock(dbPath);

    // Should be able to acquire again
    const release2 = await acquireInitLock(dbPath);
    await release2();

    // Original release should handle gracefully
    await release(); // Should not throw
  });

  it("handles non-existent lock gracefully", async () => {
    const dbPath = testDbPath("nonexistent");
    // Should not throw
    await forceReleaseLock(dbPath);
    expect(true).toBe(true);
  });
});
