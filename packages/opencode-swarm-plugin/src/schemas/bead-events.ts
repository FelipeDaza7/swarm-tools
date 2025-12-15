/**
 * Event Types for Beads Event Sourcing
 *
 * These events form an audit trail for all bead operations.
 * Events are NOT replayed for state reconstruction (beads uses hybrid CRUD + audit trail).
 * Events enable:
 * - Full audit history
 * - Debugging distributed swarm operations
 * - Learning from bead lifecycle patterns
 * - Integration with swarm-mail coordination
 *
 * Design notes:
 * - 75% reusable infrastructure from swarm-mail
 * - Events stay local (PGLite/SQLite), not written to JSONL
 * - JSONL export happens from projection snapshots (proven git merge driver)
 * - Follows same BaseEventSchema pattern as swarm-mail
 */
import { z } from "zod";
import {
  BeadDependencySchema,
  BeadStatusSchema,
  BeadTypeSchema,
} from "./bead.js";

// ============================================================================
// Base Event Schema (mirrors swarm-mail pattern)
// ============================================================================

/**
 * Base fields present on all bead events
 */
export const BaseBeadEventSchema = z.object({
  /** Auto-generated event ID */
  id: z.number().optional(),
  /** Event type discriminator */
  type: z.string(),
  /** Project key (usually absolute path) */
  project_key: z.string(),
  /** Timestamp when event occurred */
  timestamp: z.number(), // Unix ms
  /** Sequence number for ordering */
  sequence: z.number().optional(),
});

// ============================================================================
// Issue Lifecycle Events
// ============================================================================

/**
 * Bead created
 *
 * Emitted when:
 * - User calls `bd create`
 * - Swarm epic decomposition creates subtasks
 * - Agent spawns new beads during work
 */
