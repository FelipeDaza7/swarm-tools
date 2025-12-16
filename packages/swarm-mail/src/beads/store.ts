/**
 * Beads Event Store - Append-only event log for bead operations
 *
 * Integrates bead events (from opencode-swarm-plugin) into the shared
 * swarm-mail event store. Follows same pattern as streams/store.ts but
 * for bead-specific events.
 *
 * ## Architecture
 * - Bead events stored in shared `events` table (same as agent/message events)
 * - Events trigger updateProjections() to update materialized views
 * - Events are NOT replayed for state (hybrid model - projections are source of truth)
 * - Event log provides audit trail and debugging for swarm coordination
 *
 * ## Event Flow
 * 1. appendBeadEvent() -> INSERT INTO events
 * 2. updateProjections() -> UPDATE materialized views (beads, dependencies, labels, etc.)
 * 3. Query operations read from projections (fast)
 *
 * @module beads/store
 */

import { getDatabase, withTiming } from "../streams/index.js";
import type { DatabaseAdapter } from "../types/database.js";
import { updateProjections } from "./projections.js";
import type { BeadEvent } from "./events.js";

// No type guards needed - BeadEvent type is already defined

// ============================================================================
// Timestamp Parsing (same as streams/store.ts)
// ============================================================================

/**
 * Parse timestamp from database row.
 *
 * Timestamps are stored as BIGINT but parsed as JavaScript number.
 * Safe for dates before year 2286 (MAX_SAFE_INTEGER).
 */
function parseTimestamp(timestamp: string): number {
  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts)) {
    throw new Error(`[BeadsStore] Invalid timestamp: ${timestamp}`);
  }
  if (ts > Number.MAX_SAFE_INTEGER) {
    console.warn(
      `[BeadsStore] Timestamp ${timestamp} exceeds MAX_SAFE_INTEGER (year 2286+)`,
    );
  }
  return ts;
}

// ============================================================================
// Event Store Operations
// ============================================================================

/**
 * Options for reading bead events
 */
export interface ReadBeadEventsOptions {
  /** Filter by project key */
  projectKey?: string;
  /** Filter by bead ID */
  beadId?: string;
  /** Filter by event types */
  types?: BeadEvent["type"][];
  /** Events after this timestamp */
  since?: number;
  /** Events before this timestamp */
  until?: number;
  /** Events after this sequence number */
  afterSequence?: number;
  /** Maximum number of events to return */
  limit?: number;
  /** Skip this many events (pagination) */
  offset?: number;
}

/**
 * Append a bead event to the shared event store
 *
 * Events are stored in the same `events` table as agent/message events.
 * Triggers updateProjections() to update materialized views.
 *
 * @param event - Bead event to append
 * @param projectPath - Optional project path for database location
 * @param dbOverride - Optional database adapter for dependency injection
 * @returns Event with id and sequence number
 */
export async function appendBeadEvent(
  event: BeadEvent,
  projectPath?: string,
  dbOverride?: DatabaseAdapter,
): Promise<BeadEvent & { id: number; sequence: number }> {
  const db = dbOverride ?? ((await getDatabase(projectPath)) as unknown as DatabaseAdapter);

  // Extract common fields (same structure as agent events)
  const { type, project_key, timestamp, ...rest } = event;

  console.log("[BeadsStore] Appending bead event", {
    type,
    projectKey: project_key,
    beadId: event.bead_id,
    timestamp,
  });

  // Insert into shared events table
  const result = await db.query<{ id: number; sequence: number }>(
    `INSERT INTO events (type, project_key, timestamp, data)
     VALUES ($1, $2, $3, $4)
     RETURNING id, sequence`,
    [type, project_key, timestamp, JSON.stringify(rest)],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("[BeadsStore] Failed to insert event - no row returned");
  }
  const { id, sequence } = row;

  console.log("[BeadsStore] Bead event appended", {
    type,
    id,
    sequence,
    beadId: event.bead_id,
  });

  // Update materialized views based on event type
  console.debug("[BeadsStore] Updating projections", { type, id });
  // Cast to any to match projections' loose event type (with index signature)
  await updateProjections(db, { ...event, id, sequence } as any);

  return { ...event, id, sequence };
}

/**
 * Read bead events with optional filters
 *
 * Queries the shared events table for bead events (type starts with "bead_").
 *
 * @param options - Filter options
 * @param projectPath - Optional project path for database location
 * @param dbOverride - Optional database adapter for dependency injection
 * @returns Array of bead events with id and sequence
 */
