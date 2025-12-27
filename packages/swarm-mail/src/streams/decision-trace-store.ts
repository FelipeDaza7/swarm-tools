/**
 * Decision Trace Store
 *
 * Service layer for capturing and querying decision traces.
 * Decision traces record the reasoning process of coordinators and workers,
 * enabling post-hoc analysis of how agents arrive at decisions.
 *
 * ## Decision Types
 *
 * - **strategy_selection** - Coordinator choosing decomposition strategy
 * - **worker_spawn** - Coordinator spawning a worker agent
 * - **review_decision** - Coordinator approving/rejecting worker output
 * - **file_selection** - Worker choosing which files to modify
 * - **scope_change** - Worker expanding/contracting task scope
 *
 * ## Usage
 *
 * ```typescript
 * import { createDecisionTrace, getDecisionTracesByEpic } from "./decision-trace-store.js";
 *
 * // Record a decision
 * const trace = await createDecisionTrace(db, {
 *   decision_type: "strategy_selection",
 *   agent_name: "coordinator",
 *   project_key: "/path/to/project",
 *   decision: { strategy: "file-based", confidence: 0.85 },
 *   rationale: "File-based chosen due to clear file boundaries",
 *   inputs_gathered: [{ source: "cass", query: "similar tasks", results: 3 }],
 * });
 *
 * // Query decisions for an epic
 * const traces = await getDecisionTracesByEpic(db, "epic-123");
 * ```
 *
 * @module streams/decision-trace-store
 */

import { nanoid } from "nanoid";
import type { DatabaseAdapter } from "../types/database.js";

/**
 * Input for creating a decision trace.
 * All JSON fields accept objects that will be serialized.
 */
export interface DecisionTraceInput {
  /** Type of decision being made */
  decision_type: string;
  /** Epic this decision relates to (optional) */
  epic_id?: string;
  /** Specific cell/bead this decision relates to (optional) */
  bead_id?: string;
  /** Agent making the decision */
  agent_name: string;
  /** Project key for scoping */
  project_key: string;
  /** The decision itself (JSON-serializable) */
  decision: Record<string, unknown>;
  /** Human-readable explanation of why this decision was made */
  rationale?: string;
  /** Inputs gathered before making the decision */
  inputs_gathered?: Array<Record<string, unknown>>;
  /** Policy rules evaluated during decision */
  policy_evaluated?: Record<string, unknown>;
  /** Alternative decisions considered but rejected */
  alternatives?: Array<Record<string, unknown>>;
  /** Prior decisions or memories cited as precedent */
  precedent_cited?: Record<string, unknown>;
}

/**
 * Stored decision trace with generated fields.
 */
export interface DecisionTrace {
  id: string;
  decision_type: string;
  epic_id: string | null;
  bead_id: string | null;
  agent_name: string;
  project_key: string;
  decision: string; // JSON string
  rationale: string | null;
  inputs_gathered: string | null; // JSON string
  policy_evaluated: string | null; // JSON string
  alternatives: string | null; // JSON string
  precedent_cited: string | null; // JSON string
  outcome_event_id: number | null;
  timestamp: number;
  created_at: string | null;
}

/**
 * Create a new decision trace.
 *
 * Generates a unique ID with `dt-` prefix and records the decision
 * with all provided context.
 *
 * @param db - Database adapter
 * @param input - Decision trace input
 * @returns Created decision trace with generated ID and timestamp
 */
export async function createDecisionTrace(
  db: DatabaseAdapter,
  input: DecisionTraceInput,
): Promise<DecisionTrace> {
  const id = `dt-${nanoid(10)}`;
  const timestamp = Date.now();

  await db.query(
    `INSERT INTO decision_traces (
      id, decision_type, epic_id, bead_id, agent_name, project_key,
      decision, rationale, inputs_gathered, policy_evaluated,
      alternatives, precedent_cited, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.decision_type,
      input.epic_id ?? null,
      input.bead_id ?? null,
      input.agent_name,
      input.project_key,
      JSON.stringify(input.decision),
      input.rationale ?? null,
      input.inputs_gathered ? JSON.stringify(input.inputs_gathered) : null,
      input.policy_evaluated ? JSON.stringify(input.policy_evaluated) : null,
      input.alternatives ? JSON.stringify(input.alternatives) : null,
      input.precedent_cited ? JSON.stringify(input.precedent_cited) : null,
      timestamp,
    ],
  );

  return {
    id,
    decision_type: input.decision_type,
    epic_id: input.epic_id ?? null,
    bead_id: input.bead_id ?? null,
    agent_name: input.agent_name,
    project_key: input.project_key,
    decision: JSON.stringify(input.decision),
    rationale: input.rationale ?? null,
    inputs_gathered: input.inputs_gathered ? JSON.stringify(input.inputs_gathered) : null,
    policy_evaluated: input.policy_evaluated ? JSON.stringify(input.policy_evaluated) : null,
    alternatives: input.alternatives ? JSON.stringify(input.alternatives) : null,
    precedent_cited: input.precedent_cited ? JSON.stringify(input.precedent_cited) : null,
    outcome_event_id: null,
    timestamp,
    created_at: null, // Set by database default
  };
}

/**
 * Get all decision traces for an epic, ordered by timestamp.
 *
 * @param db - Database adapter
 * @param epicId - Epic ID to query
 * @returns Array of decision traces in chronological order
 */
export async function getDecisionTracesByEpic(
  db: DatabaseAdapter,
  epicId: string,
): Promise<DecisionTrace[]> {
  const result = await db.query<DecisionTrace>(
    `SELECT * FROM decision_traces WHERE epic_id = ? ORDER BY timestamp ASC`,
    [epicId],
  );

  return result.rows;
}

/**
 * Get all decision traces for an agent, ordered by timestamp.
 *
 * @param db - Database adapter
 * @param agentName - Agent name to query
 * @returns Array of decision traces in chronological order
 */
export async function getDecisionTracesByAgent(
  db: DatabaseAdapter,
  agentName: string,
): Promise<DecisionTrace[]> {
  const result = await db.query<DecisionTrace>(
    `SELECT * FROM decision_traces WHERE agent_name = ? ORDER BY timestamp ASC`,
    [agentName],
  );

  return result.rows;
}

/**
 * Get all decision traces of a specific type, ordered by timestamp.
 *
 * @param db - Database adapter
 * @param decisionType - Decision type to query
 * @returns Array of decision traces in chronological order
 */
export async function getDecisionTracesByType(
  db: DatabaseAdapter,
  decisionType: string,
): Promise<DecisionTrace[]> {
  const result = await db.query<DecisionTrace>(
    `SELECT * FROM decision_traces WHERE decision_type = ? ORDER BY timestamp ASC`,
    [decisionType],
  );

  return result.rows;
}

/**
 * Link an outcome event to a decision trace.
 *
 * This creates a bidirectional link between the decision and its outcome,
 * enabling analysis of decision quality.
 *
 * @param db - Database adapter
 * @param traceId - Decision trace ID
 * @param outcomeEventId - Event ID of the outcome
 */
export async function linkOutcomeToTrace(
  db: DatabaseAdapter,
  traceId: string,
  outcomeEventId: number,
): Promise<void> {
  await db.query(
    `UPDATE decision_traces SET outcome_event_id = ? WHERE id = ?`,
    [outcomeEventId, traceId],
  );
}
