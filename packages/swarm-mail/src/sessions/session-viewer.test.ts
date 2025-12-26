import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { viewSessionLine } from "./session-viewer.js";

describe("viewSessionLine", () => {
  let tempDir: string;
  let testFile: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "session-viewer-test-"));
    testFile = join(tempDir, "test-session.jsonl");

    // Create test JSONL file with 7 lines
    const lines = [
      { id: 1, content: "line one" },
      { id: 2, content: "line two" },
      { id: 3, content: "line three" },
      { id: 4, content: "line four" },
      { id: 5, content: "line five" },
      { id: 6, content: "line six" },
      { id: 7, content: "line seven" },
    ];

    writeFileSync(testFile, lines.map((line) => JSON.stringify(line)).join("\n"));
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("reads single line without context", () => {
    const result = viewSessionLine({ path: testFile, line: 5 });

    expect(result).toContain("File: " + testFile);
    expect(result).toContain("Line: 5");
    expect(result).toContain('>    5 | {"id":5,"content":"line five"}');
  });

  test("reads line with default context (3 lines before/after)", () => {
    const result = viewSessionLine({ path: testFile, line: 4 });

    expect(result).toContain("Line: 4 (context: 3)");
    // Should show lines 1-7 (line 4 with 3 before/after)
    expect(result).toContain('     1 | {"id":1,"content":"line one"}');
    expect(result).toContain('     2 | {"id":2,"content":"line two"}');
    expect(result).toContain('     3 | {"id":3,"content":"line three"}');
    expect(result).toContain('>    4 | {"id":4,"content":"line four"}');
    expect(result).toContain('     5 | {"id":5,"content":"line five"}');
    expect(result).toContain('     6 | {"id":6,"content":"line six"}');
    expect(result).toContain('     7 | {"id":7,"content":"line seven"}');
  });

  test("reads line with custom context", () => {
    const result = viewSessionLine({ path: testFile, line: 4, context: 1 });

    expect(result).toContain("Line: 4 (context: 1)");
    // Should show lines 3-5 (line 4 with 1 before/after)
    expect(result).toContain('     3 | {"id":3,"content":"line three"}');
    expect(result).toContain('>    4 | {"id":4,"content":"line four"}');
    expect(result).toContain('     5 | {"id":5,"content":"line five"}');

    // Should NOT show lines 1, 2, 6, 7
    expect(result).not.toContain('"line one"');
    expect(result).not.toContain('"line two"');
    expect(result).not.toContain('"line six"');
    expect(result).not.toContain('"line seven"');
  });

  test("handles first line with context (no negative indices)", () => {
    const result = viewSessionLine({ path: testFile, line: 1, context: 3 });

    expect(result).toContain("Line: 1 (context: 3)");
    // Should show lines 1-4 (can't go negative)
    expect(result).toContain('>    1 | {"id":1,"content":"line one"}');
    expect(result).toContain('     2 | {"id":2,"content":"line two"}');
    expect(result).toContain('     3 | {"id":3,"content":"line three"}');
    expect(result).toContain('     4 | {"id":4,"content":"line four"}');

    // Should NOT show lines beyond context
    expect(result).not.toContain('"line five"');
  });

  test("handles last line with context (no overflow)", () => {
    const result = viewSessionLine({ path: testFile, line: 7, context: 3 });

    expect(result).toContain("Line: 7 (context: 3)");
    // Should show lines 4-7 (can't go beyond end)
    expect(result).toContain('     4 | {"id":4,"content":"line four"}');
    expect(result).toContain('     5 | {"id":5,"content":"line five"}');
    expect(result).toContain('     6 | {"id":6,"content":"line six"}');
    expect(result).toContain('>    7 | {"id":7,"content":"line seven"}');

    // Should NOT show lines before context
    expect(result).not.toContain('"line three"');
  });

  test("throws error for line number out of range", () => {
    expect(() => {
      viewSessionLine({ path: testFile, line: 0 });
    }).toThrow("Line number must be between 1 and 7");

    expect(() => {
      viewSessionLine({ path: testFile, line: 8 });
    }).toThrow("Line number must be between 1 and 7");

    expect(() => {
      viewSessionLine({ path: testFile, line: -1 });
    }).toThrow("Line number must be between 1 and 7");
  });

  test("throws error for non-existent file", () => {
    expect(() => {
      viewSessionLine({ path: "/non/existent/file.jsonl" });
    }).toThrow("ENOENT");
  });

  test("matches CASS baseline format exactly", () => {
    // Single line from baseline (line 1, context 5)
    const result = viewSessionLine({ path: testFile, line: 1, context: 5 });

    // Check format components
    expect(result).toMatch(/^File: /);
    expect(result).toContain("\nLine: 1 (context: 5)");
    expect(result).toContain("\n----------------------------------------\n");
    expect(result).toContain(">    1 |");
    expect(result).toContain("\n----------------------------------------");

    // Verify line number formatting (right-aligned with space padding)
    const lines = result.split("\n");
    const contentLines = lines.filter((line) => /^\s*>?\s*\d+ \|/.test(line));

    // All line numbers should be right-aligned
    contentLines.forEach((line) => {
      expect(line).toMatch(/^\s*>?\s+\d+ \|/);
    });
  });

  test("reads line from middle of file", () => {
    const result = viewSessionLine({ path: testFile, line: 4, context: 2 });

    expect(result).toContain("Line: 4 (context: 2)");
    // Should show lines 2-6
    expect(result).toContain('     2 | {"id":2,"content":"line two"}');
    expect(result).toContain('     3 | {"id":3,"content":"line three"}');
    expect(result).toContain('>    4 | {"id":4,"content":"line four"}');
    expect(result).toContain('     5 | {"id":5,"content":"line five"}');
    expect(result).toContain('     6 | {"id":6,"content":"line six"}');

    expect(result).not.toContain('"line one"');
    expect(result).not.toContain('"line seven"');
  });
});
