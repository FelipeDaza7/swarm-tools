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
  rebuildAllBlockedCaches,
  rebuildBlockedCache,
  updateProjections,
} from "./projections.js";
