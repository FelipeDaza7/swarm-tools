import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { StalenessDetector } from "./staleness-detector.js";
import { createInMemorySwarmMailLibSQL } from "../libsql.convenience.js";
import type { SwarmMailAdapter } from "../types/adapter.js";

/**
 * TDD Pattern for Staleness Detector (ADR-010 Section 4.6)
 * 
 * Staleness definition: file_mtime > last_indexed_at + 300 (5 min grace period)
 * 
 * Test Flow:
 * 1. RED: Test staleness detection logic
 * 2. GREEN: Implement mtime comparison
 * 3. REFACTOR: Add grace period (300s)
 * 4. RED: Test bulk staleness check
 * 5. GREEN: Optimize with batch queries
 * 
 * Note: Tests use real timestamps (no mocking) since Bun doesn't support vi.setSystemTime
 */

describe("StalenessDetector", () => {
  let adapter: SwarmMailAdapter;
  let detector: StalenessDetector;

  beforeAll(async () => {
    adapter = await createInMemorySwarmMailLibSQL("staleness-detector-test");
    detector = new StalenessDetector(adapter);
  });

  afterAll(async () => {
    await adapter.close();
  });

  describe("recordIndexed", () => {
    test("stores initial index state for a session file", async () => {
      const path = "/path/to/ses_123.jsonl";
      const mtime = 1000;
      const messageCount = 10;

      await detector.recordIndexed(path, { mtime, messageCount });

      const state = await detector.getIndexState(path);
      expect(state).toBeDefined();
      expect(state?.source_path).toBe(path);
      expect(state?.file_mtime).toBe(mtime);
      expect(state?.message_count).toBe(messageCount);
      expect(state?.last_indexed_at).toBeGreaterThan(0);
    });

    test("updates existing index state when file is re-indexed", async () => {
      const path = "/path/to/ses_456.jsonl";
      
      // First index
      await detector.recordIndexed(path, { mtime: 1000, messageCount: 5 });
      const firstState = await detector.getIndexState(path);
      
      // Wait to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Re-index with updated data
      await detector.recordIndexed(path, { mtime: 2000, messageCount: 10 });
      const secondState = await detector.getIndexState(path);

      expect(secondState?.file_mtime).toBe(2000);
      expect(secondState?.message_count).toBe(10);
      expect(secondState?.last_indexed_at).toBeGreaterThanOrEqual(firstState?.last_indexed_at ?? 0);
    });
  });

  describe("checkStaleness - grace period logic", () => {
    test("reports file as stale when mtime > file_mtime + 300s", async () => {
      const path = "/path/to/ses_stale.jsonl";
      const now = Math.floor(Date.now() / 1000);
      
      // Index at current time with old mtime
      const oldMtime = now - 500; // File was modified 500s ago
      await detector.recordIndexed(path, { mtime: oldMtime, messageCount: 5 });

      // File modified 400s after index (beyond 300s grace)
      const newMtime = oldMtime + 400;
      
      const isStale = await detector.checkStaleness(path, { currentMtime: newMtime });
      expect(isStale).toBe(true);
    });

    test("reports file as fresh when mtime within 300s grace period", async () => {
      const path = "/path/to/ses_fresh.jsonl";
      const now = Math.floor(Date.now() / 1000);
      
      // Index with mtime = now - 100
      const mtime = now - 100;
      await detector.recordIndexed(path, { mtime, messageCount: 5 });

      // File modified 200s later (within 300s grace)
      const newMtime = mtime + 200;
      
      const isStale = await detector.checkStaleness(path, { currentMtime: newMtime });
      expect(isStale).toBe(false);
    });

    test("reports file as fresh when mtime exactly at grace period boundary", async () => {
      const path = "/path/to/ses_boundary.jsonl";
      const now = Math.floor(Date.now() / 1000);
      
      // Index with old mtime
      const mtime = now - 500;
      await detector.recordIndexed(path, { mtime, messageCount: 5 });

      // File modified exactly 300s later (boundary)
      const newMtime = mtime + 300;
      
      const isStale = await detector.checkStaleness(path, { currentMtime: newMtime });
      // Boundary should be considered fresh (<=)
      expect(isStale).toBe(false);
    });

    test("reports file as fresh when mtime unchanged", async () => {
      const path = "/path/to/ses_unchanged.jsonl";
      const now = Math.floor(Date.now() / 1000);
      
      const mtime = now - 100;
      await detector.recordIndexed(path, { mtime, messageCount: 5 });

      // File not modified
      const isStale = await detector.checkStaleness(path, { currentMtime: mtime });
      expect(isStale).toBe(false);
    });

    test("handles file that was never indexed", async () => {
      const path = "/path/to/never_indexed.jsonl";
      const currentMtime = Math.floor(Date.now() / 1000);

      const isStale = await detector.checkStaleness(path, { currentMtime });
      // Never indexed = stale
      expect(isStale).toBe(true);
    });
  });

  describe("checkBulkStaleness - batch optimization", () => {
    test("checks staleness for multiple files in one query", async () => {
      const now = Math.floor(Date.now() / 1000);
      const baseMtime = now - 1000;
      
      const files = [
        { path: "/path/to/ses_1.jsonl", mtime: baseMtime },
        { path: "/path/to/ses_2.jsonl", mtime: baseMtime },
        { path: "/path/to/ses_3.jsonl", mtime: baseMtime },
      ];

      // Index all files
      for (const file of files) {
        await detector.recordIndexed(file.path, { mtime: file.mtime, messageCount: 5 });
      }

      // Check with different mtimes
      const filesToCheck = [
        { path: "/path/to/ses_1.jsonl", currentMtime: baseMtime + 500 }, // Stale (500s > 300s)
        { path: "/path/to/ses_2.jsonl", currentMtime: baseMtime + 200 }, // Fresh (200s < 300s)
        { path: "/path/to/ses_3.jsonl", currentMtime: baseMtime },       // Fresh (no change)
      ];

      const results = await detector.checkBulkStaleness(filesToCheck);

      expect(results).toHaveLength(3);
      expect(results.find(r => r.path === "/path/to/ses_1.jsonl")?.isStale).toBe(true);
      expect(results.find(r => r.path === "/path/to/ses_2.jsonl")?.isStale).toBe(false);
      expect(results.find(r => r.path === "/path/to/ses_3.jsonl")?.isStale).toBe(false);
    });

    test("handles mix of indexed and never-indexed files", async () => {
      const now = Math.floor(Date.now() / 1000);
      const indexedFile = { path: "/path/to/indexed.jsonl", mtime: now - 100 };
      const neverIndexedFile = { path: "/path/to/never.jsonl", currentMtime: now };

      // Index only one file
      await detector.recordIndexed(indexedFile.path, { mtime: indexedFile.mtime, messageCount: 5 });

      const results = await detector.checkBulkStaleness([
        { path: indexedFile.path, currentMtime: indexedFile.mtime },
        neverIndexedFile,
      ]);

      expect(results).toHaveLength(2);
      expect(results.find(r => r.path === indexedFile.path)?.isStale).toBe(false);
      expect(results.find(r => r.path === neverIndexedFile.path)?.isStale).toBe(true);
    });

    test("returns empty array for empty input", async () => {
      const results = await detector.checkBulkStaleness([]);
      expect(results).toHaveLength(0);
    });
  });

  describe("getStaleFiles - convenience method", () => {
    test("returns only stale files from bulk check", async () => {
      const now = Math.floor(Date.now() / 1000);
      const baseMtime = now - 1000;
      
      const files = [
        { path: "/path/to/fresh.jsonl", mtime: baseMtime, currentMtime: baseMtime },
        { path: "/path/to/stale.jsonl", mtime: baseMtime, currentMtime: baseMtime + 500 },
      ];

      for (const file of files) {
        await detector.recordIndexed(file.path, { mtime: file.mtime, messageCount: 5 });
      }

      const staleFiles = await detector.getStaleFiles(
        files.map(f => ({ path: f.path, currentMtime: f.currentMtime }))
      );

      expect(staleFiles).toHaveLength(1);
      expect(staleFiles[0]).toBe("/path/to/stale.jsonl");
    });

    test("returns all files if all are stale", async () => {
      const now = Math.floor(Date.now() / 1000);
      const baseMtime = now - 1000;
      
      const files = [
        { path: "/path/to/stale1.jsonl", mtime: baseMtime, currentMtime: baseMtime + 400 },
        { path: "/path/to/stale2.jsonl", mtime: baseMtime, currentMtime: baseMtime + 500 },
      ];

      for (const file of files) {
        await detector.recordIndexed(file.path, { mtime: file.mtime, messageCount: 5 });
      }

      const staleFiles = await detector.getStaleFiles(
        files.map(f => ({ path: f.path, currentMtime: f.currentMtime }))
      );

      expect(staleFiles).toHaveLength(2);
      expect(staleFiles).toContain("/path/to/stale1.jsonl");
      expect(staleFiles).toContain("/path/to/stale2.jsonl");
    });
  });
});
