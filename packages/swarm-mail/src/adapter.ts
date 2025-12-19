/**
 * SwarmMail Adapter - Factory for creating SwarmMailAdapter instances
 *
 * This file implements the adapter pattern for swarm-mail, enabling
 * dependency injection of the database instead of singleton access.
 *
 * ## Design Pattern
 * - Accept DatabaseAdapter via factory parameter
 * - Return SwarmMailAdapter interface
 * - Delegate to internal implementation functions
 * - No direct database access (all via adapter)
 *
 * ## Usage
 * ```typescript
 * import { createPGLiteAdapter } from '@opencode/swarm-mail/adapters/pglite';
 * import { createSwarmMailAdapter } from '@opencode/swarm-mail';
 *
 * const dbAdapter = createPGLiteAdapter({ path: './streams.db' });
 * const swarmMail = createSwarmMailAdapter(dbAdapter, '/path/to/project');
 *
 * // Use the adapter
 * await swarmMail.appendEvent(event);
 * const messages = await swarmMail.getInbox('agent-name', { limit: 5 });
 * ```
 */

import type { DatabaseAdapter } from "./types/database";
import type { SwarmMailAdapter } from "./types/adapter";
import type {
  AgentRegisteredEvent,
  MessageSentEvent,
  FileReservedEvent,
} from "./streams/events";

// Import all implementation functions (now refactored to accept dbOverride)
import {
  appendEvent,
  appendEvents,
  readEvents,
  getLatestSequence,
  replayEvents,
  registerAgent,
  sendMessage,
  reserveFiles,
} from "./streams/store";

import {
  getAgents,
  getAgent,
  getInbox,
  getMessage,
  getThreadMessages,
  getActiveReservations,
  checkConflicts,
} from "./streams/projections";

import { appendEvent as appendEventUtil } from "./streams/store";
import { createEvent } from "./streams/events";

/**
 * Create a SwarmMailAdapter instance
 *
 * @param db - DatabaseAdapter instance (PGLite, SQLite, PostgreSQL, etc.)
 * @param projectKey - Project identifier (typically the project path)
 * @returns SwarmMailAdapter interface
 */
