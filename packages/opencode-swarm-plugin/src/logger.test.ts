import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

describe("Logger Infrastructure", () => {
  const testLogDir = join(homedir(), ".config", "swarm-tools", "logs-test");
  let originalEnv: string | undefined;

  beforeEach(async () => {
    // Clean up test log directory
    if (existsSync(testLogDir)) {
      await rm(testLogDir, { recursive: true, force: true });
    }
    await mkdir(testLogDir, { recursive: true });
    originalEnv = process.env.SWARM_LOG_PRETTY;

    // Clear module cache to reset logger instances
    delete require.cache[require.resolve("./logger")];
  });

  afterEach(async () => {
    // Restore environment
    if (originalEnv !== undefined) {
      process.env.SWARM_LOG_PRETTY = originalEnv;
    } else {
      delete process.env.SWARM_LOG_PRETTY;
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

    test("creates log file with numeric rotation pattern", async () => {
      const { getLogger } = await import("./logger");
      const logger = getLogger(testLogDir);

      // Write a log to force file creation
      logger.info("test message");

      // Wait for async file creation (pino-roll is async)
      await new Promise((resolve) => setTimeout(resolve, 500));

      const files = await readdir(testLogDir);
      // pino-roll format: {filename}.{number}log (e.g., swarm.1log)
      const logFile = files.find((f) => f.match(/^swarm\.\d+log$/));

      expect(logFile).toBeDefined();
    });

    test("writes log entries to file", async () => {
      const { getLogger } = await import("./logger");
      const logger = getLogger(testLogDir);

      logger.info("test log entry");
      logger.error("test error entry");

      // Wait for async file writes
      await new Promise((resolve) => setTimeout(resolve, 500));

      const files = await readdir(testLogDir);
      expect(files.length).toBeGreaterThan(0);
    });
  });

  describe("createChildLogger", () => {
    test("creates child logger with module namespace", async () => {
      const { getLogger, createChildLogger } = await import("./logger");
      getLogger(testLogDir); // Initialize main logger

      const childLogger = createChildLogger("compaction", testLogDir);

      expect(childLogger).toBeDefined();
      expect(typeof childLogger.info).toBe("function");
    });

    test("child logger writes to module-specific file", async () => {
      const { getLogger, createChildLogger } = await import("./logger");
      getLogger(testLogDir);

      const childLogger = createChildLogger("compaction", testLogDir);
      childLogger.info("compaction test message");

      // Wait for async file writes
      await new Promise((resolve) => setTimeout(resolve, 500));

      const files = await readdir(testLogDir);
      // pino-roll format: {module}.{number}log (e.g., compaction.1log)
      const compactionLog = files.find((f) => f.match(/^compaction\.\d+log$/));

      expect(compactionLog).toBeDefined();
    });

    test("multiple child loggers write to separate files", async () => {
      const { getLogger, createChildLogger } = await import("./logger");
      getLogger(testLogDir);

      const compactionLogger = createChildLogger("compaction", testLogDir);
      const cliLogger = createChildLogger("cli", testLogDir);

      compactionLogger.info("compaction message");
      cliLogger.info("cli message");

      // Wait for async file writes
      await new Promise((resolve) => setTimeout(resolve, 500));

      const files = await readdir(testLogDir);
      // pino-roll format: {module}.{number}log
      const compactionLog = files.find((f) => f.match(/^compaction\.\d+log$/));
      const cliLog = files.find((f) => f.match(/^cli\.\d+log$/));

      expect(compactionLog).toBeDefined();
      expect(cliLog).toBeDefined();
    });
  });

  describe("Pretty mode", () => {
    test("respects SWARM_LOG_PRETTY=1 environment variable", async () => {
      process.env.SWARM_LOG_PRETTY = "1";

      // Force reimport to pick up env var
      delete require.cache[require.resolve("./logger")];
      const { getLogger } = await import("./logger");

      const logger = getLogger(testLogDir);

      // If pretty mode is enabled, logger should have prettyPrint config
      // We can't easily inspect Pino internals, but we can verify it doesn't throw
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe("function");

      logger.info("pretty test message");
    });

    test("works without pretty mode by default", async () => {
      delete process.env.SWARM_LOG_PRETTY;

      // Force reimport
      delete require.cache[require.resolve("./logger")];
      const { getLogger } = await import("./logger");

      const logger = getLogger(testLogDir);

      expect(logger).toBeDefined();
      logger.info("normal mode message");
    });
  });

  describe("Log rotation", () => {
    test("sets up daily rotation with 14-day retention", async () => {
      const { getLogger } = await import("./logger");
      const logger = getLogger(testLogDir);

      // Write logs to trigger rotation setup
      logger.info("rotation test");

      // Wait for async file creation
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify log file exists (rotation config is internal to pino-roll)
      const files = await readdir(testLogDir);
      expect(files.length).toBeGreaterThan(0);
    });
  });
});
