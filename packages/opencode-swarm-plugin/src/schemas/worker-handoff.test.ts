/**
 * Tests for WorkerHandoff schema validation
 *
 * WorkerHandoff replaces prose instructions with structured contracts.
 * These tests ensure runtime validation catches malformed handoffs.
 */
import { describe, expect, test } from "bun:test";
import {
  WorkerHandoffContractSchema,
  WorkerHandoffContextSchema,
  WorkerHandoffEscalationSchema,
  WorkerHandoffSchema,
  type WorkerHandoff,
  type WorkerHandoffContract,
  type WorkerHandoffContext,
  type WorkerHandoffEscalation,
} from "./worker-handoff";

describe("WorkerHandoffContractSchema", () => {
  test("valid contract parses correctly", () => {
    const validContract = {
      task_id: "opencode-swarm-monorepo-lf2p4u-abc123",
      files_owned: ["src/auth/service.ts", "src/auth/schema.ts"],
      files_readonly: ["src/lib/jwt.ts"],
      dependencies_completed: ["opencode-swarm-monorepo-lf2p4u-abc122"],
      success_criteria: [
        "Auth service implements JWT strategy",
        "All tests pass",
      ],
    };

    const result = WorkerHandoffContractSchema.safeParse(validContract);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.task_id).toBe("opencode-swarm-monorepo-lf2p4u-abc123");
      expect(result.data.files_owned).toHaveLength(2);
      expect(result.data.success_criteria).toHaveLength(2);
    }
  });

  test("missing task_id fails", () => {
    const invalidContract = {
      files_owned: ["src/auth.ts"],
      files_readonly: [],
      dependencies_completed: [],
      success_criteria: ["Auth works"],
    };

    const result = WorkerHandoffContractSchema.safeParse(invalidContract);
    expect(result.success).toBe(false);
  });

  test("empty files_owned is valid (read-only tasks)", () => {
    const readOnlyContract = {
      task_id: "opencode-swarm-monorepo-lf2p4u-abc123",
      files_owned: [], // Read-only task
      files_readonly: ["src/types.ts"],
      dependencies_completed: [],
      success_criteria: ["Documentation updated"],
    };

    const result = WorkerHandoffContractSchema.safeParse(readOnlyContract);
    expect(result.success).toBe(true);
  });

  test("empty success_criteria fails", () => {
    const invalidContract = {
      task_id: "opencode-swarm-monorepo-lf2p4u-abc123",
      files_owned: ["src/auth.ts"],
      files_readonly: [],
      dependencies_completed: [],
      success_criteria: [], // Must have at least one
    };

    const result = WorkerHandoffContractSchema.safeParse(invalidContract);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        "at least one success criterion",
      );
    }
  });

  test("empty task_id fails", () => {
    const invalidContract = {
      task_id: "", // Empty string not allowed
      files_owned: ["src/auth.ts"],
      files_readonly: [],
      dependencies_completed: [],
      success_criteria: ["Auth works"],
    };

    const result = WorkerHandoffContractSchema.safeParse(invalidContract);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("cannot be empty");
    }
  });

  test("short project name with hash is valid", () => {
    // Regression test: single-word project names like "swarm-lf2p4u-abc123" should work
    const shortProjectContract = {
      task_id: "swarm-lf2p4u-abc123", // Only 2 segments before timestamp
      files_owned: ["src/auth.ts"],
      files_readonly: [],
      dependencies_completed: [],
      success_criteria: ["Auth works"],
    };

    const result = WorkerHandoffContractSchema.safeParse(shortProjectContract);
    expect(result.success).toBe(true);
  });

  test("partial hash is valid (resolvePartialId will expand it)", () => {
    // Partial hashes should be accepted - resolvePartialId will expand them
    const partialHashContract = {
      task_id: "mjd4pjuj", // Short hash only
      files_owned: ["src/auth.ts"],
      files_readonly: [],
      dependencies_completed: [],
      success_criteria: ["Auth works"],
    };

    const result = WorkerHandoffContractSchema.safeParse(partialHashContract);
    expect(result.success).toBe(true);
  });
});

describe("WorkerHandoffContextSchema", () => {
  test("valid context parses correctly", () => {
    const validContext = {
      epic_summary: "Add authentication system",
      your_role: "Implement JWT auth service",
      what_others_did: "Schema defined by agent-1",
      what_comes_next: "Integration tests in next subtask",
    };

    const result = WorkerHandoffContextSchema.safeParse(validContext);
    expect(result.success).toBe(true);
  });

  test("missing required fields fails", () => {
    const invalidContext = {
      epic_summary: "Add auth",
      your_role: "Implement service",
      // Missing what_others_did and what_comes_next
    };

    const result = WorkerHandoffContextSchema.safeParse(invalidContext);
    expect(result.success).toBe(false);
  });

  test("empty strings are valid", () => {
    const contextWithEmptyStrings = {
      epic_summary: "Add auth",
      your_role: "Implement service",
      what_others_did: "", // Valid for first subtask
      what_comes_next: "", // Valid for last subtask
    };

    const result = WorkerHandoffContextSchema.safeParse(
      contextWithEmptyStrings,
    );
    expect(result.success).toBe(true);
  });
});

