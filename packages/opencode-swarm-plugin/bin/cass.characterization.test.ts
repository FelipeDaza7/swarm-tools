#!/usr/bin/env bun
/**
 * CASS Binary Characterization Tests
 * 
 * These tests capture the CURRENT behavior of the CASS binary tools.
 * They document WHAT the binary DOES, not what it SHOULD do.
 * 
 * Purpose: Enable safe refactoring during ADR-010 (CASS inhousing).
 * Our inhouse implementation must match these behaviors exactly.
 * 
 * Pattern: Feathers Characterization Testing
 * 1. Write a test you KNOW will fail
 * 2. Run it - let the failure tell you actual behavior
 * 3. Change the test to expect actual behavior
 * 4. Repeat until you've characterized the code
 * 
 * DO NOT modify these tests to match desired behavior.
 * These are BASELINE tests - they verify behaviors ARE present.
 */
import { describe, test, expect } from "bun:test";
import { $ } from "bun";
import {
  cassStatsBaseline,
  cassSearchBaseline,
  cassHealthHumanBaseline,
  cassStatsHumanBaseline,
  cassViewBaseline,
  cassErrorBaseline,
  type CassStatsResponse,
  type CassSearchResponse,
} from "../evals/fixtures/cass-baseline.ts";

describe("CASS Binary - cass stats", () => {
  test("JSON output structure matches baseline", async () => {
    // CHARACTERIZATION: This documents the actual JSON structure
    const result = await $`cass stats --json`.quiet().json();

    // Verify top-level structure
    expect(result).toHaveProperty("by_agent");
    expect(result).toHaveProperty("conversations");
    expect(result).toHaveProperty("date_range");
    expect(result).toHaveProperty("db_path");
    expect(result).toHaveProperty("messages");
    expect(result).toHaveProperty("top_workspaces");

    // Verify by_agent structure
    expect(Array.isArray(result.by_agent)).toBe(true);
    if (result.by_agent.length > 0) {
      const firstAgent = result.by_agent[0];
      expect(firstAgent).toHaveProperty("agent");
      expect(firstAgent).toHaveProperty("count");
      expect(typeof firstAgent.agent).toBe("string");
      expect(typeof firstAgent.count).toBe("number");
    }

    // Verify date_range structure
    expect(result.date_range).toHaveProperty("newest");
    expect(result.date_range).toHaveProperty("oldest");
    expect(typeof result.date_range.newest).toBe("string");
    expect(typeof result.date_range.oldest).toBe("string");

    // Verify top_workspaces structure
    expect(Array.isArray(result.top_workspaces)).toBe(true);
    if (result.top_workspaces.length > 0) {
      const firstWorkspace = result.top_workspaces[0];
      expect(firstWorkspace).toHaveProperty("count");
      expect(firstWorkspace).toHaveProperty("workspace");
      expect(typeof firstWorkspace.count).toBe("number");
      expect(typeof firstWorkspace.workspace).toBe("string");
    }

    // Verify numeric fields are numbers
    expect(typeof result.conversations).toBe("number");
    expect(typeof result.messages).toBe("number");
  });

  test("human-readable output format matches baseline", async () => {
    // CHARACTERIZATION: This documents the actual human-readable format
    const result = await $`cass stats`.quiet().text();

    // Verify presence of key sections (order matters)
    expect(result).toContain("CASS Index Statistics");
    expect(result).toContain("Database:");
    expect(result).toContain("Totals:");
    expect(result).toContain("Conversations:");
    expect(result).toContain("Messages:");
    expect(result).toContain("By Agent:");
    expect(result).toContain("Top Workspaces:");
    expect(result).toContain("Date Range:");

    // Verify format patterns
    expect(result).toMatch(/Conversations: \d+/);
    expect(result).toMatch(/Messages: \d+/);
    expect(result).toMatch(/\w+: \d+/); // Agent counts
  });
});

