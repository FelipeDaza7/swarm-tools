/**
 * Decision Trace Store Tests
 *
 * TDD tests for decision trace storage and retrieval.
 * Tests the service layer for capturing coordinator/worker decision-making.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createLibSQLAdapter } from "../libsql.js";
import type { DatabaseAdapter } from "../types/database.js";
import { createLibSQLStreamsSchema } from "./libsql-schema.js";
import {
  createDecisionTrace,
  getDecisionTracesByEpic,
  getDecisionTracesByAgent,
  getDecisionTracesByType,
  linkOutcomeToTrace,
  type DecisionTraceInput,
} from "./decision-trace-store.js";

describe("DecisionTraceStore", () => {
  let db: DatabaseAdapter;

  beforeAll(async () => {
    db = await createLibSQLAdapter({ url: ":memory:" });
    await createLibSQLStreamsSchema(db);
  });

  afterAll(async () => {
    await db.close?.();
  });

  describe("createDecisionTrace", () => {
    test("creates a decision trace with all fields", async () => {
      const input: DecisionTraceInput = {
        decision_type: "strategy_selection",
        epic_id: "epic-001",
        bead_id: "bead-001",
        agent_name: "coordinator",
        project_key: "/project/path",
        decision: { strategy: "file-based", confidence: 0.85 },
        rationale: "File-based chosen due to clear file boundaries",
        inputs_gathered: [
          { source: "cass", query: "similar tasks", results: 3 },
        ],
        policy_evaluated: { rule: "prefer file-based for <5 files", matched: true },
        alternatives: [
          { strategy: "feature-based", reason: "rejected: cross-cutting concerns" },
        ],
        precedent_cited: { memory_id: "mem-xyz", similarity: 0.92 },
      };

      const trace = await createDecisionTrace(db, input);

      expect(trace.id).toMatch(/^dt-/);
      expect(trace.decision_type).toBe("strategy_selection");
      expect(trace.agent_name).toBe("coordinator");
      expect(trace.rationale).toBe("File-based chosen due to clear file boundaries");
      expect(trace.timestamp).toBeGreaterThan(0);
    });

    test("creates a decision trace with minimal fields", async () => {
      const input: DecisionTraceInput = {
        decision_type: "worker_spawn",
        agent_name: "coordinator",
        project_key: "/project/path",
        decision: { worker: "BlueLake", task: "bead-002" },
      };

      const trace = await createDecisionTrace(db, input);

      expect(trace.id).toMatch(/^dt-/);
      expect(trace.decision_type).toBe("worker_spawn");
      expect(trace.epic_id).toBeNull();
      expect(trace.rationale).toBeNull();
    });

    test("generates unique IDs for each trace", async () => {
      const input: DecisionTraceInput = {
        decision_type: "review_decision",
        agent_name: "coordinator",
        project_key: "/project/path",
        decision: { approved: true },
      };

      const trace1 = await createDecisionTrace(db, input);
      const trace2 = await createDecisionTrace(db, input);

      expect(trace1.id).not.toBe(trace2.id);
    });
  });

  describe("getDecisionTracesByEpic", () => {
    test("returns all traces for an epic in chronological order", async () => {
      const epicId = "epic-query-test";

      // Create traces with different timestamps
      await createDecisionTrace(db, {
        decision_type: "strategy_selection",
        epic_id: epicId,
        agent_name: "coordinator",
        project_key: "/project",
        decision: { step: 1 },
      });

      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));

      await createDecisionTrace(db, {
        decision_type: "worker_spawn",
        epic_id: epicId,
        agent_name: "coordinator",
        project_key: "/project",
        decision: { step: 2 },
      });

      const traces = await getDecisionTracesByEpic(db, epicId);

      expect(traces.length).toBeGreaterThanOrEqual(2);
      expect(traces[0].decision_type).toBe("strategy_selection");
      expect(traces[1].decision_type).toBe("worker_spawn");
    });

    test("returns empty array for non-existent epic", async () => {
      const traces = await getDecisionTracesByEpic(db, "epic-does-not-exist");
      expect(traces).toEqual([]);
    });
  });

  describe("getDecisionTracesByAgent", () => {
    test("returns all traces for an agent", async () => {
      const agentName = "test-agent-unique";

      await createDecisionTrace(db, {
        decision_type: "file_selection",
        agent_name: agentName,
        project_key: "/project",
        decision: { files: ["a.ts", "b.ts"] },
      });

      const traces = await getDecisionTracesByAgent(db, agentName);

      expect(traces.length).toBeGreaterThanOrEqual(1);
      expect(traces[0].agent_name).toBe(agentName);
    });
  });

  describe("getDecisionTracesByType", () => {
    test("returns all traces of a specific type", async () => {
      const uniqueType = "unique_decision_type";

      await createDecisionTrace(db, {
        decision_type: uniqueType,
        agent_name: "coordinator",
        project_key: "/project",
        decision: { unique: true },
      });

      const traces = await getDecisionTracesByType(db, uniqueType);

      expect(traces.length).toBeGreaterThanOrEqual(1);
      expect(traces[0].decision_type).toBe(uniqueType);
    });
  });

  describe("linkOutcomeToTrace", () => {
    test("links an outcome event to a decision trace", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "worker_spawn",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { worker: "BlueLake" },
      });

      const outcomeEventId = 42;
      await linkOutcomeToTrace(db, trace.id, outcomeEventId);

      // Verify by querying
      const result = await db.query<{ outcome_event_id: number }>(
        `SELECT outcome_event_id FROM decision_traces WHERE id = ?`,
        [trace.id]
      );

      expect(result.rows[0].outcome_event_id).toBe(42);
    });
  });

  describe("decision types", () => {
    test("supports strategy_selection type", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "strategy_selection",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { strategy: "file-based" },
        inputs_gathered: [{ source: "cass", results: 5 }],
      });

      expect(trace.decision_type).toBe("strategy_selection");
    });

    test("supports worker_spawn type", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "worker_spawn",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { worker: "BlueLake", bead_id: "bead-123" },
      });

      expect(trace.decision_type).toBe("worker_spawn");
    });

    test("supports review_decision type", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "review_decision",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { approved: false, issues: ["missing tests"] },
      });

      expect(trace.decision_type).toBe("review_decision");
    });

    test("supports file_selection type", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "file_selection",
        agent_name: "worker-1",
        project_key: "/project",
        decision: { files: ["src/auth.ts"], reason: "auth changes" },
      });

      expect(trace.decision_type).toBe("file_selection");
    });

    test("supports scope_change type", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "scope_change",
        agent_name: "worker-1",
        project_key: "/project",
        decision: { added: ["src/utils.ts"], reason: "dependency discovered" },
      });

      expect(trace.decision_type).toBe("scope_change");
    });
  });
});