export async function readBeadEvents(
  options: ReadBeadEventsOptions = {},
  projectPath?: string,
  dbOverride?: DatabaseAdapter,
): Promise<Array<BeadEvent & { id: number; sequence: number }>> {
  return withTiming("readBeadEvents", async () => {
    const db = dbOverride ?? ((await getDatabase(projectPath)) as unknown as DatabaseAdapter);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    // Always filter for bead events (type starts with "bead_")
    conditions.push(`type LIKE 'bead_%'`);

    if (options.projectKey) {
      conditions.push(`project_key = $${paramIndex++}`);
      params.push(options.projectKey);
    }

    if (options.beadId) {
      // bead_id is stored in data JSON field
      conditions.push(`data->>'bead_id' = $${paramIndex++}`);
      params.push(options.beadId);
    }

    if (options.types && options.types.length > 0) {
      conditions.push(`type = ANY($${paramIndex++})`);
      params.push(options.types);
    }

    if (options.since !== undefined) {
      conditions.push(`timestamp >= $${paramIndex++}`);
      params.push(options.since);
    }

    if (options.until !== undefined) {
      conditions.push(`timestamp <= $${paramIndex++}`);
      params.push(options.until);
    }

    if (options.afterSequence !== undefined) {
      conditions.push(`sequence > $${paramIndex++}`);
      params.push(options.afterSequence);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    let query = `
      SELECT id, type, project_key, timestamp, sequence, data
      FROM events
      ${whereClause}
      ORDER BY sequence ASC
    `;

    if (options.limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(options.limit);
    }

    if (options.offset) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(options.offset);
    }

    const result = await db.query<{
      id: number;
      type: string;
      project_key: string;
      timestamp: string;
      sequence: number;
      data: string;
    }>(query, params);

    return result.rows.map((row) => {
      const data =
        typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      return {
        id: row.id,
        type: row.type as BeadEvent["type"],
        project_key: row.project_key,
        timestamp: parseTimestamp(row.timestamp as string),
        sequence: row.sequence,
        ...data,
      } as BeadEvent & { id: number; sequence: number };
    });
  });
}

/**
 * Replay bead events to rebuild materialized views
 *
 * Useful for:
 * - Recovering from projection corruption
 * - Migrating to new schema
 * - Debugging state issues
 *
 * Note: Unlike swarm-mail agent events, bead projections are NOT rebuilt
 * from events in normal operation (hybrid CRUD + audit trail model).
 * This function is for recovery/debugging only.
 *
 * @param options - Replay options
 * @param projectPath - Optional project path for database location
 * @param dbOverride - Optional database adapter for dependency injection
 * @returns Stats about replay operation
 */
export async function replayBeadEvents(
  options: {
    projectKey?: string;
    fromSequence?: number;
    clearViews?: boolean;
  } = {},
  projectPath?: string,
  dbOverride?: DatabaseAdapter,
): Promise<{ eventsReplayed: number; duration: number }> {
  return withTiming("replayBeadEvents", async () => {
    const startTime = Date.now();
    const db = dbOverride ?? ((await getDatabase(projectPath)) as unknown as DatabaseAdapter);

    // Optionally clear bead-specific materialized views
    if (options.clearViews) {
      if (options.projectKey) {
        // Clear for specific project
        await db.query(
          `DELETE FROM bead_comments WHERE bead_id IN (
            SELECT id FROM beads WHERE project_key = $1
          )`,
          [options.projectKey],
        );
        await db.query(
          `DELETE FROM bead_labels WHERE bead_id IN (
            SELECT id FROM beads WHERE project_key = $1
          )`,
          [options.projectKey],
        );
        await db.query(
          `DELETE FROM bead_dependencies WHERE bead_id IN (
            SELECT id FROM beads WHERE project_key = $1
          )`,
          [options.projectKey],
        );
        await db.query(
          `DELETE FROM blocked_beads_cache WHERE bead_id IN (
            SELECT id FROM beads WHERE project_key = $1
          )`,
          [options.projectKey],
        );
        await db.query(`DELETE FROM dirty_beads WHERE bead_id IN (
            SELECT id FROM beads WHERE project_key = $1
          )`, [options.projectKey]);
        await db.query(`DELETE FROM beads WHERE project_key = $1`, [
          options.projectKey,
        ]);
      } else {
        // Clear all bead views
        await db.exec(`
          DELETE FROM bead_comments;
          DELETE FROM bead_labels;
          DELETE FROM bead_dependencies;
          DELETE FROM blocked_beads_cache;
          DELETE FROM dirty_beads;
          DELETE FROM beads;
        `);
      }
    }

    // Read all bead events
    const events = await readBeadEvents(
      {
        projectKey: options.projectKey,
        afterSequence: options.fromSequence,
      },
      projectPath,
      dbOverride,
    );

    // Replay each event through projections
    for (const event of events) {
      // Cast to any to match projections' loose event type
      await updateProjections(db, event as any);
    }

    console.log("[BeadsStore] Replay complete", {
      eventsReplayed: events.length,
      duration: Date.now() - startTime,
    });

    return {
      eventsReplayed: events.length,
      duration: Date.now() - startTime,
    };
  });
}
