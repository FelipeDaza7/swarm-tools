import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

describe("Logger Infrastructure", () => {
  const testLogDir = join(homedir(), ".config", "swarm-tools", "logs-test");
  let originalLogFile: string | undefined;

  beforeEach(async () => {
    // Clean up test log directory
    if (existsSync(testLogDir)) {
      await rm(testLogDir, { recursive: true, force: true });
    }
    await mkdir(testLogDir, { recursive: true });
    
    // Save and enable file logging for tests
    originalLogFile = process.env.SWARM_LOG_FILE;
    process.env.SWARM_LOG_FILE = "1";

    // Clear module cache to reset logger instances
    delete require.cache[require.resolve("./logger")];
  });

  afterEach(async () => {
    // Restore environment
    if (originalLogFile !== undefined) {
      process.env.SWARM_LOG_FILE = originalLogFile;
    } else {
      delete process.env.SWARM_LOG_FILE;
    }

    // Clean up test directory
    if (existsSync(testLogDir)) {
      await rm(testLogDir, { recursive: true, force: true });
    }
  });

  describe("getLogger", () => {
    test("returns a valid Pino logger instance", async () => {
      const { getLogger } = await import("./logger");
      const logger = getLogger(testLogDir);

      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.error).toBe("function");
      expect(typeof logger.debug).toBe("function");
      expect(typeof logger.warn).toBe("function");
    });

    test("creates log directory if it doesn't exist", async () => {
      const newDir = join(testLogDir, "nested", "path");
      const { getLogger } = await import("./logger");

      getLogger(newDir);

      expect(existsSync(newDir)).toBe(true);
    });

    test("creates log file when SWARM_LOG_FILE=1", async () => {
      const { getLogger } = await import("./logger");
      const logger = getLogger(testLogDir);

      // Write a log to force file creation
      logger.info("test message");

      // Wait for async file writes (pino.destination is async)
      await new Promise((resolve) => setTimeout(resolve, 200));

      const files = await readdir(testLogDir);
      expect(files).toContain("swarm.log");
    });

    test("writes log entries to file", async () => {
      const { getLogger } = await import("./logger");
      const logger = getLogger(testLogDir);

      logger.info("test log entry");
      logger.error("test error entry");

      // Wait for async file writes
      await new Promise((resolve) => setTimeout(resolve, 200));

      const logPath = join(testLogDir, "swarm.log");
      const content = await readFile(logPath, "utf-8");
      
      expect(content).toContain("test log entry");
      expect(content).toContain("test error entry");
    });
  });

  describe("createChildLogger", () => {
    test("creates child logger with module namespace", async () => {
      const { createChildLogger } = await import("./logger");

      const childLogger = createChildLogger("compaction", testLogDir);

      expect(childLogger).toBeDefined();
      expect(typeof childLogger.info).toBe("function");
    });

    test("child logger writes to module-specific file", async () => {
      const { createChildLogger } = await import("./logger");

      const childLogger = createChildLogger("compaction", testLogDir);
      childLogger.info("compaction test message");

      // Wait for async file writes
      await new Promise((resolve) => setTimeout(resolve, 200));

      const files = await readdir(testLogDir);
      expect(files).toContain("compaction.log");
    });

    test("multiple child loggers write to separate files", async () => {
      const { createChildLogger } = await import("./logger");

      const compactionLogger = createChildLogger("compaction", testLogDir);
      const cliLogger = createChildLogger("cli", testLogDir);

      compactionLogger.info("compaction message");
      cliLogger.info("cli message");

      // Wait for async file writes
      await new Promise((resolve) => setTimeout(resolve, 200));

      const files = await readdir(testLogDir);
      expect(files).toContain("compaction.log");
      expect(files).toContain("cli.log");
    });
  });

  describe("stdout mode (default)", () => {
    test("works without file logging by default", async () => {
      delete process.env.SWARM_LOG_FILE;

      // Force reimport
      delete require.cache[require.resolve("./logger")];
      const { getLogger } = await import("./logger");

      const logger = getLogger(testLogDir);

      expect(logger).toBeDefined();
      // Should not throw when logging to stdout
      logger.info("stdout mode message");
    });

    test("does not create log files when SWARM_LOG_FILE is not set", async () => {
      delete process.env.SWARM_LOG_FILE;

      // Force reimport
      delete require.cache[require.resolve("./logger")];
      const { getLogger } = await import("./logger");

      const logger = getLogger(testLogDir);
      logger.info("this goes to stdout");

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Log directory should exist (we created it in beforeEach) but no log files
      const files = await readdir(testLogDir);
      const logFiles = files.filter(f => f.endsWith(".log"));
      expect(logFiles).toHaveLength(0);
    });
  });
});