export function createSwarmMailAdapter(
  db: DatabaseAdapter,
  projectKey: string,
): SwarmMailAdapter {
  return {
    // ============================================================================
    // Event Store Operations
    // ============================================================================

    async appendEvent(event, projectPath?) {
      return appendEvent(event, projectPath, db);
    },

    async appendEvents(events, projectPath?) {
      return appendEvents(events, projectPath, db);
    },

    async readEvents(options?, projectPath?) {
      return readEvents(options, projectPath, db);
    },

    async getLatestSequence(projectKeyParam?, projectPath?) {
      return getLatestSequence(projectKeyParam, projectPath, db);
    },

    async replayEvents(options?, projectPath?) {
      return replayEvents(options, projectPath, db);
    },

    // ============================================================================
    // Agent Operations
    // ============================================================================

    async registerAgent(
      projectKeyParam,
      agentName,
      options?,
      projectPath?,
    ): Promise<AgentRegisteredEvent & { id: number; sequence: number }> {
      return registerAgent(
        projectKeyParam,
        agentName,
        options,
        projectPath,
        db,
      );
    },

    async getAgents(projectKeyParam, projectPath?) {
      return getAgents(projectKeyParam, projectPath, db);
    },

    async getAgent(projectKeyParam, agentName, projectPath?) {
      return getAgent(projectKeyParam, agentName, projectPath, db);
    },

    // ============================================================================
    // Messaging Operations
    // ============================================================================

    async sendMessage(
      projectKeyParam,
      fromAgent,
      toAgents,
      subject,
      body,
      options?,
      projectPath?,
    ): Promise<MessageSentEvent & { id: number; sequence: number }> {
      return sendMessage(
        projectKeyParam,
        fromAgent,
        toAgents,
        subject,
        body,
        options,
        projectPath,
        db,
      );
    },

    async getInbox(projectKeyParam, agentName, options?, projectPath?) {
      return getInbox(projectKeyParam, agentName, options, projectPath, db);
    },

    async getMessage(projectKeyParam, messageId, projectPath?) {
      return getMessage(projectKeyParam, messageId, projectPath, db);
    },

    async getThreadMessages(projectKeyParam, threadId, projectPath?) {
      return getThreadMessages(projectKeyParam, threadId, projectPath, db);
    },

    async markMessageAsRead(
      projectKeyParam,
      messageId,
      agentName,
      projectPath?,
    ) {
      // Create message_read event
      const event = createEvent("message_read", {
        project_key: projectKeyParam,
        message_id: messageId,
        agent_name: agentName,
      });

      await appendEventUtil(event, projectPath, db);
    },

    async acknowledgeMessage(
      projectKeyParam,
      messageId,
      agentName,
      projectPath?,
    ) {
      // Create message_acked event
      const event = createEvent("message_acked", {
        project_key: projectKeyParam,
        message_id: messageId,
        agent_name: agentName,
      });

      await appendEventUtil(event, projectPath, db);
    },

    // ============================================================================
    // Reservation Operations
    // ============================================================================

    async reserveFiles(
      projectKeyParam,
      agentName,
      paths,
      options?,
      projectPath?,
    ): Promise<FileReservedEvent & { id: number; sequence: number }> {
      return reserveFiles(
        projectKeyParam,
        agentName,
        paths,
        options,
        projectPath,
        db,
      );
    },

    async releaseFiles(projectKeyParam, agentName, options?, projectPath?) {
      // Create file_released event
      const event = createEvent("file_released", {
        project_key: projectKeyParam,
        agent_name: agentName,
        paths: options?.paths,
        reservation_ids: options?.reservationIds,
      });

      await appendEventUtil(event, projectPath, db);
    },

    async getActiveReservations(projectKeyParam, projectPath?, agentName?) {
      return getActiveReservations(projectKeyParam, projectPath, agentName, db);
    },

    async checkConflicts(projectKeyParam, agentName, paths, projectPath?) {
      return checkConflicts(projectKeyParam, agentName, paths, projectPath, db);
    },

    // ============================================================================
    // Schema and Health Operations
    // ============================================================================

    async runMigrations(projectPath?) {
      // Import migrations module and pass db
      // Note: migrations expects PGlite but DatabaseAdapter is compatible
      const { runMigrations: runMigrationsImpl } =
        await import("./streams/migrations");
      await runMigrationsImpl(db as any);
      
      // Force checkpoint after migrations to prevent WAL bloat
      // Critical for embedded PGLite - prevents 930 WAL file accumulation
      if (db.checkpoint) {
        await db.checkpoint();
      }
    },

    async healthCheck(options, projectPath?) {
      // Check basic connectivity
      let connected = false;
      try {
        const result = await db.query("SELECT 1 as ok");
        connected = result.rows.length > 0;
      } catch {
        connected = false;
      }

      // Check WAL health if supported
      let walHealth: { healthy: boolean; message: string } | undefined;
      if (db.checkWalHealth) {
        try {
          walHealth = await db.checkWalHealth(options?.walThresholdMb);
        } catch {
          // Silently ignore WAL health check failures
          // Not all databases support this
        }
      }

      return { connected, walHealth };
    },

    async getDatabaseStats(projectPath?) {
      const [events, agents, messages, reservations] = await Promise.all([
        db.query<{ count: string }>("SELECT COUNT(*) as count FROM events"),
        db.query<{ count: string }>("SELECT COUNT(*) as count FROM agents"),
        db.query<{ count: string }>("SELECT COUNT(*) as count FROM messages"),
        db.query<{ count: string }>(
          "SELECT COUNT(*) as count FROM reservations WHERE released_at IS NULL",
        ),
      ]);

      // Get WAL stats if supported
      let wal: { size: number; fileCount: number } | undefined;
      if (db.getWalStats) {
        try {
          const { walSize, walFileCount } = await db.getWalStats();
          wal = { size: walSize, fileCount: walFileCount };
        } catch {
          // Silently ignore WAL stats failures
        }
      }

      return {
        events: parseInt(events.rows[0]?.count || "0"),
        agents: parseInt(agents.rows[0]?.count || "0"),
        messages: parseInt(messages.rows[0]?.count || "0"),
        reservations: parseInt(reservations.rows[0]?.count || "0"),
        wal,
      };
    },

    async resetDatabase(projectPath?) {
      await db.exec(`
				DELETE FROM message_recipients;
				DELETE FROM messages;
				DELETE FROM reservations;
				DELETE FROM agents;
				DELETE FROM events;
				DELETE FROM locks;
				DELETE FROM cursors;
			`);
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
      // For single-instance adapter, same as close()
      if (db.close) {
        await db.close();
      }
    },
  };
}
