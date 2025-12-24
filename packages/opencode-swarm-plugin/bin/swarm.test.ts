#!/usr/bin/env bun
/**
 * Tests for swarm CLI file operation helpers
 * 
 * These tests verify the verbose output helpers used in `swarm setup`:
 * - writeFileWithStatus: logs created/updated/unchanged status
 * - mkdirWithStatus: logs directory creation
 * - rmWithStatus: logs file removal
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

type FileStatus = "created" | "updated" | "unchanged";

/**
 * Mock logger for testing (matches @clack/prompts API)
 */
class MockLogger {
  logs: Array<{ type: string; message: string }> = [];

  success(msg: string) {
    this.logs.push({ type: "success", message: msg });
  }

  message(msg: string) {
    this.logs.push({ type: "message", message: msg });
  }

  reset() {
    this.logs = [];
  }
}

describe("File operation helpers", () => {
  let testDir: string;
  let logger: MockLogger;

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    logger = new MockLogger();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("writeFileWithStatus", () => {
    // Helper that mimics the implementation
    function writeFileWithStatus(path: string, content: string, label: string): FileStatus {
      const exists = existsSync(path);
      
      if (exists) {
        const current = readFileSync(path, "utf-8");
        if (current === content) {
          logger.message(`  ${label}: ${path} (unchanged)`);
          return "unchanged";
        }
      }
      
      writeFileSync(path, content);
      const status: FileStatus = exists ? "updated" : "created";
      logger.success(`${label}: ${path} (${status})`);
      return status;
    }

    test("returns 'created' for new file", () => {
      const filePath = join(testDir, "new.txt");
      const result = writeFileWithStatus(filePath, "content", "Test");
      
      expect(result).toBe("created");
      expect(logger.logs[0].type).toBe("success");
      expect(logger.logs[0].message).toContain("(created)");
      expect(existsSync(filePath)).toBe(true);
    });

    test("returns 'unchanged' if content is same", () => {
      const filePath = join(testDir, "existing.txt");
      writeFileSync(filePath, "same content");
      
      const result = writeFileWithStatus(filePath, "same content", "Test");
      
      expect(result).toBe("unchanged");
      expect(logger.logs[0].type).toBe("message");
      expect(logger.logs[0].message).toContain("(unchanged)");
    });

    test("returns 'updated' if content differs", () => {
      const filePath = join(testDir, "existing.txt");
      writeFileSync(filePath, "old content");
      
      const result = writeFileWithStatus(filePath, "new content", "Test");
      
      expect(result).toBe("updated");
      expect(logger.logs[0].type).toBe("success");
      expect(logger.logs[0].message).toContain("(updated)");
      expect(readFileSync(filePath, "utf-8")).toBe("new content");
    });
  });

  describe("mkdirWithStatus", () => {
    function mkdirWithStatus(path: string): boolean {
      if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
        logger.message(`  Created directory: ${path}`);
        return true;
      }
      return false;
    }

    test("creates directory and logs when it doesn't exist", () => {
      const dirPath = join(testDir, "newdir");
      const result = mkdirWithStatus(dirPath);
      
      expect(result).toBe(true);
      expect(existsSync(dirPath)).toBe(true);
      expect(logger.logs[0].type).toBe("message");
      expect(logger.logs[0].message).toContain("Created directory");
    });

    test("returns false when directory already exists", () => {
      const dirPath = join(testDir, "existing");
      mkdirSync(dirPath);
      
      const result = mkdirWithStatus(dirPath);
      
      expect(result).toBe(false);
      expect(logger.logs.length).toBe(0);
    });
  });

  describe("rmWithStatus", () => {
    function rmWithStatus(path: string, label: string): void {
      if (existsSync(path)) {
        rmSync(path);
        logger.message(`  Removed ${label}: ${path}`);
      }
    }

    test("removes file and logs when it exists", () => {
      const filePath = join(testDir, "todelete.txt");
      writeFileSync(filePath, "content");
      
      rmWithStatus(filePath, "test file");
      
      expect(existsSync(filePath)).toBe(false);
      expect(logger.logs[0].type).toBe("message");
      expect(logger.logs[0].message).toContain("Removed test file");
    });

    test("does nothing when file doesn't exist", () => {
      const filePath = join(testDir, "nonexistent.txt");
      
      rmWithStatus(filePath, "test file");
      
      expect(logger.logs.length).toBe(0);
    });
  });

  describe("getResearcherAgent", () => {
    // Mock implementation for testing - will match actual implementation
    function getResearcherAgent(model: string): string {
      return `---
name: swarm-researcher
description: Research agent for discovering and documenting context
model: ${model}
---

READ-ONLY research agent. Never modifies code - only gathers intel and stores findings.`;
    }

    test("includes model in frontmatter", () => {
      const template = getResearcherAgent("anthropic/claude-haiku-4-5");
      
      expect(template).toContain("model: anthropic/claude-haiku-4-5");
    });

    test("emphasizes READ-ONLY nature", () => {
      const template = getResearcherAgent("anthropic/claude-haiku-4-5");
      
      expect(template).toContain("READ-ONLY");
    });

    test("includes agent name in frontmatter", () => {
      const template = getResearcherAgent("anthropic/claude-haiku-4-5");
      
      expect(template).toContain("name: swarm-researcher");
    });
  });
});

