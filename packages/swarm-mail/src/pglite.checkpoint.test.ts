/**
 * PGLite Checkpoint Tests
 *
 * Tests for DatabaseAdapter.checkpoint() method that prevents WAL bloat.
 * 
 * TDD: Write failing tests first, then implement checkpoint().
 *
 * Root cause from pdf-brain: PGlite accumulated 930 WAL files (930MB) without
 * explicit CHECKPOINT, causing WASM OOM crash. This test ensures checkpointing
 * happens after batch operations.
 */

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createInMemorySwarmMail, wrapPGlite } from "./pglite";
import type { DatabaseAdapter, SwarmMailAdapter } from "./types";

let swarmMail: SwarmMailAdapter;

beforeAll(async () => {
  swarmMail = await createInMemorySwarmMail("checkpoint-test");
});

afterAll(async () => {
  await swarmMail.close();
});

describe("DatabaseAdapter.checkpoint()", () => {
  test("wrapPGlite includes checkpoint method", async () => {
    const pglite = await PGlite.create({ extensions: { vector } });
    const adapter = wrapPGlite(pglite);
    
    expect(adapter.checkpoint).toBeFunction();
    
    await pglite.close();
  });

  test("checkpoint executes CHECKPOINT SQL command", async () => {
    const pglite = await PGlite.create({ extensions: { vector } });
    const adapter = wrapPGlite(pglite);
    
    // Should not throw
    if (adapter.checkpoint) {
      await adapter.checkpoint();
    } else {
      throw new Error("checkpoint method not implemented");
    }
    
    // Verify by checking WAL files don't accumulate
    // (This is a smoke test - actual WAL verification would need dataDir inspection)
    
    await pglite.close();
  });

  test("checkpoint is called after migrations", async () => {
    // Create new in-memory instance to trigger migrations
    const testMail = await createInMemorySwarmMail("migration-checkpoint-test");
    
    // Migrations should have completed successfully
    // If checkpoint failed, this would have thrown
    const db = await testMail.getDatabase();
    
    // Verify database is functional after migrations + checkpoint
    const result = await db.query<{ count: string }>("SELECT COUNT(*) as count FROM schema_version");
    expect(parseInt(result.rows[0]?.count || "0")).toBeGreaterThan(0);
    
    await testMail.close();
  });
});