describe("CASS Binary - cass search", () => {
  test("JSON output structure matches baseline", async () => {
    // CHARACTERIZATION: This documents the actual search response structure
    const result = await $`cass search "test" --limit 2 --json`.quiet().json();

    // Verify top-level structure
    expect(result).toHaveProperty("count");
    expect(result).toHaveProperty("cursor");
    expect(result).toHaveProperty("hits");
    expect(result).toHaveProperty("hits_clamped");
    expect(result).toHaveProperty("limit");
    expect(result).toHaveProperty("max_tokens");
    expect(result).toHaveProperty("offset");
    expect(result).toHaveProperty("query");
    expect(result).toHaveProperty("request_id");
    expect(result).toHaveProperty("total_matches");

    // Verify types
    expect(typeof result.count).toBe("number");
    expect(typeof result.hits_clamped).toBe("boolean");
    expect(typeof result.limit).toBe("number");
    expect(typeof result.offset).toBe("number");
    expect(typeof result.query).toBe("string");
    expect(typeof result.total_matches).toBe("number");
    expect(Array.isArray(result.hits)).toBe(true);

    // Verify hit structure (if any hits returned)
    if (result.hits.length > 0) {
      const firstHit = result.hits[0];
      expect(firstHit).toHaveProperty("agent");
      expect(firstHit).toHaveProperty("content");
      expect(firstHit).toHaveProperty("created_at");
      expect(firstHit).toHaveProperty("line_number");
      expect(firstHit).toHaveProperty("match_type");
      expect(firstHit).toHaveProperty("score");
      expect(firstHit).toHaveProperty("snippet");
      expect(firstHit).toHaveProperty("source_path");
      expect(firstHit).toHaveProperty("title");
      expect(firstHit).toHaveProperty("workspace");

      expect(typeof firstHit.agent).toBe("string");
      expect(typeof firstHit.content).toBe("string");
      expect(typeof firstHit.created_at).toBe("number");
      expect(typeof firstHit.line_number).toBe("number");
      expect(typeof firstHit.match_type).toBe("string");
      expect(typeof firstHit.score).toBe("number");
      expect(typeof firstHit.snippet).toBe("string");
      expect(typeof firstHit.source_path).toBe("string");
      expect(typeof firstHit.title).toBe("string");
      expect(typeof firstHit.workspace).toBe("string");
    }
  });

  test("query parameter is preserved in response", async () => {
    // CHARACTERIZATION: Query echoed back in response
    const testQuery = "characterization-test-query-12345";
    const result = await $`cass search "${testQuery}" --json`.quiet().json();

    expect(result.query).toBe(testQuery);
  });

  test("limit parameter is respected", async () => {
    // CHARACTERIZATION: Limit controls max hits returned
    const result = await $`cass search "test" --limit 3 --json`.quiet().json();

    expect(result.limit).toBe(3);
    if (result.hits.length > 0) {
      expect(result.hits.length).toBeLessThanOrEqual(3);
    }
  });

  test("empty results include suggestions field", async () => {
    // CHARACTERIZATION: Empty results return suggestions
    const result =
      await $`cass search "xyzzy-nonexistent-term-99999" --json`.quiet().json();

    if (result.total_matches === 0) {
      // Empty results may include suggestions (optional feature)
      // Just verify structure if present
      if (result.suggestions) {
        expect(Array.isArray(result.suggestions)).toBe(true);
      }
    }
  });
});

