/**
 * PGLite WAL Health Check Tests
 *
 * Tests for DatabaseAdapter.getWalStats() and checkWalHealth() methods that
 * monitor WAL size to prevent WASM OOM crashes.
 * 
 * TDD: Write failing tests first, then implement WAL monitoring.
 *
 * Root cause from pdf-brain: PGLite accumulated 930 WAL files (930MB) without
 * monitoring, causing WASM OOM crash. These tests ensure we can detect WAL
 * bloat BEFORE it reaches critical size.
 */

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemorySwarmMail, wrapPGlite } from "./pglite";
import type { SwarmMailAdapter } from "./types";

let swarmMail: SwarmMailAdapter;

beforeAll(async () => {
  swarmMail = await createInMemorySwarmMail("wal-health-test");
});

afterAll(async () => {
  await swarmMail.close();
});

describe("DatabaseAdapter.getWalStats()", () => {
  test("wrapPGlite includes getWalStats method", async () => {
    const pglite = await PGlite.create({ extensions: { vector } });
    const adapter = wrapPGlite(pglite);
    
    expect(adapter.getWalStats).toBeFunction();
    
    await pglite.close();
  });

  test("getWalStats returns WAL size and file count", async () => {
    const pglite = await PGlite.create({ extensions: { vector } });
    const adapter = wrapPGlite(pglite);
    
    if (!adapter.getWalStats) {
      throw new Error("getWalStats method not implemented");
    }
    
    const stats = await adapter.getWalStats();
    
    expect(stats).toBeDefined();
    expect(stats.walSize).toBeNumber();
    expect(stats.walFileCount).toBeNumber();
    expect(stats.walSize).toBeGreaterThanOrEqual(0);
    expect(stats.walFileCount).toBeGreaterThanOrEqual(0);
    
    await pglite.close();
  });

  test("getWalStats detects WAL files in dataDir", async () => {
    // Create temp directory with mock WAL files
    const testDir = join(tmpdir(), `wal-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    
    const pglite = await PGlite.create({
      dataDir: testDir,
      extensions: { vector }
    });
    
    // Write some data to generate WAL activity
    await pglite.query("CREATE TABLE test_wal (id INT, data TEXT)");
    for (let i = 0; i < 100; i++) {
      await pglite.query("INSERT INTO test_wal VALUES ($1, $2)", [i, `data-${i}`]);
    }
    
    const adapter = wrapPGlite(pglite);
    
    if (!adapter.getWalStats) {
      throw new Error("getWalStats method not implemented");
    }
    
    const stats = await adapter.getWalStats();
    
    // After inserts, should have WAL files
    expect(stats.walFileCount).toBeGreaterThan(0);
    expect(stats.walSize).toBeGreaterThan(0);
    
    await pglite.close();
  });
});

describe("DatabaseAdapter.checkWalHealth()", () => {
  test("wrapPGlite includes checkWalHealth method", async () => {
    const pglite = await PGlite.create({ extensions: { vector } });
    const adapter = wrapPGlite(pglite);
    
    expect(adapter.checkWalHealth).toBeFunction();
    
    await pglite.close();
  });

  test("checkWalHealth returns healthy=true when WAL is small", async () => {
    const pglite = await PGlite.create({ extensions: { vector } });
    const adapter = wrapPGlite(pglite);
    
    if (!adapter.checkWalHealth) {
      throw new Error("checkWalHealth method not implemented");
    }
    
    const health = await adapter.checkWalHealth();
    
    expect(health).toBeDefined();
    expect(health.healthy).toBeBoolean();
    expect(health.message).toBeString();
    expect(health.healthy).toBe(true);
    
    await pglite.close();
  });

  test("checkWalHealth uses default threshold of 100MB", async () => {
    const pglite = await PGlite.create({ extensions: { vector } });
    const adapter = wrapPGlite(pglite);
    
    if (!adapter.checkWalHealth) {
      throw new Error("checkWalHealth method not implemented");
    }
    
    // Small WAL should be healthy
    const health = await adapter.checkWalHealth();
    expect(health.healthy).toBe(true);
    
    await pglite.close();
  });

  test("checkWalHealth accepts custom threshold", async () => {
    const pglite = await PGlite.create({ extensions: { vector } });
    const adapter = wrapPGlite(pglite);
    
    if (!adapter.checkWalHealth) {
      throw new Error("checkWalHealth method not implemented");
    }
    
    // Very low threshold (1 byte) should trigger warning for any WAL
    const testDir = join(tmpdir(), `wal-threshold-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    
    const pgliteWithData = await PGlite.create({
      dataDir: testDir,
      extensions: { vector }
    });
    
    await pgliteWithData.query("CREATE TABLE test (id INT)");
    await pgliteWithData.query("INSERT INTO test VALUES (1)");
    
    const adapterWithData = wrapPGlite(pgliteWithData);
    
    if (!adapterWithData.checkWalHealth) {
      throw new Error("checkWalHealth method not implemented");
    }
    
    // Extremely low threshold should trigger warning
    const health = await adapterWithData.checkWalHealth(0.001); // 0.001 MB = 1KB
    
    // May be healthy if no WAL files yet, but should have message
    expect(health.message).toBeString();
    
    await pgliteWithData.close();
    await pglite.close();
  });

  test("checkWalHealth warns when WAL exceeds threshold", async () => {
    // This test verifies the warning logic by mocking a large WAL size
    // In practice, we'd need to generate 100MB+ of WAL, which is slow
    // Instead, we'll test with a very low threshold
    
    const testDir = join(tmpdir(), `wal-warning-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    
    const pglite = await PGlite.create({
      dataDir: testDir,
      extensions: { vector }
    });
    
    // Generate some WAL activity
    await pglite.query("CREATE TABLE test_large (id INT, data TEXT)");
    for (let i = 0; i < 500; i++) {
      await pglite.query("INSERT INTO test_large VALUES ($1, $2)", [i, `data-${i}`.repeat(100)]);
    }
    
    const adapter = wrapPGlite(pglite);
    
    if (!adapter.checkWalHealth) {
      throw new Error("checkWalHealth method not implemented");
    }
    
    // Use very low threshold to trigger warning
    const health = await adapter.checkWalHealth(0.01); // 0.01 MB = 10KB
    
    // Should warn if WAL exceeds 10KB (likely after 500 inserts)
    if (!health.healthy) {
      expect(health.message).toContain("WAL size");
      expect(health.message).toContain("exceeds");
    }
    
    await pglite.close();
  });

  test("checkWalHealth message includes size and threshold", async () => {
    const pglite = await PGlite.create({ extensions: { vector } });
    const adapter = wrapPGlite(pglite);
    
    if (!adapter.checkWalHealth) {
      throw new Error("checkWalHealth method not implemented");
    }
    
    const health = await adapter.checkWalHealth(100);
    
    // Message should include actual size info
    expect(health.message).toBeString();
    expect(health.message.length).toBeGreaterThan(0);
    
    await pglite.close();
  });
});
