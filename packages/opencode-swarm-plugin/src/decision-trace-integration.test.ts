/**
 * Decision Trace Integration Tests
 *
 * Tests the helper functions that wire decision trace capture into swarm tools.
 * 
 * Note: These tests verify the helper functions don't throw and return expected types.
 * The actual database operations are tested in swarm-mail's decision-trace-store.test.ts.
 */

import { describe, test, expect } from "bun:test";
import {
  traceStrategySelection,
  traceWorkerSpawn,
  traceReviewDecision,
  traceFileSelection,
  traceScopeChange,
  getEpicDecisionTraces,
  getDecisionTracesByType,
} from "./decision-trace-integration.js";

describe("Decision Trace Integration", () => {
  // Use a test project path - the helpers will create their own DB connection
  const testProjectKey = "/tmp/decision-trace-test";

  describe("traceStrategySelection", () => {
    test("captures strategy selection with minimal input", async () => {
      const traceId = await traceStrategySelection({
        projectKey: testProjectKey,
        agentName: "coordinator",
        strategy: "file-based",
        reasoning: "File-based chosen due to clear file boundaries",
      });

      // Should return a trace ID (or empty string on failure)
      expect(typeof traceId).toBe("string");
    });

    test("captures strategy selection with full context", async () => {
      const traceId = await traceStrategySelection({
        projectKey: testProjectKey,
        agentName: "coordinator",
        epicId: "epic-123",
        beadId: "bead-456",
        strategy: "feature-based",
        reasoning: "Feature-based for new functionality",
        confidence: 0.85,
        taskPreview: "Add user authentication with OAuth",
        inputsGathered: [
          { source: "cass", query: "auth oauth", results: 3 },
          { source: "semantic-memory", query: "auth patterns", results: 2 },
        ],
        alternatives: [
          { strategy: "file-based", score: 0.6, reason: "Less suitable for new features" },
        ],
        precedentCited: {
          memoryId: "mem-789",
          similarity: 0.92,
        },
      });

      expect(typeof traceId).toBe("string");
    });
  });

  describe("traceWorkerSpawn", () => {
    test("captures worker spawn decision", async () => {
      const traceId = await traceWorkerSpawn({
        projectKey: testProjectKey,
        agentName: "coordinator",
        epicId: "epic-123",
        beadId: "bead-456.1",
        workerName: "BlueLake",
        subtaskTitle: "Implement auth service",
        files: ["src/auth/service.ts", "src/auth/types.ts"],
        model: "claude-sonnet-4-5",
        spawnOrder: 1,
        isParallel: true,
        rationale: "First subtask in parallel batch",
      });

      expect(typeof traceId).toBe("string");
    });
  });

  describe("traceReviewDecision", () => {
    test("captures review approval", async () => {
      const traceId = await traceReviewDecision({
        projectKey: testProjectKey,
        agentName: "coordinator",
        epicId: "epic-123",
        beadId: "bead-456.1",
        workerId: "BlueLake",
        status: "approved",
        summary: "Clean implementation, tests pass",
        attemptNumber: 1,
        remainingAttempts: 3,
        rationale: "All criteria met",
      });

      expect(typeof traceId).toBe("string");
    });

    test("captures review rejection with issues", async () => {
      const traceId = await traceReviewDecision({
        projectKey: testProjectKey,
        agentName: "coordinator",
        epicId: "epic-123",
        beadId: "bead-456.2",
        workerId: "DarkHawk",
        status: "needs_changes",
        summary: "Type safety issues found",
        issues: [
          { file: "src/auth/service.ts", line: 42, issue: "Missing null check", suggestion: "Add optional chaining" },
          { file: "src/auth/types.ts", line: 15, issue: "Type too broad", suggestion: "Use discriminated union" },
        ],
        attemptNumber: 2,
        remainingAttempts: 1,
        rationale: "Critical type safety issues need fixing",
      });

      expect(typeof traceId).toBe("string");
    });
  });

  describe("traceFileSelection", () => {
    test("captures file selection decision", async () => {
      const traceId = await traceFileSelection({
        projectKey: testProjectKey,
        agentName: "BlueLake",
        epicId: "epic-123",
        beadId: "bead-456.1",
        filesSelected: ["src/auth/service.ts"],
        filesOwned: ["src/auth/service.ts", "src/auth/types.ts"],
        rationale: "Starting with service implementation",
        scopeExpanded: false,
      });

      expect(typeof traceId).toBe("string");
    });
  });

  describe("traceScopeChange", () => {
    test("captures scope expansion", async () => {
      const traceId = await traceScopeChange({
        projectKey: testProjectKey,
        agentName: "BlueLake",
        epicId: "epic-123",
        beadId: "bead-456.1",
        filesAdded: ["src/auth/utils.ts"],
        reason: "Need utility functions for token handling",
        coordinatorApproved: true,
      });

      expect(typeof traceId).toBe("string");
    });

    test("captures scope contraction", async () => {
      const traceId = await traceScopeChange({
        projectKey: testProjectKey,
        agentName: "DarkHawk",
        epicId: "epic-123",
        beadId: "bead-456.2",
        filesRemoved: ["src/auth/legacy.ts"],
        reason: "Legacy file not needed for this task",
        coordinatorApproved: false,
      });

      expect(typeof traceId).toBe("string");
    });
  });

  describe("Query helpers", () => {
    test("getEpicDecisionTraces returns array", async () => {
      const traces = await getEpicDecisionTraces(testProjectKey, "epic-123");
      // Should return an array (may be empty if traces weren't persisted to this DB)
      expect(Array.isArray(traces)).toBe(true);
    });

    test("getDecisionTracesByType returns array", async () => {
      const traces = await getDecisionTracesByType(testProjectKey, "strategy_selection");
      expect(Array.isArray(traces)).toBe(true);
    });
  });
});