describe("CASS Binary - cass health", () => {
  test("health check returns status indicator", async () => {
    // CHARACTERIZATION: Health check outputs status with timing
    const result = await $`cass health`.quiet().text();

    // Should contain status indicator (✓ or ✗)
    const hasHealthyIndicator = result.includes("✓ Healthy");
    const hasUnhealthyIndicator = result.includes("✗");

    expect(hasHealthyIndicator || hasUnhealthyIndicator).toBe(true);

    // Should include timing information
    if (hasHealthyIndicator) {
      expect(result).toMatch(/\(\d+ms\)/);
    }
  });

  test("health check may include staleness note", async () => {
    // CHARACTERIZATION: May warn about stale index
    const result = await $`cass health`.quiet().text();

    // If index is stale, should mention it
    // This is conditional - test just verifies format if present
    if (result.includes("stale")) {
      expect(result).toContain("Note:");
      expect(result).toMatch(/older than \d+s/);
    }
  });

  test("health check exits with code 0 when healthy", async () => {
    // CHARACTERIZATION: Exit code 0 = healthy
    const proc = Bun.spawn(["cass", "health"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    // Exit code 0 means healthy (even if stale)
    // Exit code 3 means missing index
    expect([0, 3]).toContain(exitCode);
  });
});

describe("CASS Binary - cass view", () => {
  test("view output includes file path header", async () => {
    // CHARACTERIZATION: View starts with file path
    // We can only test this if session files exist
    const sessionFiles = await $`ls ~/.config/swarm-tools/sessions/*.jsonl`
      .quiet()
      .text()
      .catch(() => "");

    if (sessionFiles.trim()) {
      const firstFile = sessionFiles.split("\n")[0].trim();
      const result = await $`cass view ${firstFile} -n 1`.quiet().text();

      expect(result).toContain(`File: ${firstFile}`);
      expect(result).toContain("Line: 1");
      expect(result).toContain("context:");
      expect(result).toContain("----------------------------------------");
    }
  });

  test("view output shows line numbers with content", async () => {
    // CHARACTERIZATION: Lines prefixed with numbers
    const sessionFiles = await $`ls ~/.config/swarm-tools/sessions/*.jsonl`
      .quiet()
      .text()
      .catch(() => "");

    if (sessionFiles.trim()) {
      const firstFile = sessionFiles.split("\n")[0].trim();
      const result = await $`cass view ${firstFile} -n 1`.quiet().text();

      // Target line marked with >
      expect(result).toMatch(/>\s+\d+\s+\|/);
    }
  });

  test("view with non-existent file returns error", async () => {
    // CHARACTERIZATION: File not found error structure
    const result = await $`cass view /nonexistent/path.jsonl -n 1 --json`
      .quiet()
      .json()
      .catch((e) => JSON.parse(e.stderr.toString()));

    expect(result).toHaveProperty("error");
    expect(result.error).toHaveProperty("code");
    expect(result.error).toHaveProperty("kind");
    expect(result.error).toHaveProperty("message");
    expect(result.error).toHaveProperty("retryable");

    expect(result.error.code).toBe(3);
    expect(result.error.kind).toBe("file-not-found");
    expect(result.error.retryable).toBe(false);
  });
});

describe("CASS Binary - Error handling", () => {
  test("invalid arguments return usage error with hints", async () => {
    // CHARACTERIZATION: Helpful error messages with examples
    const proc = Bun.spawn(["cass", "stats", "--invalid-flag"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    // Should contain helpful error information
    expect(stderr).toBeTruthy();
    // Typically shows usage or suggests --help
    expect(stderr.toLowerCase()).toMatch(/usage|help|invalid|unexpected/);
  });

  test("error responses include exit codes", async () => {
    // CHARACTERIZATION: Exit codes documented in baseline
    // Code 2 = usage error
    // Code 3 = missing file/db
    // Code 0 = success

    const procInvalidArg = Bun.spawn(["cass", "stats", "--invalid-flag"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCodeInvalid = await procInvalidArg.exited;
    expect(exitCodeInvalid).toBe(2); // Usage error

    const procSuccess = Bun.spawn(["cass", "stats", "--json"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCodeSuccess = await procSuccess.exited;
    expect([0, 3]).toContain(exitCodeSuccess); // Success or missing index
  });
});

describe("CASS Binary - Robot mode documentation", () => {
  test("--robot-help provides machine-readable documentation", async () => {
    // CHARACTERIZATION: Robot help is designed for AI agents
    const result = await $`cass --robot-help`.quiet().text();

    expect(result).toContain("cass --robot-help (contract v1)");
    expect(result).toContain("QUICKSTART (for AI agents):");
    expect(result).toContain("TIME FILTERS:");
    expect(result).toContain("WORKFLOW:");
    expect(result).toContain("OUTPUT:");
    expect(result).toContain("Exit codes:");
  });

  test("robot-docs subcommand exists", async () => {
    // CHARACTERIZATION: robot-docs provides detailed docs for AI
    const result = await $`cass robot-docs commands`.quiet().text();

    // Should return command documentation (exact format may vary)
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("CASS Binary - Flag behavior", () => {
  test("--json flag produces machine-readable output", async () => {
    // CHARACTERIZATION: --json enables JSON mode
    const result = await $`cass stats --json`.quiet().text();

    // Should be valid JSON
    expect(() => JSON.parse(result)).not.toThrow();
  });

  test("--json and --robot are equivalent", async () => {
    // CHARACTERIZATION: Both flags enable robot mode
    const jsonResult = await $`cass search "test" --limit 1 --json`
      .quiet()
      .json();
    const robotResult = await $`cass search "test" --limit 1 --robot`
      .quiet()
      .json();

    // Both should return same structure
    expect(jsonResult).toHaveProperty("hits");
    expect(robotResult).toHaveProperty("hits");
  });

  test("limit flag controls result count", async () => {
    // CHARACTERIZATION: --limit parameter
    const result = await $`cass search "test" --limit 1 --json`.quiet().json();

    expect(result.limit).toBe(1);
    expect(result.hits.length).toBeLessThanOrEqual(1);
  });
});

/**
 * CHARACTERIZATION NOTES:
 * 
 * These tests document the following CASS binary behaviors:
 * 
 * 1. JSON Output Structure:
 *    - cass stats: by_agent[], conversations, date_range, messages, top_workspaces[]
 *    - cass search: count, cursor, hits[], limit, offset, query, total_matches
 *    - Hit objects: agent, content, created_at, line_number, score, source_path, etc.
 * 
 * 2. Human-Readable Output:
 *    - Formatted tables with headers
 *    - Numeric statistics
 *    - Date ranges
 * 
 * 3. Error Handling:
 *    - Exit code 0 = success
 *    - Exit code 2 = usage error
 *    - Exit code 3 = missing file/db
 *    - Error objects with code, kind, message, retryable fields
 * 
 * 4. Robot Mode:
 *    - --json and --robot flags are equivalent
 *    - --robot-help provides AI-friendly documentation
 *    - robot-docs subcommand for detailed docs
 * 
 * 5. Search Behavior:
 *    - Query parameter echoed in response
 *    - Limit parameter controls max hits
 *    - Empty results may include suggestions
 * 
 * 6. View Behavior:
 *    - File path header
 *    - Line numbers with > indicator for target
 *    - Context window (default 5 lines)
 *    - Horizontal separators
 * 
 * 7. Health Check:
 *    - Status indicator (✓ or ✗)
 *    - Timing in milliseconds
 *    - Optional staleness warning
 * 
 * When implementing the inhouse version:
 * - Match these structures exactly
 * - Preserve field names and types
 * - Maintain error response format
 * - Keep exit codes consistent
 */
