/**
 * Swarm Mail - Actor-model primitives for multi-agent coordination
 *
 * ## Simple API (PGLite convenience layer)
 * ```typescript
 * import { getSwarmMail } from '@opencode/swarm-mail';
 * const swarmMail = await getSwarmMail('/path/to/project');
 * ```
 *
 * ## Advanced API (database-agnostic adapter)
 * ```typescript
 * import { createSwarmMailAdapter } from '@opencode/swarm-mail';
 * const db = createCustomDbAdapter({ path: './custom.db' });
 * const swarmMail = createSwarmMailAdapter(db, '/path/to/project');
 * ```
 */

export const SWARM_MAIL_VERSION = "0.1.0";

// ============================================================================
// Core (database-agnostic)
// ============================================================================

export { createSwarmMailAdapter } from "./adapter";
export type {
  DatabaseAdapter,
  SwarmMailAdapter,
  EventStoreAdapter,
  AgentAdapter,
  MessagingAdapter,
  ReservationAdapter,
  SchemaAdapter,
  ReadEventsOptions,
  InboxOptions,
  Message,
  Reservation,
  Conflict,
} from "./types";

// ============================================================================
// PGLite Convenience Layer
// ============================================================================

export {
  getSwarmMail,
  getSwarmMailSocket,
  createInMemorySwarmMail,
  closeSwarmMail,
  closeAllSwarmMail,
  getDatabasePath,
  getProjectTempDirName,
  hashProjectPath,
  PGlite,
} from "./pglite";

// ============================================================================
// Socket Adapter (postgres.js)
// ============================================================================

export {
  wrapPostgres,
  createSocketAdapter,
} from "./socket-adapter";
export type { SocketAdapterOptions } from "./socket-adapter";

// ============================================================================
// Re-export everything from streams for backward compatibility
// ============================================================================

export * from "./streams";

// ============================================================================
// Hive Module Exports (work item tracking)
// ============================================================================

export * from "./hive";

// ============================================================================
// Daemon Lifecycle Management
// ============================================================================

export {
  startDaemon,
  stopDaemon,
  isDaemonRunning,
  healthCheck,
  getPidFilePath,
} from "./daemon";
export type { DaemonOptions, DaemonInfo } from "./daemon";

// ============================================================================
// Memory Module Exports (semantic memory store)
// ============================================================================

export {
  createMemoryStore,
  EMBEDDING_DIM,
} from "./memory/store";
export type {
  Memory,
  SearchResult,
  SearchOptions,
} from "./memory/store";

export {
  Ollama,
  OllamaError,
  getDefaultConfig,
  makeOllamaLive,
} from "./memory/ollama";
export type { MemoryConfig } from "./memory/ollama";

export {
  memoryMigration,
  memoryMigrations,
} from "./memory/migrations";

export {
  legacyDatabaseExists,
  migrateLegacyMemories,
  getMigrationStatus,
  getDefaultLegacyPath,
} from "./memory/migrate-legacy";
export type {
  MigrationOptions,
  MigrationResult,
} from "./memory/migrate-legacy";

// Memory sync (JSONL export/import for git)
export {
  exportMemories,
  importMemories,
  syncMemories,
  parseMemoryJSONL,
  serializeMemoryToJSONL,
} from "./memory/sync";
export type {
  MemoryExport,
  MemoryImportResult,
  ExportOptions as MemoryExportOptions,
  ImportOptions as MemoryImportOptions,
} from "./memory/sync";
