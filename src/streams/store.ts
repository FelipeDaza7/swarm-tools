/**
 * Event Store - Append-only event log with PGLite
 *
 * Core operations:
 * - append(): Add events to the log
 * - read(): Read events with filters
 * - replay(): Rebuild state from events
 *
 * All state changes go through events. Projections compute current state.
 */
import { getDatabase } from "./index";
import {
  type AgentEvent,
  createEvent,
  type AgentRegisteredEvent,
  type MessageSentEvent,
  type FileReservedEvent,
} from "./events";

// ============================================================================
// Event Store Operations
// ============================================================================

/**
 * Append an event to the log
 *
 * Also updates materialized views (agents, messages, reservations)
 */
export async function appendEvent(
  event: AgentEvent,
  projectPath?: string,
): Promise<AgentEvent & { id: number; sequence: number }> {
  const db = await getDatabase(projectPath);

  // Extract common fields
  const { type, project_key, timestamp, ...rest } = event;

  console.log("[SwarmMail] Appending event", {
    type,
    projectKey: project_key,
    timestamp,
  });

  // Insert event
  const result = await db.query<{ id: number; sequence: number }>(
    `INSERT INTO events (type, project_key, timestamp, data)
     VALUES ($1, $2, $3, $4)
     RETURNING id, sequence`,
    [type, project_key, timestamp, JSON.stringify(rest)],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to insert event - no row returned");
  }
  const { id, sequence } = row;

  console.log("[SwarmMail] Event appended", {
    type,
    id,
    sequence,
    projectKey: project_key,
  });

  // Update materialized views based on event type
  console.debug("[SwarmMail] Updating materialized views", { type, id });
  await updateMaterializedViews(db, { ...event, id, sequence });

  return { ...event, id, sequence };
}

/**
 * Append multiple events in a transaction
 */
export async function appendEvents(
  events: AgentEvent[],
  projectPath?: string,
): Promise<Array<AgentEvent & { id: number; sequence: number }>> {
  const db = await getDatabase(projectPath);
  const results: Array<AgentEvent & { id: number; sequence: number }> = [];

  await db.exec("BEGIN");
  try {
    for (const event of events) {
      const { type, project_key, timestamp, ...rest } = event;

      const result = await db.query<{ id: number; sequence: number }>(
        `INSERT INTO events (type, project_key, timestamp, data)
         VALUES ($1, $2, $3, $4)
         RETURNING id, sequence`,
        [type, project_key, timestamp, JSON.stringify(rest)],
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error("Failed to insert event - no row returned");
      }
      const { id, sequence } = row;
      const enrichedEvent = { ...event, id, sequence };

      await updateMaterializedViews(db, enrichedEvent);
      results.push(enrichedEvent);
    }
    await db.exec("COMMIT");
  } catch (e) {
    // FIX: Log rollback failures (connection lost, etc)
    try {
      await db.exec("ROLLBACK");
    } catch (rollbackError) {
      console.error("[SwarmMail] ROLLBACK failed:", rollbackError);
    }
    throw e;
  }

  return results;
}

/**
 * Read events with optional filters
 */
export async function readEvents(
  options: {
    projectKey?: string;
    types?: AgentEvent["type"][];
    since?: number; // timestamp
    until?: number; // timestamp
    afterSequence?: number;
    limit?: number;
    offset?: number;
  } = {},
  projectPath?: string,
): Promise<Array<AgentEvent & { id: number; sequence: number }>> {
  const db = await getDatabase(projectPath);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (options.projectKey) {
    conditions.push(`project_key = $${paramIndex++}`);
    params.push(options.projectKey);
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
    const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    return {
      id: row.id,
      type: row.type as AgentEvent["type"],
      project_key: row.project_key,
      timestamp: parseInt(row.timestamp as string),
      sequence: row.sequence,
      ...data,
    } as AgentEvent & { id: number; sequence: number };
  });
}

/**
 * Get the latest sequence number
 */
export async function getLatestSequence(
  projectKey?: string,
  projectPath?: string,
): Promise<number> {
  const db = await getDatabase(projectPath);

  const query = projectKey
    ? "SELECT MAX(sequence) as seq FROM events WHERE project_key = $1"
    : "SELECT MAX(sequence) as seq FROM events";

  const params = projectKey ? [projectKey] : [];
  const result = await db.query<{ seq: number | null }>(query, params);

  return result.rows[0]?.seq ?? 0;
}

/**
 * Replay events to rebuild materialized views
 *
 * Useful for:
 * - Recovering from corruption
 * - Migrating to new schema
 * - Debugging state issues
 */
