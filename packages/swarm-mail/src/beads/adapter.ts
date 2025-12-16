/**
 * Beads Adapter - Factory for creating BeadsAdapter instances
 *
 * This file implements the adapter pattern for beads event sourcing,
 * enabling dependency injection of the database.
 *
 * ## Design Pattern
 * - Accept DatabaseAdapter via factory parameter
 * - Return BeadsAdapter interface
 * - Delegate to store.ts for event operations
 * - Delegate to projections.ts for queries
 * - No direct database access (all via adapter)
 *
 * ## Usage
 * ```typescript
 * import { wrapPGlite } from '@opencode/swarm-mail/pglite';
 * import { createBeadsAdapter } from '@opencode/swarm-mail/beads';
 *
 * const pglite = new PGlite('./streams.db');
 * const db = wrapPGlite(pglite);
 * const beads = createBeadsAdapter(db, '/path/to/project');
 *
 * // Use the adapter
 * await beads.createBead(projectKey, { title: "Task", type: "task", priority: 2 });
 * const bead = await beads.getBead(projectKey, "bd-123");
 * ```
 */

import type { DatabaseAdapter } from "../types/database.js";
import type { BeadsAdapter } from "../types/beads-adapter.js";

// Import implementation functions from store.ts and projections.ts
import {
  appendBeadEvent,
  readBeadEvents,
  replayBeadEvents,
} from "./store.js";

import {
  getBead,
  queryBeads,
  getDependencies,
  getDependents,
  isBlocked,
  getBlockers,
  getLabels,
  getComments,
  getNextReadyBead,
  getInProgressBeads,
  getBlockedBeads,
  markBeadDirty,
  getDirtyBeads,
  clearDirtyBead,
} from "./projections.js";

// Import event types (will be from opencode-swarm-plugin)
import type { BeadEvent } from "./events.js";

/**
 * Create a BeadsAdapter instance
 *
 * @param db - DatabaseAdapter instance (PGLite, SQLite, PostgreSQL, etc.)
 * @param projectKey - Project identifier (typically the project path)
 * @returns BeadsAdapter interface
 */
