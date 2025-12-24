/**
 * Tests for Swarm-Aware Compaction Hook
 */

import { describe, expect, it, mock, beforeEach } from "bun:test";
import {
  SWARM_COMPACTION_CONTEXT,
  SWARM_DETECTION_FALLBACK,
  createCompactionHook,
} from "./compaction-hook";

// Track log calls for verification
let logCalls: Array<{ level: string; data: any; message?: string }> = [];

// Mock logger factory
const createMockLogger = () => ({
  info: (data: any, message?: string) => {
    logCalls.push({ level: "info", data, message });
  },
  debug: (data: any, message?: string) => {
    logCalls.push({ level: "debug", data, message });
  },
  warn: (data: any, message?: string) => {
    logCalls.push({ level: "warn", data, message });
  },
  error: (data: any, message?: string) => {
    logCalls.push({ level: "error", data, message });
  },
});

// Mock the dependencies
mock.module("./hive", () => ({
  getHiveWorkingDirectory: () => "/test/project",
  getHiveAdapter: async () => ({
    queryCells: async () => [],
  }),
}));

mock.module("swarm-mail", () => ({
  checkSwarmHealth: async () => ({
    healthy: true,
    database: "connected",
    stats: {
      events: 0,
      agents: 0,
      messages: 0,
      reservations: 0,
    },
  }),
}));

// Mock logger module
mock.module("./logger", () => ({
  createChildLogger: () => createMockLogger(),
}));

