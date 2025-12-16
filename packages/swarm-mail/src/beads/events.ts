/**
 * Bead Event Types - Minimal type definitions for swarm-mail
 *
 * These are simplified type definitions that match the bead-events from
 * opencode-swarm-plugin but avoid cross-package TypeScript imports.
 *
 * The actual event schemas with Zod validation live in:
 * packages/opencode-swarm-plugin/src/schemas/bead-events.ts
 *
 * This file provides just enough type information for the store to work.
 */

/**
 * Base bead event (all events extend this)
 */
export interface BaseBeadEvent {
  id?: number;
  type: string;
  project_key: string;
  bead_id: string;
  timestamp: number;
  sequence?: number;
}

/**
 * Union of all bead event types
 * 
 * This matches the discriminated union in bead-events.ts but as pure TypeScript
 */
export type BeadEvent =
  // Lifecycle
  | BeadCreatedEvent
  | BeadUpdatedEvent
  | BeadStatusChangedEvent
  | BeadClosedEvent
  | BeadReopenedEvent
  | BeadDeletedEvent
  // Dependencies
  | BeadDependencyAddedEvent
  | BeadDependencyRemovedEvent
  // Labels
  | BeadLabelAddedEvent
  | BeadLabelRemovedEvent
  // Comments
  | BeadCommentAddedEvent
  | BeadCommentUpdatedEvent
  | BeadCommentDeletedEvent
  // Epic
  | BeadEpicChildAddedEvent
  | BeadEpicChildRemovedEvent
  | BeadEpicClosureEligibleEvent
  // Swarm Integration
  | BeadAssignedEvent
  | BeadWorkStartedEvent
  // Maintenance
  | BeadCompactedEvent;

// ============================================================================
// Lifecycle Events
// ============================================================================

export interface BeadCreatedEvent extends BaseBeadEvent {
  type: "bead_created";
  title: string;
  description?: string;
  issue_type: "bug" | "feature" | "task" | "epic" | "chore";
  priority: number;
  parent_id?: string;
  created_by?: string;
  metadata?: Record<string, unknown>;
}

export interface BeadUpdatedEvent extends BaseBeadEvent {
  type: "bead_updated";
  updated_by?: string;
  changes: {
    title?: { old: string; new: string };
    description?: { old: string; new: string };
    priority?: { old: number; new: number };
  };
}

export interface BeadStatusChangedEvent extends BaseBeadEvent {
  type: "bead_status_changed";
  from_status: "open" | "in_progress" | "blocked" | "closed" | "tombstone";
  to_status: "open" | "in_progress" | "blocked" | "closed" | "tombstone";
  changed_by?: string;
  reason?: string;
}

export interface BeadClosedEvent extends BaseBeadEvent {
  type: "bead_closed";
  reason: string;
  closed_by?: string;
  files_touched?: string[];
  duration_ms?: number;
}

export interface BeadReopenedEvent extends BaseBeadEvent {
  type: "bead_reopened";
  reason?: string;
  reopened_by?: string;
}

export interface BeadDeletedEvent extends BaseBeadEvent {
  type: "bead_deleted";
  reason?: string;
  deleted_by?: string;
}

// ============================================================================
// Dependency Events
// ============================================================================

export interface BeadDependencyAddedEvent extends BaseBeadEvent {
  type: "bead_dependency_added";
  dependency: {
    target: string;
    type: "blocks" | "blocked-by" | "related" | "discovered-from";
  };
  added_by?: string;
  reason?: string;
}

export interface BeadDependencyRemovedEvent extends BaseBeadEvent {
  type: "bead_dependency_removed";
  dependency: {
    target: string;
    type: "blocks" | "blocked-by" | "related" | "discovered-from";
  };
  removed_by?: string;
  reason?: string;
}

// ============================================================================
// Label Events
// ============================================================================

export interface BeadLabelAddedEvent extends BaseBeadEvent {
  type: "bead_label_added";
  label: string;
  added_by?: string;
}

export interface BeadLabelRemovedEvent extends BaseBeadEvent {
  type: "bead_label_removed";
  label: string;
  removed_by?: string;
}

// ============================================================================
// Comment Events
// ============================================================================

export interface BeadCommentAddedEvent extends BaseBeadEvent {
  type: "bead_comment_added";
  comment_id?: number;
  author: string;
  body: string;
  parent_comment_id?: number;
  metadata?: Record<string, unknown>;
}

export interface BeadCommentUpdatedEvent extends BaseBeadEvent {
  type: "bead_comment_updated";
  comment_id: number;
  old_body: string;
  new_body: string;
  updated_by: string;
}

export interface BeadCommentDeletedEvent extends BaseBeadEvent {
  type: "bead_comment_deleted";
  comment_id: number;
  deleted_by: string;
  reason?: string;
}

// ============================================================================
// Epic Events
// ============================================================================

export interface BeadEpicChildAddedEvent extends BaseBeadEvent {
  type: "bead_epic_child_added";
  child_id: string;
  child_index?: number;
  added_by?: string;
}

export interface BeadEpicChildRemovedEvent extends BaseBeadEvent {
  type: "bead_epic_child_removed";
  child_id: string;
  removed_by?: string;
  reason?: string;
}

export interface BeadEpicClosureEligibleEvent extends BaseBeadEvent {
  type: "bead_epic_closure_eligible";
  child_ids: string[];
  total_duration_ms?: number;
  all_files_touched?: string[];
}

// ============================================================================
// Swarm Integration Events
// ============================================================================

export interface BeadAssignedEvent extends BaseBeadEvent {
  type: "bead_assigned";
  agent_name: string;
  task_description?: string;
}

export interface BeadWorkStartedEvent extends BaseBeadEvent {
  type: "bead_work_started";
  agent_name: string;
  reserved_files?: string[];
}

// ============================================================================
// Maintenance Events
// ============================================================================

export interface BeadCompactedEvent extends BaseBeadEvent {
  type: "bead_compacted";
  events_archived: number;
  new_start_sequence: number;
}