export function createBeadsAdapter(
  db: DatabaseAdapter,
  projectKey: string,
): BeadsAdapter {
  return {
    // ============================================================================
    // Core Bead Operations
    // ============================================================================

    async createBead(projectKeyParam, options, projectPath?) {
      // Create bead_created event
      const event: BeadEvent = {
        type: "bead_created",
        project_key: projectKeyParam,
        bead_id: generateBeadId(projectKeyParam),
        timestamp: Date.now(),
        title: options.title,
        description: options.description || null,
        issue_type: options.type,
        priority: options.priority ?? 2,
        parent_id: options.parent_id || null,
        created_by: options.created_by || null,
        metadata: options.metadata || null,
      } as any;

      await appendBeadEvent(event, projectPath, db);

      // If assignee provided, emit bead_assigned event
      if (options.assignee) {
        const assignEvent: BeadEvent = {
          type: "bead_assigned",
          project_key: projectKeyParam,
          bead_id: event.bead_id,
          timestamp: Date.now(),
          assignee: options.assignee,
          assigned_by: options.created_by || null,
        } as any;
        await appendBeadEvent(assignEvent, projectPath, db);
      }

      // Return the created bead from projection
      const bead = await getBead(db, projectKeyParam, event.bead_id);
      if (!bead) {
        throw new Error(
          `[BeadsAdapter] Failed to create bead - not found after insert`,
        );
      }
      return bead;
    },

    async getBead(projectKeyParam, beadId, projectPath?) {
      return getBead(db, projectKeyParam, beadId);
    },

    async queryBeads(projectKeyParam, options?, projectPath?) {
      return queryBeads(db, projectKeyParam, options);
    },

    async updateBead(projectKeyParam, beadId, options, projectPath?) {
      const existingBead = await getBead(db, projectKeyParam, beadId);
      if (!existingBead) {
        throw new Error(`[BeadsAdapter] Bead not found: ${beadId}`);
      }

      const changes: Record<string, { old: unknown; new: unknown }> = {};

      if (options.title && options.title !== existingBead.title) {
        changes.title = { old: existingBead.title, new: options.title };
      }
      if (options.description !== undefined && options.description !== existingBead.description) {
        changes.description = { old: existingBead.description, new: options.description };
      }
      if (options.priority !== undefined && options.priority !== existingBead.priority) {
        changes.priority = { old: existingBead.priority, new: options.priority };
      }
      if (options.assignee !== undefined && options.assignee !== existingBead.assignee) {
        changes.assignee = { old: existingBead.assignee, new: options.assignee };
      }

      if (Object.keys(changes).length === 0) {
        return existingBead; // No changes
      }

      const event: BeadEvent = {
        type: "bead_updated",
        project_key: projectKeyParam,
        bead_id: beadId,
        timestamp: Date.now(),
        changes,
        updated_by: options.updated_by || null,
      } as any;

      await appendBeadEvent(event, projectPath, db);

      const updated = await getBead(db, projectKeyParam, beadId);
      if (!updated) {
        throw new Error(`[BeadsAdapter] Bead disappeared after update: ${beadId}`);
      }
      return updated;
    },

    async changeBeadStatus(projectKeyParam, beadId, toStatus, options?, projectPath?) {
      const existingBead = await getBead(db, projectKeyParam, beadId);
      if (!existingBead) {
        throw new Error(`[BeadsAdapter] Bead not found: ${beadId}`);
      }

      const event: BeadEvent = {
        type: "bead_status_changed",
        project_key: projectKeyParam,
        bead_id: beadId,
        timestamp: Date.now(),
        from_status: existingBead.status,
        to_status: toStatus,
        reason: options?.reason || null,
        changed_by: options?.changed_by || null,
      } as any;

      await appendBeadEvent(event, projectPath, db);

      const updated = await getBead(db, projectKeyParam, beadId);
      if (!updated) {
        throw new Error(`[BeadsAdapter] Bead disappeared after status change: ${beadId}`);
      }
      return updated;
    },

    async closeBead(projectKeyParam, beadId, reason, options?, projectPath?) {
      const existingBead = await getBead(db, projectKeyParam, beadId);
      if (!existingBead) {
        throw new Error(`[BeadsAdapter] Bead not found: ${beadId}`);
      }

      const event: BeadEvent = {
        type: "bead_closed",
        project_key: projectKeyParam,
        bead_id: beadId,
        timestamp: Date.now(),
        reason,
        closed_by: options?.closed_by || null,
        files_touched: options?.files_touched || null,
        duration_ms: options?.duration_ms || null,
      } as any;

      await appendBeadEvent(event, projectPath, db);

      const updated = await getBead(db, projectKeyParam, beadId);
      if (!updated) {
        throw new Error(`[BeadsAdapter] Bead disappeared after close: ${beadId}`);
      }
      return updated;
    },

    async reopenBead(projectKeyParam, beadId, options?, projectPath?) {
      const existingBead = await getBead(db, projectKeyParam, beadId);
      if (!existingBead) {
        throw new Error(`[BeadsAdapter] Bead not found: ${beadId}`);
      }

      const event: BeadEvent = {
        type: "bead_reopened",
        project_key: projectKeyParam,
        bead_id: beadId,
        timestamp: Date.now(),
        reason: options?.reason || null,
        reopened_by: options?.reopened_by || null,
      } as any;

      await appendBeadEvent(event, projectPath, db);

      const updated = await getBead(db, projectKeyParam, beadId);
      if (!updated) {
        throw new Error(`[BeadsAdapter] Bead disappeared after reopen: ${beadId}`);
      }
      return updated;
    },

    async deleteBead(projectKeyParam, beadId, options?, projectPath?) {
      const existingBead = await getBead(db, projectKeyParam, beadId);
      if (!existingBead) {
        throw new Error(`[BeadsAdapter] Bead not found: ${beadId}`);
      }

      const event: BeadEvent = {
        type: "bead_deleted",
        project_key: projectKeyParam,
        bead_id: beadId,
        timestamp: Date.now(),
        reason: options?.reason || null,
        deleted_by: options?.deleted_by || null,
      } as any;

      await appendBeadEvent(event, projectPath, db);
    },

    // ============================================================================
    // Dependency Operations
    // ============================================================================

    async addDependency(projectKeyParam, beadId, dependsOnId, relationship, options?, projectPath?) {
      // Validate both beads exist
      const sourceBead = await getBead(db, projectKeyParam, beadId);
      if (!sourceBead) {
        throw new Error(`[BeadsAdapter] Bead not found: ${beadId}`);
      }
      
      const targetBead = await getBead(db, projectKeyParam, dependsOnId);
      if (!targetBead) {
        throw new Error(`[BeadsAdapter] Target bead not found: ${dependsOnId}`);
      }
      
      // Prevent self-dependency
      if (beadId === dependsOnId) {
        throw new Error(`[BeadsAdapter] Bead cannot depend on itself`);
      }
      
      // Check for cycles (import at runtime to avoid circular deps)
      const { wouldCreateCycle } = await import("./dependencies.js");
      const hasCycle = await wouldCreateCycle(db, beadId, dependsOnId);
      if (hasCycle) {
        throw new Error(`[BeadsAdapter] Adding dependency would create a cycle`);
      }
      
      const event: BeadEvent = {
        type: "bead_dependency_added",
        project_key: projectKeyParam,
        bead_id: beadId,
        timestamp: Date.now(),
        dependency: {
          target: dependsOnId,
          type: relationship,
        },
        reason: options?.reason || null,
        added_by: options?.added_by || null,
      } as any;

      await appendBeadEvent(event, projectPath, db);

      const deps = await getDependencies(db, projectKeyParam, beadId);
      const dep = deps.find((d) => d.depends_on_id === dependsOnId && d.relationship === relationship);
      if (!dep) {
        throw new Error(`[BeadsAdapter] Dependency not found after insert`);
      }
      return dep;
    },

    async removeDependency(projectKeyParam, beadId, dependsOnId, relationship, options?, projectPath?) {
      const event: BeadEvent = {
        type: "bead_dependency_removed",
        project_key: projectKeyParam,
        bead_id: beadId,
        timestamp: Date.now(),
        dependency: {
          target: dependsOnId,
          type: relationship,
        },
        reason: options?.reason || null,
        removed_by: options?.removed_by || null,
      } as any;

      await appendBeadEvent(event, projectPath, db);
    },

    async getDependencies(projectKeyParam, beadId, projectPath?) {
      return getDependencies(db, projectKeyParam, beadId);
    },

    async getDependents(projectKeyParam, beadId, projectPath?) {
      return getDependents(db, projectKeyParam, beadId);
    },

    async isBlocked(projectKeyParam, beadId, projectPath?) {
      return isBlocked(db, projectKeyParam, beadId);
    },

    async getBlockers(projectKeyParam, beadId, projectPath?) {
      return getBlockers(db, projectKeyParam, beadId);
    },

    // ============================================================================
    // Label Operations
    // ============================================================================

    async addLabel(projectKeyParam, beadId, label, options?, projectPath?) {
      const event: BeadEvent = {
        type: "bead_label_added",
        project_key: projectKeyParam,
        bead_id: beadId,
        timestamp: Date.now(),
        label,
        added_by: options?.added_by || null,
      } as any;

      await appendBeadEvent(event, projectPath, db);

      return {
        bead_id: beadId,
        label,
        created_at: event.timestamp,
      };
    },

    async removeLabel(projectKeyParam, beadId, label, options?, projectPath?) {
      const event: BeadEvent = {
        type: "bead_label_removed",
        project_key: projectKeyParam,
        bead_id: beadId,
        timestamp: Date.now(),
        label,
        removed_by: options?.removed_by || null,
      } as any;

      await appendBeadEvent(event, projectPath, db);
    },

    async getLabels(projectKeyParam, beadId, projectPath?) {
      return getLabels(db, projectKeyParam, beadId);
    },

    async getBeadsWithLabel(projectKeyParam, label, projectPath?) {
      return queryBeads(db, projectKeyParam, { labels: [label] });
    },

    // ============================================================================
    // Comment Operations
    // ============================================================================

    async addComment(projectKeyParam, beadId, author, body, options?, projectPath?) {
      const event: BeadEvent = {
        type: "bead_comment_added",
        project_key: projectKeyParam,
        bead_id: beadId,
        timestamp: Date.now(),
        author,
        body,
        parent_comment_id: options?.parent_id || null,
        metadata: options?.metadata || null,
      } as any;

      await appendBeadEvent(event, projectPath, db);

      // Get the comment from projection
      const comments = await getComments(db, projectKeyParam, beadId);
      const comment = comments[comments.length - 1]; // Last inserted
      if (!comment) {
        throw new Error(`[BeadsAdapter] Comment not found after insert`);
      }
      return comment;
    },

    async updateComment(projectKeyParam, commentId, newBody, updated_by, projectPath?) {
      const event: BeadEvent = {
        type: "bead_comment_updated",
        project_key: projectKeyParam,
        bead_id: "", // Not needed for comment update
        timestamp: Date.now(),
        comment_id: commentId,
        new_body: newBody,
        updated_by,
      } as any;

      await appendBeadEvent(event, projectPath, db);

      // Would need a getCommentById function in projections
      // For now, return a placeholder
      return {
        id: commentId,
        bead_id: "",
        author: updated_by,
        body: newBody,
        parent_id: null,
        created_at: Date.now(),
        updated_at: event.timestamp,
      };
    },

    async deleteComment(projectKeyParam, commentId, deleted_by, options?, projectPath?) {
      const event: BeadEvent = {
        type: "bead_comment_deleted",
        project_key: projectKeyParam,
        bead_id: "", // Not needed for comment delete
        timestamp: Date.now(),
        comment_id: commentId,
        deleted_by,
        reason: options?.reason || null,
      } as any;

      await appendBeadEvent(event, projectPath, db);
    },

    async getComments(projectKeyParam, beadId, projectPath?) {
      return getComments(db, projectKeyParam, beadId);
    },

    // ============================================================================
    // Epic Operations
    // ============================================================================

    async addChildToEpic(projectKeyParam, epicId, childId, options?, projectPath?) {
      const event: BeadEvent = {
        type: "bead_epic_child_added",
        project_key: projectKeyParam,
        bead_id: epicId,
        timestamp: Date.now(),
        child_id: childId,
        child_index: options?.child_index || null,
        added_by: options?.added_by || null,
      } as any;

      await appendBeadEvent(event, projectPath, db);
    },

    async removeChildFromEpic(projectKeyParam, epicId, childId, options?, projectPath?) {
      const event: BeadEvent = {
        type: "bead_epic_child_removed",
        project_key: projectKeyParam,
        bead_id: epicId,
        timestamp: Date.now(),
        child_id: childId,
        reason: options?.reason || null,
        removed_by: options?.removed_by || null,
      } as any;

      await appendBeadEvent(event, projectPath, db);
    },

    async getEpicChildren(projectKeyParam, epicId, projectPath?) {
      return queryBeads(db, projectKeyParam, { parent_id: epicId });
    },

    async isEpicClosureEligible(projectKeyParam, epicId, projectPath?) {
      const children = await queryBeads(db, projectKeyParam, { parent_id: epicId });
      return children.every((child) => child.status === "closed");
    },

    // ============================================================================
    // Query Helpers
    // ============================================================================

    async getNextReadyBead(projectKeyParam, projectPath?) {
      return getNextReadyBead(db, projectKeyParam);
    },

    async getInProgressBeads(projectKeyParam, projectPath?) {
      return getInProgressBeads(db, projectKeyParam);
    },

    async getBlockedBeads(projectKeyParam, projectPath?) {
      return getBlockedBeads(db, projectKeyParam);
    },

    async markDirty(projectKeyParam, beadId, projectPath?) {
      await markBeadDirty(db, projectKeyParam, beadId);
    },

    async getDirtyBeads(projectKeyParam, projectPath?) {
      return getDirtyBeads(db, projectKeyParam);
    },

    async clearDirty(projectKeyParam, beadId, projectPath?) {
      await clearDirtyBead(db, projectKeyParam, beadId);
    },

    // ============================================================================
    // Schema Operations
    // ============================================================================

    async runMigrations(projectPath?) {
      const { beadsMigration } = await import("./migrations.js");
      
      // Ensure schema_version table exists first
      await db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at BIGINT NOT NULL,
          description TEXT
        );
      `);
      
      await db.exec("BEGIN");
      try {
        await db.exec(beadsMigration.up);
        await db.query(
          `INSERT INTO schema_version (version, applied_at, description) VALUES ($1, $2, $3)
           ON CONFLICT (version) DO NOTHING`,
          [beadsMigration.version, Date.now(), beadsMigration.description],
        );
        await db.exec("COMMIT");
      } catch (error) {
        await db.exec("ROLLBACK");
        throw error;
      }
    },

    async getBeadsStats(projectPath?) {
      const [totalResult, openResult, inProgressResult, blockedResult, closedResult] = await Promise.all([
        db.query<{ count: string }>("SELECT COUNT(*) as count FROM beads WHERE project_key = $1", [projectKey]),
        db.query<{ count: string }>("SELECT COUNT(*) as count FROM beads WHERE project_key = $1 AND status = 'open'", [projectKey]),
        db.query<{ count: string }>("SELECT COUNT(*) as count FROM beads WHERE project_key = $1 AND status = 'in_progress'", [projectKey]),
        db.query<{ count: string }>("SELECT COUNT(*) as count FROM beads WHERE project_key = $1 AND status = 'blocked'", [projectKey]),
        db.query<{ count: string }>("SELECT COUNT(*) as count FROM beads WHERE project_key = $1 AND status = 'closed'", [projectKey]),
      ]);

      const byTypeResult = await db.query<{ type: string; count: string }>(
        "SELECT type, COUNT(*) as count FROM beads WHERE project_key = $1 GROUP BY type",
        [projectKey],
      );

      const by_type: Record<string, number> = {};
      for (const row of byTypeResult.rows) {
        by_type[row.type] = parseInt(row.count);
      }

      return {
        total_beads: parseInt(totalResult.rows[0]?.count || "0"),
        open: parseInt(openResult.rows[0]?.count || "0"),
        in_progress: parseInt(inProgressResult.rows[0]?.count || "0"),
        blocked: parseInt(blockedResult.rows[0]?.count || "0"),
        closed: parseInt(closedResult.rows[0]?.count || "0"),
        by_type,
      };
    },

    async rebuildBlockedCache(projectKeyParam, projectPath?) {
      // Rebuild cache for all beads in project (import at runtime)
      const { rebuildAllBlockedCaches } = await import("./dependencies.js");
      await rebuildAllBlockedCaches(db, projectKeyParam);
    },

    // ============================================================================
    // Database Connection Management
    // ============================================================================

    async getDatabase(projectPath?) {
      return db;
    },

    async close(projectPath?) {
      if (db.close) {
        await db.close();
      }
    },

    async closeAll() {
      if (db.close) {
        await db.close();
      }
    },
  };
}

/**
 * Generate a unique bead ID
 *
 * Format: bd-{project-hash}-{counter}
 * Example: bd-abc123-001
 */
function generateBeadId(projectKey: string): string {
  // Simple hash of project key
  const hash = projectKey
    .split("")
    .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0)
    .toString(36)
    .slice(0, 6);

  // Use timestamp + random for uniqueness
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 5);

  return `bd-${hash}-${timestamp}${random}`;
}