export async function replayEvents(
  options: {
    projectKey?: string;
    fromSequence?: number;
    clearViews?: boolean;
  } = {},
  projectPath?: string,
): Promise<{ eventsReplayed: number; duration: number }> {
  const startTime = Date.now();
  const db = await getDatabase(projectPath);

  // Optionally clear materialized views
  if (options.clearViews) {
    if (options.projectKey) {
      // Use parameterized queries to prevent SQL injection
      await db.query(
        `DELETE FROM message_recipients WHERE message_id IN (
          SELECT id FROM messages WHERE project_key = $1
        )`,
        [options.projectKey],
      );
      await db.query(`DELETE FROM messages WHERE project_key = $1`, [
        options.projectKey,
      ]);
      await db.query(`DELETE FROM reservations WHERE project_key = $1`, [
        options.projectKey,
      ]);
      await db.query(`DELETE FROM agents WHERE project_key = $1`, [
        options.projectKey,
      ]);
    } else {
      await db.exec(`
        DELETE FROM message_recipients;
        DELETE FROM messages;
        DELETE FROM reservations;
        DELETE FROM agents;
      `);
    }
  }

  // Read all events
  const events = await readEvents(
    {
      projectKey: options.projectKey,
      afterSequence: options.fromSequence,
    },
    projectPath,
  );

  // Replay each event
  for (const event of events) {
    await updateMaterializedViews(db, event);
  }

  return {
    eventsReplayed: events.length,
    duration: Date.now() - startTime,
  };
}

// ============================================================================
// Materialized View Updates
// ============================================================================

/**
 * Update materialized views based on event type
 *
 * This is called after each event is appended.
 * Views are denormalized for fast reads.
 */
async function updateMaterializedViews(
  db: Awaited<ReturnType<typeof getDatabase>>,
  event: AgentEvent & { id: number; sequence: number },
): Promise<void> {
  try {
    switch (event.type) {
      case "agent_registered":
        await handleAgentRegistered(
          db,
          event as AgentRegisteredEvent & { id: number; sequence: number },
        );
        break;

      case "agent_active":
        await db.query(
          `UPDATE agents SET last_active_at = $1 WHERE project_key = $2 AND name = $3`,
          [event.timestamp, event.project_key, event.agent_name],
        );
        break;

      case "message_sent":
        await handleMessageSent(
          db,
          event as MessageSentEvent & { id: number; sequence: number },
        );
        break;

      case "message_read":
        await db.query(
          `UPDATE message_recipients SET read_at = $1 WHERE message_id = $2 AND agent_name = $3`,
          [event.timestamp, event.message_id, event.agent_name],
        );
        break;

      case "message_acked":
        await db.query(
          `UPDATE message_recipients SET acked_at = $1 WHERE message_id = $2 AND agent_name = $3`,
          [event.timestamp, event.message_id, event.agent_name],
        );
        break;

      case "file_reserved":
        await handleFileReserved(
          db,
          event as FileReservedEvent & { id: number; sequence: number },
        );
        break;

      case "file_released":
        await handleFileReleased(db, event);
        break;

      // Task events don't need materialized views (query events directly)
      case "task_started":
      case "task_progress":
      case "task_completed":
      case "task_blocked":
        // No-op for now - could add task tracking table later
        break;
    }
  } catch (error) {
    console.error("[SwarmMail] Failed to update materialized views", {
      eventType: event.type,
      eventId: event.id,
      error,
    });
    throw error;
  }
}

async function handleAgentRegistered(
  db: Awaited<ReturnType<typeof getDatabase>>,
  event: AgentRegisteredEvent & { id: number; sequence: number },
): Promise<void> {
  await db.query(
    `INSERT INTO agents (project_key, name, program, model, task_description, registered_at, last_active_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (project_key, name) DO UPDATE SET
       program = EXCLUDED.program,
       model = EXCLUDED.model,
       task_description = EXCLUDED.task_description,
       last_active_at = EXCLUDED.last_active_at`,
    [
      event.project_key,
      event.agent_name,
      event.program,
      event.model,
      event.task_description || null,
      event.timestamp,
    ],
  );
}

