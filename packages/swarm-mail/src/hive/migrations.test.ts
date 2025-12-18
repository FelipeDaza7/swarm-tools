/**
 * Hive Migrations Tests
 *
 * Tests for schema migrations including:
 * - Fresh database initialization
 * - Upgrade from beads → cells rename
 * - Recovery from corrupted/partial migrations
 *
 * @module hive/migrations.test
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import type { DatabaseAdapter } from "../types/database.js";
import { beadsMigration, cellsViewMigration, hiveMigrations } from "./migrations.js";

function wrapPGlite(pglite: PGlite): DatabaseAdapter {
  return {
    query: <T>(sql: string, params?: unknown[]) => pglite.query<T>(sql, params),
    exec: async (sql: string) => {
      await pglite.exec(sql);
    },
    close: () => pglite.close(),
  };
}

describe("Hive Migrations", () => {
  let pglite: PGlite;
  let db: DatabaseAdapter;

  beforeEach(async () => {
    pglite = await PGlite.create({ extensions: { vector } });
    db = wrapPGlite(pglite);

    // Create base schema (events table, schema_version)
    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        sequence SERIAL NOT NULL,
        type TEXT NOT NULL,
        project_key TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        data JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at BIGINT NOT NULL,
        description TEXT
      );
    `);
  });

  afterEach(async () => {
    await pglite.close();
  });

  describe("beadsMigration (v6)", () => {
    test("creates beads table with correct schema", async () => {
      await pglite.exec(beadsMigration.up);

      // Verify table exists
      const result = await pglite.query<{ exists: boolean }>(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'beads'
        )
      `);
      expect(result.rows[0].exists).toBe(true);
    });

    test("creates all supporting tables", async () => {
      await pglite.exec(beadsMigration.up);

      const tables = ["beads", "bead_dependencies", "bead_labels", "bead_comments", "blocked_beads_cache", "dirty_beads"];

      for (const table of tables) {
        const result = await pglite.query<{ exists: boolean }>(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = $1
          )
        `, [table]);
        expect(result.rows[0].exists).toBe(true);
      }
    });
  });

  describe("cellsViewMigration (v7)", () => {
    test("creates cells view pointing to beads table", async () => {
      // First apply v6
      await pglite.exec(beadsMigration.up);

      // Then apply v7
      await pglite.exec(cellsViewMigration.up);

      // Verify view exists
      const result = await pglite.query<{ exists: boolean }>(`
        SELECT EXISTS (
          SELECT FROM information_schema.views 
          WHERE table_name = 'cells'
        )
      `);
      expect(result.rows[0].exists).toBe(true);
    });

    test("cells view allows SELECT queries", async () => {
      await pglite.exec(beadsMigration.up);
      await pglite.exec(cellsViewMigration.up);

      // Insert into beads
      await pglite.query(`
        INSERT INTO beads (id, project_key, type, status, title, priority, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, ["bd-test", "/test", "task", "open", "Test task", 2, Date.now(), Date.now()]);

      // Query via cells view
      const result = await pglite.query<{ id: string; title: string }>(`
        SELECT id, title FROM cells WHERE project_key = $1
      `, ["/test"]);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBe("bd-test");
      expect(result.rows[0].title).toBe("Test task");
    });

    test("cells view allows INSERT via INSTEAD OF trigger", async () => {
      await pglite.exec(beadsMigration.up);
      await pglite.exec(cellsViewMigration.up);

      // Insert via cells view
      await pglite.query(`
        INSERT INTO cells (id, project_key, type, status, title, priority, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, ["bd-via-view", "/test", "bug", "open", "Via view", 1, Date.now(), Date.now()]);

      // Verify it's in beads table
      const result = await pglite.query<{ id: string }>(`
        SELECT id FROM beads WHERE id = $1
      `, ["bd-via-view"]);

      expect(result.rows).toHaveLength(1);
    });
  });

  describe("upgrade path", () => {
    test("existing v6 database can upgrade to v7", async () => {
      // Simulate existing v6 database with data
      await pglite.exec(beadsMigration.up);
      await pglite.query(`
        INSERT INTO schema_version (version, applied_at, description)
        VALUES ($1, $2, $3)
      `, [6, Date.now(), beadsMigration.description]);

      await pglite.query(`
        INSERT INTO beads (id, project_key, type, status, title, priority, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, ["bd-existing", "/test", "task", "open", "Existing task", 2, Date.now(), Date.now()]);

      // Apply v7 migration
      await pglite.exec(cellsViewMigration.up);
      await pglite.query(`
        INSERT INTO schema_version (version, applied_at, description)
        VALUES ($1, $2, $3)
      `, [7, Date.now(), cellsViewMigration.description]);

      // Verify existing data accessible via cells view
      const result = await pglite.query<{ id: string }>(`
        SELECT id FROM cells WHERE id = $1
      `, ["bd-existing"]);

      expect(result.rows).toHaveLength(1);
    });

    test("fresh database gets both v6 and v7", async () => {
      // Apply all migrations
      for (const migration of hiveMigrations) {
        await pglite.exec(migration.up);
        await pglite.query(`
          INSERT INTO schema_version (version, applied_at, description)
          VALUES ($1, $2, $3)
        `, [migration.version, Date.now(), migration.description]);
      }

      // Verify both beads table and cells view exist
      const beadsExists = await pglite.query<{ exists: boolean }>(`
        SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'beads')
      `);
      const cellsExists = await pglite.query<{ exists: boolean }>(`
        SELECT EXISTS (SELECT FROM information_schema.views WHERE table_name = 'cells')
      `);

      expect(beadsExists.rows[0].exists).toBe(true);
      expect(cellsExists.rows[0].exists).toBe(true);
    });
  });

  describe("recovery scenarios", () => {
    test("handles missing cells view gracefully", async () => {
      // Database has v6 but somehow missing v7
      await pglite.exec(beadsMigration.up);

      // Query cells should fail
      await expect(
        pglite.query(`SELECT * FROM cells LIMIT 1`)
      ).rejects.toThrow();

      // After applying v7, it should work
      await pglite.exec(cellsViewMigration.up);

      const result = await pglite.query(`SELECT * FROM cells LIMIT 1`);
      expect(result.rows).toHaveLength(0); // Empty but works
    });
  });
});
