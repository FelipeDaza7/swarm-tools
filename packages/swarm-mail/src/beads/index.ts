/**
 * Beads Module - Event-sourced issue tracking
 *
 * Exports:
 * - BeadsAdapter interface and types
 * - Migration definitions
 * - Projection functions
 * - Store operations (append, read, replay)
 * - Event type definitions
 *
 * @module beads
 */

// Types
export type {
  Bead,
  BeadAdapter,
  BeadComment,
  BeadDependency,
  BeadLabel,
  BeadsAdapter,
  BeadsAdapterFactory,
  BeadsSchemaAdapter,
  BeadStatus,
  BeadType,
  CommentAdapter,
  CreateBeadOptions,
  DependencyAdapter,
  DependencyRelationship,
  EpicAdapter,
  LabelAdapter,
  QueryAdapter,
  QueryBeadsOptions,
  UpdateBeadOptions,
} from "../types/beads-adapter.js";

// Event types
export type {
  BeadEvent,
  BaseBeadEvent,
  BeadCreatedEvent,
  BeadUpdatedEvent,
  BeadStatusChangedEvent,
  BeadClosedEvent,
  BeadReopenedEvent,
  BeadDeletedEvent,
  BeadDependencyAddedEvent,
  BeadDependencyRemovedEvent,
  BeadLabelAddedEvent,
  BeadLabelRemovedEvent,
  BeadCommentAddedEvent,
  BeadCommentUpdatedEvent,
  BeadCommentDeletedEvent,
  BeadEpicChildAddedEvent,
  BeadEpicChildRemovedEvent,
  BeadEpicClosureEligibleEvent,
  BeadAssignedEvent,
  BeadWorkStartedEvent,
  BeadCompactedEvent,
} from "./events.js";

// Adapter factory
export { createBeadsAdapter } from "./adapter.js";

// Migrations
export { beadsMigration, beadsMigrations } from "./migrations.js";

// Store operations
export {
  appendBeadEvent,
  readBeadEvents,
  replayBeadEvents,
  type ReadBeadEventsOptions,
} from "./store.js";

// Projections
export {
  clearAllDirtyBeads,
  clearDirtyBead,
  getBead,
  getBlockedBeads,
  getBlockers,
  getComments,
  getDependencies,
  getDependents,
  getDirtyBeads,
  getInProgressBeads,
  getLabels,
  getNextReadyBead,
  isBlocked,
  markBeadDirty,
  queryBeads,
  updateProjections,
} from "./projections.js";

// Dependency operations
export {
  wouldCreateCycle,
  getOpenBlockers,
  rebuildBeadBlockedCache,
  rebuildAllBlockedCaches,
  invalidateBlockedCache,
} from "./dependencies.js";

// Label operations
export {
  getBeadsByLabel,
  getAllLabels,
} from "./labels.js";

// Comment operations
export {
  getCommentById,
  getCommentThread,
} from "./comments.js";

// JSONL export/import
export {
  exportToJSONL,
  exportDirtyBeads,
  importFromJSONL,
  parseJSONL,
  serializeToJSONL,
  computeContentHash,
  type BeadExport,
  type ExportOptions,
  type ImportOptions,
  type ImportResult,
} from "./jsonl.js";

// FlushManager for auto-sync
export {
  FlushManager,
  type FlushManagerOptions,
  type FlushResult,
} from "./flush-manager.js";

// 3-Way Merge Driver
export {
  merge3Way,
  mergeJsonl,
  isTombstone,
  isExpiredTombstone,
  DEFAULT_TOMBSTONE_TTL_MS,
  MIN_TOMBSTONE_TTL_MS,
  CLOCK_SKEW_GRACE_MS,
  STATUS_TOMBSTONE,
  type IssueKey,
  type MergeResult,
  type MergeOptions,
} from "./merge.js";
