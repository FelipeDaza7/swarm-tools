/**
 * WorkerHandoff schemas - structured contracts replacing prose instructions
 *
 * Replaces the 400-line SUBTASK_PROMPT_V2 with machine-readable contracts.
 * Workers receive typed handoffs with explicit files, criteria, and escalation paths.
 */
import { z } from "zod";

/**
 * Contract section - the binding agreement between coordinator and worker
 *
 * Defines:
 * - What task to complete (task_id)
 * - What files to modify (files_owned) vs read (files_readonly)
 * - What's already done (dependencies_completed)
 * - How to know you're done (success_criteria)
 */
export const WorkerHandoffContractSchema = z.object({
  /**
   * Cell ID for this subtask.
   * Can be a full cell ID, hash, or partial hash.
   * Examples: 
   * - Full ID: `opencode-swarm-monorepo-lf2p4u-abc123`
   * - Hash only: `lf2p4u`
   * - Partial hash: `mjd4pjuj`
   *
   * The hive tools use resolvePartialId() to expand short IDs before lookup.
   */
  task_id: z
    .string()
    .min(1, "Task ID cannot be empty"),

  /**
   * Files this worker owns (exclusive write access).
   * Empty array is valid for read-only tasks (e.g., documentation review).
   */
  files_owned: z.array(z.string()).default([]),

  /**
   * Files this worker can read but must not modify.
   * Coordinator reserves these for other workers.
   */
  files_readonly: z.array(z.string()).default([]),

  /**
   * Subtask IDs that must complete before this one.
   * Empty if no dependencies (can start immediately).
   */
  dependencies_completed: z.array(z.string()).default([]),

  /**
   * Success criteria - how to know the task is complete.
   * Must have at least one criterion to prevent ambiguous completion.
   */
  success_criteria: z
    .array(z.string())
    .min(1, "Must have at least one success criterion"),
});
export type WorkerHandoffContract = z.infer<typeof WorkerHandoffContractSchema>;

/**
 * Context section - the narrative explaining the "why"
 *
 * Provides:
 * - Big picture (epic_summary)
 * - This worker's specific role
 * - What's already been done
 * - What comes after
 */
export const WorkerHandoffContextSchema = z.object({
  /**
   * High-level summary of the entire epic.
   * Helps worker understand how their piece fits.
   */
  epic_summary: z.string(),

  /**
   * This worker's specific role/responsibility.
   * Should align with files_owned in contract.
   */
  your_role: z.string(),

  /**
   * What previous subtasks accomplished.
   * Empty string is valid for first subtask.
   */
  what_others_did: z.string(),

  /**
   * What happens after this subtask completes.
   * Empty string is valid for last subtask.
   */
  what_comes_next: z.string(),
});
export type WorkerHandoffContext = z.infer<typeof WorkerHandoffContextSchema>;

/**
 * Escalation section - what to do when things go wrong
 *
 * Defines:
 * - How to report blockers
 * - Protocol for scope changes
 */
export const WorkerHandoffEscalationSchema = z.object({
  /**
   * Instructions for reporting blockers.
   * Typically: "Message coordinator via swarmmail_send(importance='high')"
   */
  blocked_contact: z.string(),

  /**
   * Protocol for requesting scope changes.
   * Typically: "Request approval before expanding scope beyond files_owned"
   */
  scope_change_protocol: z.string(),
});
export type WorkerHandoffEscalation = z.infer<
  typeof WorkerHandoffEscalationSchema
>;

/**
 * Complete WorkerHandoff - combines all three sections
 *
 * This is the full structured contract that replaces prose instructions.
 */
export const WorkerHandoffSchema = z.object({
  contract: WorkerHandoffContractSchema,
  context: WorkerHandoffContextSchema,
  escalation: WorkerHandoffEscalationSchema,
});
export type WorkerHandoff = z.infer<typeof WorkerHandoffSchema>;
