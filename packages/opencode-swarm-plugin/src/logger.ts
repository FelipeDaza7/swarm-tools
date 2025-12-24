/**
 * Logger infrastructure using Pino with daily rotation
 *
 * Features:
 * - Daily log rotation via pino-roll (numeric format: swarm.1log, swarm.2log, etc.)
 * - 14-day retention (14 files max in addition to current file)
 * - Module-specific child loggers with separate log files
 * - Pretty mode for development (SWARM_LOG_PRETTY=1 env var)
 * - Logs to ~/.config/swarm-tools/logs/ by default
 *
 * Note: pino-roll uses numeric rotation (e.g., swarm.1log, swarm.2log) not date-based names.
 * Files rotate daily based on frequency='daily', with a maximum of 14 retained files.
 */

import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Logger } from "pino";
import pino from "pino";

const DEFAULT_LOG_DIR = join(homedir(), ".config", "swarm-tools", "logs");

/**
 * Creates the log directory if it doesn't exist
 */
function ensureLogDir(logDir: string): void {
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Creates a Pino transport with file rotation
 *
 * @param filename - Log file base name (e.g., "swarm" becomes swarm.1log, swarm.2log, etc.)
 * @param logDir - Directory to store logs
 */
function createTransport(
  filename: string,
  logDir: string,
): pino.TransportTargetOptions {
  const isPretty = process.env.SWARM_LOG_PRETTY === "1";

  if (isPretty) {
    // Pretty mode - output to console with pino-pretty
    return {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname",
      },
    };
  }

  // Production mode - file rotation with pino-roll
  // pino-roll format: {file}.{number}{extension}
  // So "swarm" becomes "swarm.1log", "swarm.2log", etc.
  return {
    target: "pino-roll",
    options: {
      file: join(logDir, filename),
      frequency: "daily",
      extension: "log",
      limit: { count: 14 },
      mkdir: true,
    },
  };
}

const loggerCache = new Map<string, Logger>();

/**
 * Gets or creates the main logger instance
 *
 * @param logDir - Optional log directory (defaults to ~/.config/swarm-tools/logs)
 * @returns Pino logger instance
 */
export function getLogger(logDir: string = DEFAULT_LOG_DIR): Logger {
  const cacheKey = `swarm:${logDir}`;

  if (loggerCache.has(cacheKey)) {
    return loggerCache.get(cacheKey)!;
  }

  ensureLogDir(logDir);

  const logger = pino(
    {
      level: process.env.LOG_LEVEL || "info",
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.transport(createTransport("swarm", logDir)),
  );

  loggerCache.set(cacheKey, logger);
  return logger;
}

/**
 * Creates a child logger for a specific module with its own log file
 *
 * @param module - Module name (e.g., "compaction", "cli")
 * @param logDir - Optional log directory (defaults to ~/.config/swarm-tools/logs)
 * @returns Child logger instance
 */
export function createChildLogger(
  module: string,
  logDir: string = DEFAULT_LOG_DIR,
): Logger {
  const cacheKey = `${module}:${logDir}`;

  if (loggerCache.has(cacheKey)) {
    return loggerCache.get(cacheKey)!;
  }

  ensureLogDir(logDir);

  const childLogger = pino(
    {
      level: process.env.LOG_LEVEL || "info",
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.transport(createTransport(module, logDir)),
  );

  const logger = childLogger.child({ module });
  loggerCache.set(cacheKey, logger);
  return logger;
}

/**
 * Default logger instance for immediate use
 */
export const logger = getLogger();
