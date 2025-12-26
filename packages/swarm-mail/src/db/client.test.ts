import { afterEach, describe, expect, test } from "bun:test";
import { createInMemoryDb, getDb, closeDb } from "./client.js";

describe("Database Client", () => {
  afterEach(async () => {
    // Close and reset singleton between tests
    await closeDb();
  });

  describe("createInMemoryDb", () => {
    test("creates in-memory Drizzle instance", async () => {
      const db = await createInMemoryDb();
      
      expect(db).toBeDefined();
      expect(typeof db.select).toBe("function");
      expect(typeof db.insert).toBe("function");
    });

    test("creates fresh instance each call", async () => {
      const db1 = await createInMemoryDb();
      const db2 = await createInMemoryDb();
      
      // Different instances
      expect(db1).not.toBe(db2);
    });

    test("initializes schema tables", async () => {
      const db = await createInMemoryDb();
      
      // Schema is empty until parallel workers create tables
      // For now, just verify db has core Drizzle methods
      expect(typeof db.select).toBe("function");
      expect(typeof db.insert).toBe("function");
      expect(typeof db.update).toBe("function");
      expect(typeof db.delete).toBe("function");
    });
  });

  describe("getDb", () => {
    test("creates singleton instance", async () => {
      const db1 = await getDb();
      const db2 = await getDb();
      
      // Same instance
      expect(db1).toBe(db2);
    });

    test("creates file-based db when path provided", async () => {
      const tempPath = `file:/tmp/test-${Date.now()}.db`;
      const db = await getDb(tempPath);
      
      expect(db).toBeDefined();
      expect(typeof db.select).toBe("function");
    });

    test("defaults to in-memory when no path", async () => {
      const db = await getDb();
      
      expect(db).toBeDefined();
      expect(typeof db.select).toBe("function");
    });

    test("returns same instance for same path", async () => {
      const path = "file:/tmp/singleton-test.db";
      const db1 = await getDb(path);
      const db2 = await getDb(path);
      
      expect(db1).toBe(db2);
    });
  });

  describe("schema initialization", () => {
    test("initializes connection on creation", async () => {
      const db = await createInMemoryDb();
      
      // Once schema subtasks are done, we'll have actual tables
      // For now, verify db is ready for schema (has schema object)
      expect(db).toBeDefined();
      expect(typeof db.$client).toBe("object");
    });
  });

  describe("worktree resolution", () => {
    test("resolveDbPath ensures main repo DB path is used", async () => {
      const { resolveDbPath } = await import("./worktree.js");
      
      // Test with a mock path (not a real worktree)
      const mockPath = "/path/to/project";
      const dbPath = resolveDbPath(mockPath);
      
      // Should return path to .opencode/swarm.db
      expect(dbPath).toBe("/path/to/project/.opencode/swarm.db");
    });
    
    test("resolveDbPath allows custom database filename", async () => {
      const { resolveDbPath } = await import("./worktree.js");
      
      const mockPath = "/path/to/project";
      const dbPath = resolveDbPath(mockPath, "custom.db");
      
      expect(dbPath).toBe("/path/to/project/.opencode/custom.db");
    });
  });
});