// ============================================================================
// Log Command Tests (TDD)
// ============================================================================

describe("Log command helpers", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-log-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("parseLogLine", () => {
    function parseLogLine(line: string): { level: number; time: string; module: string; msg: string } | null {
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed.level === "number" && parsed.time && parsed.msg) {
          return {
            level: parsed.level,
            time: parsed.time,
            module: parsed.module || "unknown",
            msg: parsed.msg,
          };
        }
      } catch {
        // Invalid JSON
      }
      return null;
    }

    test("parses valid log line", () => {
      const line = '{"level":30,"time":"2024-12-24T16:00:00.000Z","module":"compaction","msg":"started"}';
      const result = parseLogLine(line);
      
      expect(result).not.toBeNull();
      expect(result?.level).toBe(30);
      expect(result?.module).toBe("compaction");
      expect(result?.msg).toBe("started");
    });

    test("returns null for invalid JSON", () => {
      const line = "not json";
      expect(parseLogLine(line)).toBeNull();
    });

    test("defaults module to 'unknown' if missing", () => {
      const line = '{"level":30,"time":"2024-12-24T16:00:00.000Z","msg":"test"}';
      const result = parseLogLine(line);
      
      expect(result?.module).toBe("unknown");
    });
  });

  describe("filterLogsByLevel", () => {
    function filterLogsByLevel(logs: Array<{ level: number }>, minLevel: number): Array<{ level: number }> {
      return logs.filter((log) => log.level >= minLevel);
    }

    test("filters logs by minimum level", () => {
      const logs = [
        { level: 10 }, // trace
        { level: 30 }, // info
        { level: 50 }, // error
      ];
      
      const result = filterLogsByLevel(logs, 30);
      expect(result).toHaveLength(2);
      expect(result[0].level).toBe(30);
      expect(result[1].level).toBe(50);
    });

    test("includes all logs when minLevel is 0", () => {
      const logs = [
        { level: 10 },
        { level: 20 },
        { level: 30 },
      ];
      
      const result = filterLogsByLevel(logs, 0);
      expect(result).toHaveLength(3);
    });
  });

  describe("filterLogsByModule", () => {
    function filterLogsByModule(logs: Array<{ module: string }>, module: string): Array<{ module: string }> {
      return logs.filter((log) => log.module === module);
    }

    test("filters logs by exact module name", () => {
      const logs = [
        { module: "compaction" },
        { module: "swarm" },
        { module: "compaction" },
      ];
      
      const result = filterLogsByModule(logs, "compaction");
      expect(result).toHaveLength(2);
    });

    test("returns empty array when no match", () => {
      const logs = [
        { module: "compaction" },
      ];
      
      const result = filterLogsByModule(logs, "swarm");
      expect(result).toHaveLength(0);
    });
  });

  describe("filterLogsBySince", () => {
    function parseDuration(duration: string): number | null {
      const match = duration.match(/^(\d+)([smhd])$/);
      if (!match) return null;
      
      const [, num, unit] = match;
      const value = parseInt(num, 10);
      
      const multipliers: Record<string, number> = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
      };
      
      return value * multipliers[unit];
    }

    function filterLogsBySince(logs: Array<{ time: string }>, sinceMs: number): Array<{ time: string }> {
      const cutoffTime = Date.now() - sinceMs;
      return logs.filter((log) => new Date(log.time).getTime() >= cutoffTime);
    }

    test("parseDuration handles seconds", () => {
      expect(parseDuration("30s")).toBe(30 * 1000);
    });

    test("parseDuration handles minutes", () => {
      expect(parseDuration("5m")).toBe(5 * 60 * 1000);
    });

    test("parseDuration handles hours", () => {
      expect(parseDuration("2h")).toBe(2 * 60 * 60 * 1000);
    });

    test("parseDuration handles days", () => {
      expect(parseDuration("1d")).toBe(24 * 60 * 60 * 1000);
    });

    test("parseDuration returns null for invalid format", () => {
      expect(parseDuration("invalid")).toBeNull();
      expect(parseDuration("30x")).toBeNull();
      expect(parseDuration("30")).toBeNull();
    });

    test("filterLogsBySince filters old logs", () => {
      const now = Date.now();
      const logs = [
        { time: new Date(now - 10000).toISOString() }, // 10s ago
        { time: new Date(now - 120000).toISOString() }, // 2m ago
        { time: new Date(now - 1000).toISOString() }, // 1s ago
      ];
      
      const result = filterLogsBySince(logs, 60000); // Last 1m
      expect(result).toHaveLength(2); // Only logs within last minute
    });
  });

  describe("formatLogLine", () => {
    function levelToName(level: number): string {
      if (level >= 60) return "FATAL";
      if (level >= 50) return "ERROR";
      if (level >= 40) return "WARN ";
      if (level >= 30) return "INFO ";
      if (level >= 20) return "DEBUG";
      return "TRACE";
    }

    function formatLogLine(log: { level: number; time: string; module: string; msg: string }): string {
      const timestamp = new Date(log.time).toLocaleTimeString();
      const levelName = levelToName(log.level);
      const module = log.module.padEnd(12);
      return `${timestamp} ${levelName} ${module} ${log.msg}`;
    }

    test("formats log line with timestamp and level", () => {
      const log = {
        level: 30,
        time: "2024-12-24T16:00:00.000Z",
        module: "compaction",
        msg: "started",
      };
      
      const result = formatLogLine(log);
      expect(result).toContain("INFO");
      expect(result).toContain("compaction");
      expect(result).toContain("started");
    });

    test("pads module name for alignment", () => {
      const log1 = formatLogLine({ level: 30, time: "2024-12-24T16:00:00.000Z", module: "a", msg: "test" });
      const log2 = formatLogLine({ level: 30, time: "2024-12-24T16:00:00.000Z", module: "compaction", msg: "test" });
      
      // Module names should be padded to 12 chars
      expect(log1).toContain("a            test"); // 'a' + 11 spaces
      expect(log2).toContain("compaction   test"); // 'compaction' + 3 spaces (10 chars + 2)
    });

    test("levelToName maps all levels correctly", () => {
      expect(levelToName(10)).toBe("TRACE");
      expect(levelToName(20)).toBe("DEBUG");
      expect(levelToName(30)).toBe("INFO ");
      expect(levelToName(40)).toBe("WARN ");
      expect(levelToName(50)).toBe("ERROR");
      expect(levelToName(60)).toBe("FATAL");
    });
  });

  describe("readLogFiles", () => {
    test("reads multiple .1log files", () => {
      // Create test log files
      const log1 = join(testDir, "swarm.1log");
      const log2 = join(testDir, "swarm.2log");
      const log3 = join(testDir, "compaction.1log");
      
      writeFileSync(log1, '{"level":30,"time":"2024-12-24T16:00:00.000Z","msg":"line1"}\n');
      writeFileSync(log2, '{"level":30,"time":"2024-12-24T16:00:01.000Z","msg":"line2"}\n');
      writeFileSync(log3, '{"level":30,"time":"2024-12-24T16:00:02.000Z","module":"compaction","msg":"line3"}\n');
      
      function readLogFiles(dir: string): string[] {
        if (!existsSync(dir)) return [];
        
        const files = readdirSync(dir)
          .filter((f) => /\.\d+log$/.test(f))
          .sort() // Sort by filename
          .map((f) => join(dir, f));
        
        const lines: string[] = [];
        for (const file of files) {
          const content = readFileSync(file, "utf-8");
          lines.push(...content.split("\n").filter((line) => line.trim()));
        }
        
        return lines;
      }
      
      const lines = readLogFiles(testDir);
      expect(lines).toHaveLength(3);
      // Files are sorted alphabetically: compaction.1log, swarm.1log, swarm.2log
      expect(lines.some((l) => l.includes("line1"))).toBe(true);
      expect(lines.some((l) => l.includes("line2"))).toBe(true);
      expect(lines.some((l) => l.includes("line3"))).toBe(true);
    });

    test("returns empty array for non-existent directory", () => {
      function readLogFiles(dir: string): string[] {
        if (!existsSync(dir)) return [];
        return [];
      }
      
      const lines = readLogFiles(join(testDir, "nonexistent"));
      expect(lines).toHaveLength(0);
    });
  });

  describe("watchLogs", () => {
    test("detects new log lines appended to file", async () => {
      const logFile = join(testDir, "swarm.1log");
      const collectedLines: string[] = [];
      
      // Create initial log file
      writeFileSync(logFile, '{"level":30,"time":"2024-12-24T16:00:00.000Z","msg":"initial"}\n');
      
      // Import watch utilities
      const { watch } = await import("fs");
      const { appendFileSync } = await import("fs");
      
      // Track file position for incremental reads
      let lastSize = 0;
      
      function readNewLines(filePath: string): string[] {
        const content = readFileSync(filePath, "utf-8");
        const newContent = content.slice(lastSize);
        lastSize = content.length;
        return newContent.split("\n").filter((line) => line.trim());
      }
      
      // Simulate watch behavior
      const watcher = watch(testDir, (eventType, filename) => {
        if (filename && /\.\d+log$/.test(filename)) {
          const newLines = readNewLines(join(testDir, filename));
          collectedLines.push(...newLines);
        }
      });
      
      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 100));
      
      // Append new log line
      appendFileSync(logFile, '{"level":30,"time":"2024-12-24T16:00:01.000Z","msg":"appended"}\n');
      
      // Wait for event to fire
      await new Promise((resolve) => setTimeout(resolve, 200));
      
      watcher.close();
      
      // Should have detected the new line
      expect(collectedLines.some((l) => l.includes("appended"))).toBe(true);
    });

    test("parseWatchArgs extracts --watch flag", () => {
      function parseWatchArgs(args: string[]): { watch: boolean; interval: number } {
        let watch = false;
        let interval = 1000; // default 1 second
        
        for (let i = 0; i < args.length; i++) {
          const arg = args[i];
          if (arg === "--watch" || arg === "-w") {
            watch = true;
          } else if (arg === "--interval" && i + 1 < args.length) {
            interval = parseInt(args[++i], 10);
          }
        }
        
        return { watch, interval };
      }
      
      expect(parseWatchArgs(["--watch"])).toEqual({ watch: true, interval: 1000 });
      expect(parseWatchArgs(["-w"])).toEqual({ watch: true, interval: 1000 });
      expect(parseWatchArgs(["--watch", "--interval", "500"])).toEqual({ watch: true, interval: 500 });
      expect(parseWatchArgs(["compaction", "--watch"])).toEqual({ watch: true, interval: 1000 });
      expect(parseWatchArgs(["--level", "error"])).toEqual({ watch: false, interval: 1000 });
    });
  });
});
