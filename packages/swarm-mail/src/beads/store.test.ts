/**
 * Beads Event Store Tests
 *
 * Tests event store operations (append, read, replay) for bead events.
 *
 * ## Test Strategy (TDD)
 * 1. appendBeadEvent - append events to shared event store
 * 2. readBeadEvents - read with filters (type, bead_id, timestamp)
 * 3. replayBeadEvents - rebuild projections from events
 * 4. Integration with projections - events update materialized views
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "../streams/migrations.js";
import { beadsMigration } from "./migrations.js";
import type { DatabaseAdapter } from "../types/database.js";
import { appendBeadEvent, readBeadEvents, replayBeadEvents } from "./store.js";
import { getBead, queryBeads, getDependencies, getLabels, getComments } from "./projections.js";
import type { BeadEvent } from "./events.js";

/**
 * Wrap PGLite to match DatabaseAdapter interface
 */
function wrapPGlite(pglite: PGlite): DatabaseAdapter {
  return {
    query: <T>(sql: string, params?: unknown[]) => pglite.query<T>(sql, params),
    exec: async (sql: string) => {
      await pglite.exec(sql);
    },
    close: () => pglite.close(),
  };
}

/**
 * Helper to create bead events without importing from plugin package
 */
function createBeadEvent<T extends BeadEvent["type"]>(
  type: T,
  data: Omit<Extract<BeadEvent, { type: T }>, "type" | "timestamp" | "id" | "sequence">,
): Extract<BeadEvent, { type: T }> {
  return {
    type,
    timestamp: Date.now(),
    ...data,
  } as Extract<BeadEvent, { type: T }>;
}