export const BeadCreatedEventSchema = BaseBeadEventSchema.extend({
  type: z.literal("bead_created"),
  bead_id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  issue_type: BeadTypeSchema,
  priority: z.number().int().min(0).max(3),
  parent_id: z.string().optional(),
  /** Agent/user who created the bead */
  created_by: z.string().optional(),
  /** Metadata for tracking (e.g., epic context, swarm strategy) */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Bead updated (generic field changes)
 *
 * Emitted for non-status field updates: title, description, priority
 */
export const BeadUpdatedEventSchema = BaseBeadEventSchema.extend({
  type: z.literal("bead_updated"),
  bead_id: z.string(),
  /** Agent/user who made the update */
  updated_by: z.string().optional(),
  /** Changed fields with old and new values */
  changes: z.object({
    title: z
      .object({
        old: z.string(),
        new: z.string(),
      })
      .optional(),
    description: z
      .object({
        old: z.string(),
        new: z.string(),
      })
      .optional(),
    priority: z
      .object({
        old: z.number(),
        new: z.number(),
      })
      .optional(),
  }),
});

/**
 * Bead status changed
 *
 * Separate event for status transitions to enable workflow analysis.
 * Tracks state machine: open → in_progress → (blocked | closed)
 */
export const BeadStatusChangedEventSchema = BaseBeadEventSchema.extend({
  type: z.literal("bead_status_changed"),
  bead_id: z.string(),
  from_status: BeadStatusSchema,
  to_status: BeadStatusSchema,
  /** Agent/user who changed status */
  changed_by: z.string().optional(),
  /** Optional reason (required for closed status) */
  reason: z.string().optional(),
});

/**
 * Bead closed
 *
 * Explicit close event (subset of status_changed for convenience).
 * Includes closure reason for audit trail.
 */
export const BeadClosedEventSchema = BaseBeadEventSchema.extend({
  type: z.literal("bead_closed"),
  bead_id: z.string(),
  reason: z.string(),
  /** Agent/user who closed */
  closed_by: z.string().optional(),
  /** Files touched during work (from swarm completion) */
  files_touched: z.array(z.string()).optional(),
  /** Duration in ms (if tracked by agent) */
  duration_ms: z.number().optional(),
});

/**
 * Bead reopened
 *
 * Emitted when closed bead is reopened.
 */
export const BeadReopenedEventSchema = BaseBeadEventSchema.extend({
  type: z.literal("bead_reopened"),
  bead_id: z.string(),
  reason: z.string().optional(),
  /** Agent/user who reopened */
  reopened_by: z.string().optional(),
});

/**
 * Bead deleted
 *
 * Hard delete event (rare - beads are usually closed, not deleted).
 * Useful for cleaning up spurious/duplicate beads.
 */
export const BeadDeletedEventSchema = BaseBeadEventSchema.extend({
  type: z.literal("bead_deleted"),
  bead_id: z.string(),
  reason: z.string().optional(),
  /** Agent/user who deleted */
  deleted_by: z.string().optional(),
});

// ============================================================================
// Dependency Events
// ============================================================================

/**
 * Dependency added between beads
 *
 * Supports 4 relationship types:
 * - blocks: This bead blocks the target
 * - blocked-by: This bead is blocked by the target
 * - related: Informational link
 * - discovered-from: Bead spawned from investigation of target
 */
export const BeadDependencyAddedEventSchema = BaseBeadEventSchema.extend({
  type: z.literal("bead_dependency_added"),
  bead_id: z.string(),
  /** Dependency relationship */
  dependency: BeadDependencySchema,
  /** Agent/user who added dependency */
  added_by: z.string().optional(),
  /** Optional reason (e.g., "needs auth service before OAuth implementation") */
  reason: z.string().optional(),
});

/**
 * Dependency removed
 *
 * Emitted when dependency is no longer relevant or was added in error.
 */
export const BeadDependencyRemovedEventSchema = BaseBeadEventSchema.extend({
  type: z.literal("bead_dependency_removed"),
  bead_id: z.string(),
  /** Dependency being removed */
  dependency: BeadDependencySchema,
  /** Agent/user who removed */
  removed_by: z.string().optional(),
  reason: z.string().optional(),
});

// ============================================================================
// Label Events
// ============================================================================

/**
 * Label added to bead
 *
 * Labels are string tags for categorization/filtering.
 * Common labels: "p0", "needs-review", "blocked-external", "tech-debt"
 */
export const BeadLabelAddedEventSchema = BaseBeadEventSchema.extend({
  type: z.literal("bead_label_added"),
  bead_id: z.string(),
  label: z.string(),
  /** Agent/user who added label */
  added_by: z.string().optional(),
});

/**
 * Label removed from bead
 */
export const BeadLabelRemovedEventSchema = BaseBeadEventSchema.extend({
  type: z.literal("bead_label_removed"),
  bead_id: z.string(),
  label: z.string(),
  /** Agent/user who removed label */
  removed_by: z.string().optional(),
});

// ============================================================================
// Comment Events
// ============================================================================

/**
 * Comment added to bead
 *
 * Supports agent-to-agent communication, human notes, and progress updates.
 */
export const BeadCommentAddedEventSchema = BaseBeadEventSchema.extend({
  type: z.literal("bead_comment_added"),
  bead_id: z.string(),
  /** Auto-generated comment ID */
  comment_id: z.number().optional(),
  author: z.string(),
  body: z.string(),
  /** Optional parent comment ID for threading */
  parent_comment_id: z.number().optional(),
  /** Comment metadata (e.g., attachments, mentions) */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Comment updated (edit)
 */
export const BeadCommentUpdatedEventSchema = BaseBeadEventSchema.extend({
  type: z.literal("bead_comment_updated"),
  bead_id: z.string(),
  comment_id: z.number(),
  old_body: z.string(),
  new_body: z.string(),
  updated_by: z.string(),
});

/**
 * Comment deleted
 */
export const BeadCommentDeletedEventSchema = BaseBeadEventSchema.extend({
  type: z.literal("bead_comment_deleted"),
  bead_id: z.string(),
  comment_id: z.number(),
  deleted_by: z.string(),
  reason: z.string().optional(),
});

// ============================================================================
// Epic Events
// ============================================================================

/**
 * Child bead added to epic
 *
 * Emitted when:
 * - Epic created with subtasks (batch event for each child)
 * - User manually adds child via `bd add-child`
 * - Agent spawns additional subtask during work
 */
export const BeadEpicChildAddedEventSchema = BaseBeadEventSchema.extend({
  type: z.literal("bead_epic_child_added"),
  /** Epic ID */
  bead_id: z.string(),
  /** Child bead ID */
  child_id: z.string(),
  /** Optional index for ordering */
  child_index: z.number().optional(),
  added_by: z.string().optional(),
});

/**
 * Child bead removed from epic
 *
 * Rare - usually happens when subtask is merged/consolidated.
 */
export const BeadEpicChildRemovedEventSchema = BaseBeadEventSchema.extend({
  type: z.literal("bead_epic_child_removed"),
  /** Epic ID */
  bead_id: z.string(),
  /** Child bead ID */
  child_id: z.string(),
  removed_by: z.string().optional(),
  reason: z.string().optional(),
});

/**
 * Epic eligible for closure
 *
 * Emitted when all child beads are closed.
 * Triggers coordinator review for epic closure.
 */
export const BeadEpicClosureEligibleEventSchema = BaseBeadEventSchema.extend({
  type: z.literal("bead_epic_closure_eligible"),
  bead_id: z.string(),
  /** Child bead IDs (all closed) */
  child_ids: z.array(z.string()),
  /** Total duration across all children */
  total_duration_ms: z.number().optional(),
  /** Aggregate file changes */
  all_files_touched: z.array(z.string()).optional(),
});

// ============================================================================
// Swarm Integration Events (bridge to swarm-mail)
// ============================================================================

/**
 * Bead assigned to agent
 *
 * Links beads to swarm-mail's agent tracking.
 * Emitted when agent calls `beads_start` or swarm spawns worker.
 */
export const BeadAssignedEventSchema = BaseBeadEventSchema.extend({
  type: z.literal("bead_assigned"),
  bead_id: z.string(),
  agent_name: z.string(),
  /** Agent's task description for context */
  task_description: z.string().optional(),
});

/**
 * Bead work started
 *
 * Separate from status change to track actual work start time.
 * Useful for duration/velocity metrics.
 */
export const BeadWorkStartedEventSchema = BaseBeadEventSchema.extend({
  type: z.literal("bead_work_started"),
  bead_id: z.string(),
  agent_name: z.string(),
  /** Files reserved for this work */
  reserved_files: z.array(z.string()).optional(),
});

/**
 * Bead compacted
 *
 * Emitted when bead's event history is compressed (rare).
 * Follows steveyegge/beads pattern - old events archived, projection preserved.
 */
export const BeadCompactedEventSchema = BaseBeadEventSchema.extend({
  type: z.literal("bead_compacted"),
  bead_id: z.string(),
  /** Number of events archived */
  events_archived: z.number(),
  /** New event store start sequence */
  new_start_sequence: z.number(),
});

// ============================================================================
// Union Type
// ============================================================================

export const BeadEventSchema = z.discriminatedUnion("type", [
  // Lifecycle
  BeadCreatedEventSchema,
  BeadUpdatedEventSchema,
  BeadStatusChangedEventSchema,
  BeadClosedEventSchema,
  BeadReopenedEventSchema,
  BeadDeletedEventSchema,

  // Dependencies
  BeadDependencyAddedEventSchema,
  BeadDependencyRemovedEventSchema,

  // Labels
  BeadLabelAddedEventSchema,
  BeadLabelRemovedEventSchema,

  // Comments
  BeadCommentAddedEventSchema,
  BeadCommentUpdatedEventSchema,
  BeadCommentDeletedEventSchema,

  // Epic
  BeadEpicChildAddedEventSchema,
  BeadEpicChildRemovedEventSchema,
  BeadEpicClosureEligibleEventSchema,

  // Swarm Integration
  BeadAssignedEventSchema,
  BeadWorkStartedEventSchema,

  // Maintenance
  BeadCompactedEventSchema,
]);

export type BeadEvent = z.infer<typeof BeadEventSchema>;

// ============================================================================
// Individual event types for convenience
// ============================================================================

export type BeadCreatedEvent = z.infer<typeof BeadCreatedEventSchema>;
export type BeadUpdatedEvent = z.infer<typeof BeadUpdatedEventSchema>;
export type BeadStatusChangedEvent = z.infer<
  typeof BeadStatusChangedEventSchema
>;
export type BeadClosedEvent = z.infer<typeof BeadClosedEventSchema>;
export type BeadReopenedEvent = z.infer<typeof BeadReopenedEventSchema>;
export type BeadDeletedEvent = z.infer<typeof BeadDeletedEventSchema>;
export type BeadDependencyAddedEvent = z.infer<
  typeof BeadDependencyAddedEventSchema
>;
export type BeadDependencyRemovedEvent = z.infer<
  typeof BeadDependencyRemovedEventSchema
>;
export type BeadLabelAddedEvent = z.infer<typeof BeadLabelAddedEventSchema>;
export type BeadLabelRemovedEvent = z.infer<typeof BeadLabelRemovedEventSchema>;
export type BeadCommentAddedEvent = z.infer<typeof BeadCommentAddedEventSchema>;
export type BeadCommentUpdatedEvent = z.infer<
  typeof BeadCommentUpdatedEventSchema
>;
export type BeadCommentDeletedEvent = z.infer<
  typeof BeadCommentDeletedEventSchema
>;
export type BeadEpicChildAddedEvent = z.infer<
  typeof BeadEpicChildAddedEventSchema
>;
export type BeadEpicChildRemovedEvent = z.infer<
  typeof BeadEpicChildRemovedEventSchema
>;
export type BeadEpicClosureEligibleEvent = z.infer<
  typeof BeadEpicClosureEligibleEventSchema
>;
export type BeadAssignedEvent = z.infer<typeof BeadAssignedEventSchema>;
export type BeadWorkStartedEvent = z.infer<typeof BeadWorkStartedEventSchema>;
export type BeadCompactedEvent = z.infer<typeof BeadCompactedEventSchema>;

// ============================================================================
// Event Helpers
// ============================================================================

/**
 * Create a bead event with timestamp and validate
 *
 * Usage:
 * ```typescript
 * const event = createBeadEvent("bead_created", {
 *   project_key: "/path/to/repo",
 *   bead_id: "bd-123",
 *   title: "Add auth",
 *   issue_type: "feature",
 *   priority: 2
 * });
 * ```
 */
export function createBeadEvent<T extends BeadEvent["type"]>(
  type: T,
  data: Omit<
    Extract<BeadEvent, { type: T }>,
    "type" | "timestamp" | "id" | "sequence"
  >,
): Extract<BeadEvent, { type: T }> {
  const event = {
    type,
    timestamp: Date.now(),
    ...data,
  } as Extract<BeadEvent, { type: T }>;

  // Validate
  const result = BeadEventSchema.safeParse(event);
  if (!result.success) {
    throw new Error(`Invalid bead event: ${result.error.message}`);
  }

  return result.data as Extract<BeadEvent, { type: T }>;
}

/**
 * Type guard for specific bead event types
 *
 * Usage:
 * ```typescript
 * if (isBeadEventType(event, "bead_closed")) {
 *   console.log(event.reason); // TypeScript knows this is BeadClosedEvent
 * }
 * ```
 */
export function isBeadEventType<T extends BeadEvent["type"]>(
  event: BeadEvent,
  type: T,
): event is Extract<BeadEvent, { type: T }> {
  return event.type === type;
}

/**
 * Extract bead ID from event (convenience helper)
 *
 * All bead events have bead_id field (or it's the epic's bead_id for epic events).
 */
export function getBeadIdFromEvent(event: BeadEvent): string {
  return event.bead_id;
}

/**
 * Check if event represents a state transition
 */
export function isStateTransitionEvent(
  event: BeadEvent,
): event is BeadStatusChangedEvent | BeadClosedEvent | BeadReopenedEvent {
  return (
    event.type === "bead_status_changed" ||
    event.type === "bead_closed" ||
    event.type === "bead_reopened"
  );
}

/**
 * Check if event represents an epic operation
 */
export function isEpicEvent(
  event: BeadEvent,
): event is
  | BeadEpicChildAddedEvent
  | BeadEpicChildRemovedEvent
  | BeadEpicClosureEligibleEvent {
  return (
    event.type === "bead_epic_child_added" ||
    event.type === "bead_epic_child_removed" ||
    event.type === "bead_epic_closure_eligible"
  );
}

/**
 * Check if event was triggered by an agent (vs human user)
 */
export function isAgentEvent(event: BeadEvent): boolean {
  // Agent events have agent_name field or *_by field containing agent signature
  if ("agent_name" in event) return true;

  const actorFields = [
    "created_by",
    "updated_by",
    "changed_by",
    "closed_by",
    "deleted_by",
    "added_by",
    "removed_by",
    "reopened_by",
  ] as const;

  return actorFields.some((field) => {
    if (field in event) {
      const value = (event as Record<string, unknown>)[field];
      // Agent names are typically lowercase or have specific patterns
      return typeof value === "string" && /^[a-z]+$/i.test(value);
    }
    return false;
  });
}