async function handleMessageSent(
  db: Awaited<ReturnType<typeof getDatabase>>,
  event: MessageSentEvent & { id: number; sequence: number },
): Promise<void> {
  console.log("[SwarmMail] Handling message sent event", {
    from: event.from_agent,
    to: event.to_agents,
    subject: event.subject,
    projectKey: event.project_key,
  });

  // Insert message
  const result = await db.query<{ id: number }>(
    `INSERT INTO messages (project_key, from_agent, subject, body, thread_id, importance, ack_required, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      event.project_key,
      event.from_agent,
      event.subject,
      event.body,
      event.thread_id || null,
      event.importance,
      event.ack_required,
      event.timestamp,
    ],
  );

  const msgRow = result.rows[0];
  if (!msgRow) {
    throw new Error("Failed to insert message - no row returned");
  }
  const messageId = msgRow.id;

  // FIX: Bulk insert recipients to avoid N+1 queries
  if (event.to_agents.length > 0) {
    const values = event.to_agents.map((_, i) => `($1, $${i + 2})`).join(", ");
    const params = [messageId, ...event.to_agents];

    await db.query(
      `INSERT INTO message_recipients (message_id, agent_name)
       VALUES ${values}
       ON CONFLICT DO NOTHING`,
      params,
    );

    console.log("[SwarmMail] Message recipients inserted", {
      messageId,
      recipientCount: event.to_agents.length,
    });
  }
}

async function handleFileReserved(
  db: Awaited<ReturnType<typeof getDatabase>>,
  event: FileReservedEvent & { id: number; sequence: number },
): Promise<void> {
  console.log("[SwarmMail] Handling file reservation event", {
    agent: event.agent_name,
    paths: event.paths,
    exclusive: event.exclusive,
    projectKey: event.project_key,
  });

  // FIX: Bulk insert reservations to avoid N+1 queries
  if (event.paths.length > 0) {
    // Each path gets its own VALUES clause with placeholders:
    // ($1=project_key, $2=agent_name, $3=path1, $4=exclusive, $5=reason, $6=created_at, $7=expires_at)
    // ($1=project_key, $2=agent_name, $8=path2, $4=exclusive, $5=reason, $6=created_at, $7=expires_at)
    // etc.
    const values = event.paths
      .map(
        (_, i) =>
          `($1, $2, $${i + 3}, $${event.paths.length + 3}, $${event.paths.length + 4}, $${event.paths.length + 5}, $${event.paths.length + 6})`,
      )
      .join(", ");

    const params = [
      event.project_key, // $1
      event.agent_name, // $2
      ...event.paths, // $3, $4, ... (one per path)
      event.exclusive, // $N+3
      event.reason || null, // $N+4
      event.timestamp, // $N+5
      event.expires_at, // $N+6
    ];

    await db.query(
      `INSERT INTO reservations (project_key, agent_name, path_pattern, exclusive, reason, created_at, expires_at)
       VALUES ${values}`,
      params,
    );

    console.log("[SwarmMail] File reservations inserted", {
      agent: event.agent_name,
      reservationCount: event.paths.length,
    });
  }
}

async function handleFileReleased(
  db: Awaited<ReturnType<typeof getDatabase>>,
  event: AgentEvent & { id: number; sequence: number },
): Promise<void> {
  if (event.type !== "file_released") return;

  if (event.reservation_ids && event.reservation_ids.length > 0) {
    // Release specific reservations
    await db.query(
      `UPDATE reservations SET released_at = $1 WHERE id = ANY($2)`,
      [event.timestamp, event.reservation_ids],
    );
  } else if (event.paths && event.paths.length > 0) {
    // Release by path
    await db.query(
      `UPDATE reservations SET released_at = $1
       WHERE project_key = $2 AND agent_name = $3 AND path_pattern = ANY($4) AND released_at IS NULL`,
      [event.timestamp, event.project_key, event.agent_name, event.paths],
    );
  } else {
    // Release all for agent
    await db.query(
      `UPDATE reservations SET released_at = $1
       WHERE project_key = $2 AND agent_name = $3 AND released_at IS NULL`,
      [event.timestamp, event.project_key, event.agent_name],
    );
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Register an agent (creates event + updates view)
 */
export async function registerAgent(
  projectKey: string,
  agentName: string,
  options: {
    program?: string;
    model?: string;
    taskDescription?: string;
  } = {},
  projectPath?: string,
): Promise<AgentRegisteredEvent & { id: number; sequence: number }> {
  const event = createEvent("agent_registered", {
    project_key: projectKey,
    agent_name: agentName,
    program: options.program || "opencode",
    model: options.model || "unknown",
    task_description: options.taskDescription,
  });

  return appendEvent(event, projectPath) as Promise<
    AgentRegisteredEvent & { id: number; sequence: number }
  >;
}

/**
 * Send a message (creates event + updates view)
 */
export async function sendMessage(
  projectKey: string,
  fromAgent: string,
  toAgents: string[],
  subject: string,
  body: string,
  options: {
    threadId?: string;
    importance?: "low" | "normal" | "high" | "urgent";
    ackRequired?: boolean;
  } = {},
  projectPath?: string,
): Promise<MessageSentEvent & { id: number; sequence: number }> {
  const event = createEvent("message_sent", {
    project_key: projectKey,
    from_agent: fromAgent,
    to_agents: toAgents,
    subject,
    body,
    thread_id: options.threadId,
    importance: options.importance || "normal",
    ack_required: options.ackRequired || false,
  });

  return appendEvent(event, projectPath) as Promise<
    MessageSentEvent & { id: number; sequence: number }
  >;
}

/**
 * Reserve files (creates event + updates view)
 */
export async function reserveFiles(
  projectKey: string,
  agentName: string,
  paths: string[],
  options: {
    reason?: string;
    exclusive?: boolean;
    ttlSeconds?: number;
  } = {},
  projectPath?: string,
): Promise<FileReservedEvent & { id: number; sequence: number }> {
  const ttlSeconds = options.ttlSeconds || 3600;
  const event = createEvent("file_reserved", {
    project_key: projectKey,
    agent_name: agentName,
    paths,
    reason: options.reason,
    exclusive: options.exclusive ?? true,
    ttl_seconds: ttlSeconds,
    expires_at: Date.now() + ttlSeconds * 1000,
  });

  return appendEvent(event, projectPath) as Promise<
    FileReservedEvent & { id: number; sequence: number }
  >;
}