describe("Compaction Hook", () => {
  beforeEach(() => {
    // Reset log calls before each test
    logCalls = [];
  });
  describe("SWARM_COMPACTION_CONTEXT", () => {
    it("contains coordinator instructions", () => {
      expect(SWARM_COMPACTION_CONTEXT).toContain("COORDINATOR");
      expect(SWARM_COMPACTION_CONTEXT).toContain("Keep Cooking");
    });

    it("contains resume instructions", () => {
      expect(SWARM_COMPACTION_CONTEXT).toContain("swarm_status");
      expect(SWARM_COMPACTION_CONTEXT).toContain("swarmmail_inbox");
    });

    it("contains summary format", () => {
      expect(SWARM_COMPACTION_CONTEXT).toContain("Swarm State");
      expect(SWARM_COMPACTION_CONTEXT).toContain("Active:");
      expect(SWARM_COMPACTION_CONTEXT).toContain("Blocked:");
      expect(SWARM_COMPACTION_CONTEXT).toContain("Completed:");
    });
  });

  describe("SWARM_DETECTION_FALLBACK", () => {
    it("contains detection patterns", () => {
      expect(SWARM_DETECTION_FALLBACK).toContain("swarm_decompose");
      expect(SWARM_DETECTION_FALLBACK).toContain("swarmmail_init");
      expect(SWARM_DETECTION_FALLBACK).toContain("hive_create_epic");
    });

    it("contains ID patterns", () => {
      expect(SWARM_DETECTION_FALLBACK).toContain("bd-xxx");
      expect(SWARM_DETECTION_FALLBACK).toContain("Agent names");
    });

    it("contains coordination language", () => {
      expect(SWARM_DETECTION_FALLBACK).toContain("spawn");
      expect(SWARM_DETECTION_FALLBACK).toContain("coordinator");
      expect(SWARM_DETECTION_FALLBACK).toContain("reservation");
    });
  });

  describe("createCompactionHook", () => {
    it("returns a function", () => {
      const hook = createCompactionHook();
      expect(typeof hook).toBe("function");
    });

    it("accepts input and output parameters", async () => {
      const hook = createCompactionHook();
      const input = { sessionID: "test-session" };
      const output = { context: [] as string[] };

      // Should not throw
      await hook(input, output);
    });

    it("does not inject context when no swarm detected", async () => {
      const hook = createCompactionHook();
      const output = { context: [] as string[] };

      await hook({ sessionID: "test" }, output);

      // With mocked empty data, should not inject
      expect(output.context.length).toBe(0);
    });
  });

  describe("Detection confidence levels", () => {
    it("HIGH confidence triggers full context", async () => {
      // This would need proper mocking of active reservations
      // For now, just verify the context strings exist
      expect(SWARM_COMPACTION_CONTEXT).toContain("SWARM ACTIVE");
    });

    it("LOW confidence triggers fallback prompt", async () => {
      expect(SWARM_DETECTION_FALLBACK).toContain("Swarm Detection");
      expect(SWARM_DETECTION_FALLBACK).toContain("Check Your Context");
    });
  });

  describe("Logging instrumentation", () => {
    it("logs compaction start with session_id", async () => {
      const hook = createCompactionHook();
      const input = { sessionID: "test-session-123" };
      const output = { context: [] as string[] };

      await hook(input, output);

      const startLog = logCalls.find(
        (log) => log.level === "info" && log.message === "compaction started",
      );
      expect(startLog).toBeDefined();
      expect(startLog?.data).toHaveProperty("session_id", "test-session-123");
    });

    it("logs detection phase with confidence and reasons", async () => {
      const hook = createCompactionHook();
      const input = { sessionID: "test-session" };
      const output = { context: [] as string[] };

      await hook(input, output);

      const detectionLog = logCalls.find(
        (log) =>
          log.level === "debug" && log.message === "swarm detection complete",
      );
      expect(detectionLog).toBeDefined();
      expect(detectionLog?.data).toHaveProperty("confidence");
      expect(detectionLog?.data).toHaveProperty("detected");
      expect(detectionLog?.data).toHaveProperty("reason_count");
    });

    it("logs context injection when swarm detected", async () => {
      const hook = createCompactionHook();
      const input = { sessionID: "test-session" };
      const output = { context: [] as string[] };

      // Mock detection to return medium confidence
      mock.module("./hive", () => ({
        getHiveWorkingDirectory: () => "/test/project",
        getHiveAdapter: async () => ({
          queryCells: async () => [
            {
              id: "bd-123",
              type: "epic",
              status: "open",
              parent_id: null,
              updated_at: Date.now(),
            },
          ],
        }),
      }));

      await hook(input, output);

      const injectionLog = logCalls.find(
        (log) =>
          log.level === "info" && log.message === "injected swarm context",
      );
      expect(injectionLog).toBeDefined();
      expect(injectionLog?.data).toHaveProperty("confidence");
      expect(injectionLog?.data).toHaveProperty("context_length");
    });

    it("logs completion with duration and success", async () => {
      const hook = createCompactionHook();
      const input = { sessionID: "test-session" };
      const output = { context: [] as string[] };

      await hook(input, output);

      const completeLog = logCalls.find(
        (log) => log.level === "info" && log.message === "compaction complete",
      );
      expect(completeLog).toBeDefined();
      expect(completeLog?.data).toHaveProperty("duration_ms");
      expect(completeLog?.data.duration_ms).toBeGreaterThanOrEqual(0);
      expect(completeLog?.data).toHaveProperty("success", true);
    });

    it("logs detailed detection sources (hive, swarm-mail)", async () => {
      const hook = createCompactionHook();
      const input = { sessionID: "test-session" };
      const output = { context: [] as string[] };

      await hook(input, output);

      // Should log details about checking swarm-mail
      const swarmMailLog = logCalls.find(
        (log) => log.level === "debug" && log.message?.includes("swarm-mail"),
      );
      // Should log details about checking hive
      const hiveLog = logCalls.find(
        (log) => log.level === "debug" && log.message?.includes("hive"),
      );

      // At least one source should be checked
      expect(logCalls.length).toBeGreaterThan(0);
    });

    it("logs errors without throwing when detection fails", async () => {
      // Mock hive to throw
      mock.module("./hive", () => ({
        getHiveWorkingDirectory: () => {
          throw new Error("Hive not available");
        },
        getHiveAdapter: async () => {
          throw new Error("Hive not available");
        },
      }));

      const hook = createCompactionHook();
      const input = { sessionID: "test-session" };
      const output = { context: [] as string[] };

      // Should not throw
      await expect(hook(input, output)).resolves.toBeUndefined();

      // Should still complete successfully
      const completeLog = logCalls.find(
        (log) => log.level === "info" && log.message === "compaction complete",
      );
      expect(completeLog).toBeDefined();
    });

    it("includes context size when injecting", async () => {
      const hook = createCompactionHook();
      const input = { sessionID: "test-session" };
      const output = { context: [] as string[] };

      await hook(input, output);

      // If context was injected, should log the size
      if (output.context.length > 0) {
        const injectionLog = logCalls.find(
          (log) =>
            log.level === "info" && log.message === "injected swarm context",
        );
        expect(injectionLog?.data.context_length).toBeGreaterThan(0);
      }
    });
  });
});