describe("WorkerHandoffEscalationSchema", () => {
  test("valid escalation parses correctly", () => {
    const validEscalation = {
      blocked_contact: "Message coordinator via swarmmail_send(importance='high')",
      scope_change_protocol:
        "Request approval before expanding scope beyond files_owned",
    };

    const result = WorkerHandoffEscalationSchema.safeParse(validEscalation);
    expect(result.success).toBe(true);
  });

  test("missing required fields fails", () => {
    const invalidEscalation = {
      blocked_contact: "Message coordinator",
      // Missing scope_change_protocol
    };

    const result = WorkerHandoffEscalationSchema.safeParse(invalidEscalation);
    expect(result.success).toBe(false);
  });
});

describe("WorkerHandoffSchema", () => {
  test("complete valid handoff parses correctly", () => {
    const validHandoff = {
      contract: {
        task_id: "opencode-swarm-monorepo-lf2p4u-abc123",
        files_owned: ["src/auth/service.ts"],
        files_readonly: ["src/lib/jwt.ts"],
        dependencies_completed: [],
        success_criteria: ["Service implemented", "Tests pass"],
      },
      context: {
        epic_summary: "Add authentication",
        your_role: "Implement auth service",
        what_others_did: "Schema defined",
        what_comes_next: "Integration tests",
      },
      escalation: {
        blocked_contact: "Message coordinator",
        scope_change_protocol: "Request approval first",
      },
    };

    const result = WorkerHandoffSchema.safeParse(validHandoff);
    expect(result.success).toBe(true);
    if (result.success) {
      const handoff: WorkerHandoff = result.data;
      expect(handoff.contract.task_id).toBe(
        "opencode-swarm-monorepo-lf2p4u-abc123",
      );
      expect(handoff.context.your_role).toBe("Implement auth service");
      expect(handoff.escalation.blocked_contact).toBe("Message coordinator");
    }
  });

  test("missing contract section fails", () => {
    const invalidHandoff = {
      context: {
        epic_summary: "Add auth",
        your_role: "Implement",
        what_others_did: "Schema",
        what_comes_next: "Tests",
      },
      escalation: {
        blocked_contact: "Message coordinator",
        scope_change_protocol: "Request approval",
      },
    };

    const result = WorkerHandoffSchema.safeParse(invalidHandoff);
    expect(result.success).toBe(false);
  });

  test("nested validation catches contract errors", () => {
    const handoffWithInvalidContract = {
      contract: {
        task_id: "opencode-swarm-monorepo-lf2p4u-abc123",
        files_owned: ["src/auth.ts"],
        files_readonly: [],
        dependencies_completed: [],
        success_criteria: [], // Invalid: empty
      },
      context: {
        epic_summary: "Add auth",
        your_role: "Implement",
        what_others_did: "Schema",
        what_comes_next: "Tests",
      },
      escalation: {
        blocked_contact: "Message coordinator",
        scope_change_protocol: "Request approval",
      },
    };

    const result = WorkerHandoffSchema.safeParse(handoffWithInvalidContract);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errorMessage = result.error.issues[0].message;
      expect(errorMessage).toContain("at least one success criterion");
    }
  });

  test("type inference works correctly", () => {
    const handoff: WorkerHandoff = {
      contract: {
        task_id: "opencode-swarm-monorepo-lf2p4u-abc123",
        files_owned: [],
        files_readonly: [],
        dependencies_completed: [],
        success_criteria: ["Done"],
      },
      context: {
        epic_summary: "Summary",
        your_role: "Role",
        what_others_did: "Nothing",
        what_comes_next: "More work",
      },
      escalation: {
        blocked_contact: "Coordinator",
        scope_change_protocol: "Ask first",
      },
    };

    // Type check only - verify TypeScript inference
    const contract: WorkerHandoffContract = handoff.contract;
    const context: WorkerHandoffContext = handoff.context;
    const escalation: WorkerHandoffEscalation = handoff.escalation;

    expect(contract.task_id).toBeDefined();
    expect(context.your_role).toBeDefined();
    expect(escalation.blocked_contact).toBeDefined();
  });
});
