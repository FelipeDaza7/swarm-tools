/**
 * Agent Discovery Tests
 * 
 * Maps file paths to agent types using pattern matching.
 * Follows TDD pattern from ADR-010 Section 4.5.
 */

import { describe, test, expect, afterEach } from "bun:test";
import {
  detectAgentType,
  loadAgentPatterns,
  resetAgentPatterns,
} from "./agent-discovery";

describe("detectAgentType", () => {
  test("detects OpenCode Swarm sessions", () => {
    expect(
      detectAgentType(
        "/home/user/.config/swarm-tools/sessions/ses_123.jsonl"
      )
    ).toBe("opencode-swarm");
  });

  test("detects Cursor sessions", () => {
    expect(
      detectAgentType(
        "/Users/joel/Library/Application Support/Cursor/User/History/abc/9ScS.jsonl"
      )
    ).toBe("cursor");
  });

  test("detects OpenCode sessions", () => {
    expect(detectAgentType("/Users/joel/.opencode/session.jsonl")).toBe(
      "opencode"
    );
  });

  test("detects Claude sessions", () => {
    expect(
      detectAgentType("/home/user/.local/share/Claude/ses_456.jsonl")
    ).toBe("claude");
  });

  test("detects Aider sessions", () => {
    expect(detectAgentType("/home/user/.aider/session.jsonl")).toBe("aider");
  });

  test("returns null for unknown paths", () => {
    expect(detectAgentType("/tmp/random.jsonl")).toBeNull();
  });

  test("handles Windows-style paths", () => {
    expect(
      detectAgentType("C:\\Users\\joel\\.config\\swarm-tools\\sessions\\ses.jsonl")
    ).toBe("opencode-swarm");
  });

  test("handles nested paths", () => {
    expect(
      detectAgentType(
        "/Users/joel/.opencode/deeply/nested/folder/session.jsonl"
      )
    ).toBe("opencode");
  });
});

describe("loadAgentPatterns", () => {
  afterEach(() => {
    // Reset to defaults after each test
    resetAgentPatterns();
  });

  test("loads custom agent patterns", () => {
    const count = loadAgentPatterns([
      { pattern: "\\.codex[/\\\\]", agentType: "opencode-swarm" },
    ]);

    expect(count).toBe(1);
    expect(detectAgentType("/home/user/.codex/session.jsonl")).toBe(
      "opencode-swarm"
    );
  });

  test("replaces default patterns with custom ones", () => {
    loadAgentPatterns([
      { pattern: "\\.custom[/\\\\]", agentType: "cursor" },
    ]);

    // Custom pattern works
    expect(detectAgentType("/path/.custom/file.jsonl")).toBe("cursor");

    // Default patterns no longer work
    expect(
      detectAgentType("/home/user/.config/swarm-tools/sessions/ses.jsonl")
    ).toBeNull();
  });

  test("supports multiple custom patterns", () => {
    loadAgentPatterns([
      { pattern: "\\.agent1[/\\\\]", agentType: "opencode-swarm" },
      { pattern: "\\.agent2[/\\\\]", agentType: "cursor" },
      { pattern: "\\.agent3[/\\\\]", agentType: "claude" },
    ]);

    expect(detectAgentType("/path/.agent1/file.jsonl")).toBe(
      "opencode-swarm"
    );
    expect(detectAgentType("/path/.agent2/file.jsonl")).toBe("cursor");
    expect(detectAgentType("/path/.agent3/file.jsonl")).toBe("claude");
  });
});

describe("resetAgentPatterns", () => {
  test("restores default patterns after custom load", () => {
    // Load custom patterns
    loadAgentPatterns([
      { pattern: "\\.custom[/\\\\]", agentType: "opencode-swarm" },
    ]);

    // Custom works, defaults don't
    expect(detectAgentType("/path/.custom/file.jsonl")).toBe(
      "opencode-swarm"
    );
    expect(
      detectAgentType("/home/user/.config/swarm-tools/sessions/ses.jsonl")
    ).toBeNull();

    // Reset
    resetAgentPatterns();

    // Defaults work again
    expect(
      detectAgentType("/home/user/.config/swarm-tools/sessions/ses.jsonl")
    ).toBe("opencode-swarm");
    expect(detectAgentType("/path/.custom/file.jsonl")).toBeNull();
  });
});