describe("Bead Event Store", () => {
  let pglite: PGlite;
  let db: DatabaseAdapter;
  const projectKey = "/test/project";

  beforeEach(async () => {
    pglite = new PGlite();
    db = wrapPGlite(pglite);

    // Run base migrations (v1-v5)
    await runMigrations(pglite);

    // Run beads migration (v6)
    await pglite.exec("BEGIN");
    await pglite.exec(beadsMigration.up);
    await pglite.query(
      `INSERT INTO schema_version (version, applied_at, description) VALUES ($1, $2, $3)`,
      [beadsMigration.version, Date.now(), beadsMigration.description],
    );
    await pglite.exec("COMMIT");
  });

  afterEach(async () => {
    await pglite.close();
  });

  // ============================================================================
  // appendBeadEvent
  // ============================================================================

  test("appendBeadEvent - appends bead_created event", async () => {
    const event = createBeadEvent("bead_created", {
      project_key: projectKey,
      bead_id: "bd-test-001",
      title: "Test Bead",
      issue_type: "task",
      priority: 2,
    });

    const result = await appendBeadEvent(event, undefined, db);

    expect(result.id).toBeGreaterThan(0);
    expect(result.sequence).toBeGreaterThan(0);
    expect(result.type).toBe("bead_created");
    expect(result.bead_id).toBe("bd-test-001");

    // Verify event was persisted
    const events = await readBeadEvents({}, undefined, db);
    expect(events).toHaveLength(1);
    expect(events[0]?.bead_id).toBe("bd-test-001");
  });

  test("appendBeadEvent - updates projection for bead_created", async () => {
    const event = createBeadEvent("bead_created", {
      project_key: projectKey,
      bead_id: "bd-test-002",
      title: "Test Projection",
      issue_type: "feature",
      priority: 3,
    });

    await appendBeadEvent(event, undefined, db);

    // Check projection was updated
    const bead = await getBead(db, projectKey, "bd-test-002");
    expect(bead).not.toBeNull();
    expect(bead?.title).toBe("Test Projection");
    expect(bead?.type).toBe("feature");
    expect(bead?.status).toBe("open");
  });

  test("appendBeadEvent - handles bead_updated event", async () => {
    // Create bead first
    const createEvent = createBeadEvent("bead_created", {
      project_key: projectKey,
      bead_id: "bd-test-003",
      title: "Original Title",
      issue_type: "bug",
      priority: 1,
    });
    await appendBeadEvent(createEvent, undefined, db);

    // Update it
    const updateEvent = createBeadEvent("bead_updated", {
      project_key: projectKey,
      bead_id: "bd-test-003",
      changes: {
        title: { old: "Original Title", new: "Updated Title" },
      },
    });
    await appendBeadEvent(updateEvent, undefined, db);

    // Check projection
    const bead = await getBead(db, projectKey, "bd-test-003");
    expect(bead?.title).toBe("Updated Title");
  });

  test("appendBeadEvent - handles bead_status_changed event", async () => {
    const createEvent = createBeadEvent("bead_created", {
      project_key: projectKey,
      bead_id: "bd-test-004",
      title: "Status Test",
      issue_type: "task",
      priority: 2,
    });
    await appendBeadEvent(createEvent, undefined, db);

    const statusEvent = createBeadEvent("bead_status_changed", {
      project_key: projectKey,
      bead_id: "bd-test-004",
      from_status: "open",
      to_status: "in_progress",
    });
    await appendBeadEvent(statusEvent, undefined, db);

    const bead = await getBead(db, projectKey, "bd-test-004");
    expect(bead?.status).toBe("in_progress");
  });

  test("appendBeadEvent - handles bead_closed event", async () => {
    const createEvent = createBeadEvent("bead_created", {
      project_key: projectKey,
      bead_id: "bd-test-005",
      title: "Close Test",
      issue_type: "task",
      priority: 2,
    });
    await appendBeadEvent(createEvent, undefined, db);

    const closeEvent = createBeadEvent("bead_closed", {
      project_key: projectKey,
      bead_id: "bd-test-005",
      reason: "Completed successfully",
    });
    await appendBeadEvent(closeEvent, undefined, db);

    const bead = await getBead(db, projectKey, "bd-test-005");
    expect(bead?.status).toBe("closed");
    expect(bead?.closed_reason).toBe("Completed successfully");
    expect(bead?.closed_at).toBeGreaterThan(0);
  });

  test("appendBeadEvent - handles dependency events", async () => {
    // Create two beads
    await appendBeadEvent(
      createBeadEvent("bead_created", {
        project_key: projectKey,
        bead_id: "bd-test-006",
        title: "Blocker",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    await appendBeadEvent(
      createBeadEvent("bead_created", {
        project_key: projectKey,
        bead_id: "bd-test-007",
        title: "Blocked",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    // Add dependency
    const depEvent = createBeadEvent("bead_dependency_added", {
      project_key: projectKey,
      bead_id: "bd-test-007",
      dependency: {
        target: "bd-test-006",
        type: "blocks",
      },
    });
    await appendBeadEvent(depEvent, undefined, db);

    // Check dependency
    const deps = await getDependencies(db, projectKey, "bd-test-007");
    expect(deps).toHaveLength(1);
    expect(deps[0]?.depends_on_id).toBe("bd-test-006");
  });

  test("appendBeadEvent - handles label events", async () => {
    await appendBeadEvent(
      createBeadEvent("bead_created", {
        project_key: projectKey,
        bead_id: "bd-test-008",
        title: "Label Test",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    const labelEvent = createBeadEvent("bead_label_added", {
      project_key: projectKey,
      bead_id: "bd-test-008",
      label: "p0",
    });
    await appendBeadEvent(labelEvent, undefined, db);

    const labels = await getLabels(db, projectKey, "bd-test-008");
    expect(labels).toContain("p0");
  });

  test("appendBeadEvent - handles comment events", async () => {
    await appendBeadEvent(
      createBeadEvent("bead_created", {
        project_key: projectKey,
        bead_id: "bd-test-009",
        title: "Comment Test",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    const commentEvent = createBeadEvent("bead_comment_added", {
      project_key: projectKey,
      bead_id: "bd-test-009",
      author: "testuser",
      body: "Test comment",
    });
    await appendBeadEvent(commentEvent, undefined, db);

    const comments = await getComments(db, projectKey, "bd-test-009");
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toBe("Test comment");
  });

  // ============================================================================
  // readBeadEvents
  // ============================================================================

  test("readBeadEvents - returns all events", async () => {
    await appendBeadEvent(
      createBeadEvent("bead_created", {
        project_key: projectKey,
        bead_id: "bd-test-010",
        title: "Event 1",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    await appendBeadEvent(
      createBeadEvent("bead_created", {
        project_key: projectKey,
        bead_id: "bd-test-011",
        title: "Event 2",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    const events = await readBeadEvents({}, undefined, db);
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  test("readBeadEvents - filters by projectKey", async () => {
    await appendBeadEvent(
      createBeadEvent("bead_created", {
        project_key: "/project-a",
        bead_id: "bd-test-012",
        title: "Project A",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    await appendBeadEvent(
      createBeadEvent("bead_created", {
        project_key: "/project-b",
        bead_id: "bd-test-013",
        title: "Project B",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    const events = await readBeadEvents({ projectKey: "/project-a" }, undefined, db);
    expect(events.every((e: BeadEvent) => e.project_key === "/project-a")).toBe(true);
  });

  test("readBeadEvents - filters by bead_id", async () => {
    await appendBeadEvent(
      createBeadEvent("bead_created", {
        project_key: projectKey,
        bead_id: "bd-test-014",
        title: "Specific Bead",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    await appendBeadEvent(
      createBeadEvent("bead_updated", {
        project_key: projectKey,
        bead_id: "bd-test-014",
        changes: {
          title: { old: "Specific Bead", new: "Updated Bead" },
        },
      }),
      undefined,
      db,
    );

    const events = await readBeadEvents({ beadId: "bd-test-014" }, undefined, db);
    expect(events.every((e: BeadEvent) => e.bead_id === "bd-test-014")).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  test("readBeadEvents - filters by types", async () => {
    const beadId = "bd-test-015";
    await appendBeadEvent(
      createBeadEvent("bead_created", {
        project_key: projectKey,
        bead_id: beadId,
        title: "Type Filter",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    await appendBeadEvent(
      createBeadEvent("bead_label_added", {
        project_key: projectKey,
        bead_id: beadId,
        label: "test",
      }),
      undefined,
      db,
    );

    const events = await readBeadEvents({ types: ["bead_label_added", "bead_label_removed"] }, undefined, db);
    expect(events.every((e: BeadEvent) => e.type === "bead_label_added" || e.type === "bead_label_removed")).toBe(true);
  });

  test("readBeadEvents - supports pagination", async () => {
    // Create multiple events
    for (let i = 0; i < 5; i++) {
      await appendBeadEvent(
        createBeadEvent("bead_created", {
          project_key: projectKey,
          bead_id: `bd-test-page-${i}`,
          title: `Page ${i}`,
          issue_type: "task",
          priority: 2,
        }),
        undefined,
        db,
      );
    }

    const page1 = await readBeadEvents({ projectKey, limit: 2, offset: 0 }, undefined, db);
    const page2 = await readBeadEvents({ projectKey, limit: 2, offset: 2 }, undefined, db);

    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0]?.id).not.toBe(page2[0]?.id);
  });

  // ============================================================================
  // replayBeadEvents
  // ============================================================================

  test("replayBeadEvents - rebuilds projections", async () => {
    // Create events
    const beadId = "bd-test-016";
    await appendBeadEvent(
      createBeadEvent("bead_created", {
        project_key: projectKey,
        bead_id: beadId,
        title: "Replay Test",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    await appendBeadEvent(
      createBeadEvent("bead_label_added", {
        project_key: projectKey,
        bead_id: beadId,
        label: "replay",
      }),
      undefined,
      db,
    );

    // Clear projections
    await db.exec("DELETE FROM bead_labels");
    await db.exec("DELETE FROM beads");

    // Verify cleared
    const beadBefore = await getBead(db, projectKey, beadId);
    expect(beadBefore).toBeNull();

    // Replay
    const result = await replayBeadEvents({ projectKey, clearViews: false }, undefined, db);
    expect(result.eventsReplayed).toBeGreaterThanOrEqual(2);

    // Verify restored
    const beadAfter = await getBead(db, projectKey, beadId);
    expect(beadAfter).not.toBeNull();
    expect(beadAfter?.title).toBe("Replay Test");

    const labels = await getLabels(db, projectKey, beadId);
    expect(labels).toContain("replay");
  });

  test("replayBeadEvents - clears views if requested", async () => {
    await appendBeadEvent(
      createBeadEvent("bead_created", {
        project_key: projectKey,
        bead_id: "bd-test-017",
        title: "Clear Test",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    const result = await replayBeadEvents({ projectKey, clearViews: true }, undefined, db);
    expect(result.eventsReplayed).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThan(0);

    // Projections should be rebuilt
    const beads = await queryBeads(db, projectKey);
    expect(beads.length).toBeGreaterThan(0);
  });

  test("replayBeadEvents - filters by fromSequence", async () => {
    const bead1Event = await appendBeadEvent(
      createBeadEvent("bead_created", {
        project_key: projectKey,
        bead_id: "bd-test-018",
        title: "First",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    await appendBeadEvent(
      createBeadEvent("bead_created", {
        project_key: projectKey,
        bead_id: "bd-test-019",
        title: "Second",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    // Clear and replay only after first event
    await db.exec("DELETE FROM beads");

    const result = await replayBeadEvents(
      { projectKey, fromSequence: bead1Event.sequence, clearViews: false },
      undefined,
      db,
    );

    // Should only replay second event
    expect(result.eventsReplayed).toBe(1);

    const beads = await queryBeads(db, projectKey);
    expect(beads).toHaveLength(1);
    expect(beads[0]?.id).toBe("bd-test-019");
  });
});
