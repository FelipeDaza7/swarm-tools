/**
 * Schema Definitions - Central export point for all Zod schemas
 *
 * This module re-exports all schema definitions used throughout the plugin.
 * Schemas are organized by domain:
 *
 * ## Bead Schemas (Issue Tracking)
 * - `BeadSchema` - Core bead/issue definition
 * - `BeadStatusSchema` - Status enum (open, in_progress, blocked, closed)
 * - `BeadTypeSchema` - Type enum (bug, feature, task, epic, chore)
 * - `SubtaskSpecSchema` - Subtask specification for epic creation
 *
 * ## Task Schemas (Swarm Decomposition)
 * - `TaskDecompositionSchema` - Full task breakdown
 * - `DecomposedSubtaskSchema` - Individual subtask definition
 * - `BeadTreeSchema` - Epic + subtasks structure
 *
 * ## Evaluation Schemas (Agent Self-Assessment)
 * - `EvaluationSchema` - Complete evaluation with criteria
 * - `CriterionEvaluationSchema` - Single criterion result
 *
 * ## Progress Schemas (Swarm Coordination)
 * - `SwarmStatusSchema` - Overall swarm progress
 * - `AgentProgressSchema` - Individual agent status
 * - `SpawnedAgentSchema` - Spawned agent metadata
 *
 * @module schemas
 */

// Bead schemas
export {
  BeadStatusSchema,
  BeadTypeSchema,
  BeadDependencySchema,
  BeadSchema,
  BeadCreateArgsSchema,
  BeadUpdateArgsSchema,
  BeadCloseArgsSchema,
  BeadQueryArgsSchema,
  SubtaskSpecSchema,
  BeadTreeSchema,
  EpicCreateArgsSchema,
  EpicCreateResultSchema,
  type BeadStatus,
  type BeadType,
  type BeadDependency,
  type Bead,
  type BeadCreateArgs,
  type BeadUpdateArgs,
  type BeadCloseArgs,
  type BeadQueryArgs,
  type SubtaskSpec,
  type BeadTree,
  type EpicCreateArgs,
  type EpicCreateResult,
} from "./bead";

// Evaluation schemas
export {
  CriterionEvaluationSchema,
  WeightedCriterionEvaluationSchema,
  EvaluationSchema,
  WeightedEvaluationSchema,
  EvaluationRequestSchema,
  SwarmEvaluationResultSchema,
  ValidationResultSchema,
  DEFAULT_CRITERIA,
  type CriterionEvaluation,
  type WeightedCriterionEvaluation,
  type Evaluation,
  type WeightedEvaluation,
  type EvaluationRequest,
  type SwarmEvaluationResult,
  type ValidationResult,
  type DefaultCriterion,
} from "./evaluation";

// Task schemas
export {
  EffortLevelSchema,
  DependencyTypeSchema,
  DecomposedSubtaskSchema,
  SubtaskDependencySchema,
  TaskDecompositionSchema,
  DecomposeArgsSchema,
  SpawnedAgentSchema,
  SwarmSpawnResultSchema,
  AgentProgressSchema,
  SwarmStatusSchema,
  type EffortLevel,
  type DependencyType,
  type DecomposedSubtask,
  type SubtaskDependency,
  type TaskDecomposition,
  type DecomposeArgs,
  type SpawnedAgent,
  type SwarmSpawnResult,
  type AgentProgress,
  type SwarmStatus,
} from "./task";

// Mandate schemas
export {
  MandateContentTypeSchema,
  MandateStatusSchema,
  VoteTypeSchema,
  MandateEntrySchema,
  VoteSchema,
  MandateScoreSchema,
  CreateMandateArgsSchema,
  CastVoteArgsSchema,
  QueryMandatesArgsSchema,
  ScoreCalculationResultSchema,
  DEFAULT_MANDATE_DECAY_CONFIG,
  mandateSchemas,
  type MandateContentType,
  type MandateStatus,
  type VoteType,
  type MandateEntry,
  type Vote,
  type MandateScore,
  type MandateDecayConfig,
  type CreateMandateArgs,
  type CastVoteArgs,
  type QueryMandatesArgs,
  type ScoreCalculationResult,
} from "./mandate";

// Swarm context schemas
export {
  SwarmStrategySchema,
  SwarmDirectivesSchema,
  SwarmRecoverySchema,
  SwarmBeadContextSchema,
  CreateSwarmContextArgsSchema,
  UpdateSwarmContextArgsSchema,
  QuerySwarmContextsArgsSchema,
  type SwarmStrategy,
  type SwarmDirectives,
  type SwarmRecovery,
  type SwarmBeadContext,
  type CreateSwarmContextArgs,
  type UpdateSwarmContextArgs,
  type QuerySwarmContextsArgs,
} from "./swarm-context";

// Bead event schemas
export {
  BaseBeadEventSchema,
  BeadCreatedEventSchema,
  BeadUpdatedEventSchema,
  BeadStatusChangedEventSchema,
  BeadClosedEventSchema,
  BeadReopenedEventSchema,
  BeadDeletedEventSchema,
  BeadDependencyAddedEventSchema,
  BeadDependencyRemovedEventSchema,
  BeadLabelAddedEventSchema,
  BeadLabelRemovedEventSchema,
  BeadCommentAddedEventSchema,
  BeadCommentUpdatedEventSchema,
  BeadCommentDeletedEventSchema,
  BeadEpicChildAddedEventSchema,
  BeadEpicChildRemovedEventSchema,
  BeadEpicClosureEligibleEventSchema,
  BeadAssignedEventSchema,
  BeadWorkStartedEventSchema,
  BeadCompactedEventSchema,
  BeadEventSchema,
  createBeadEvent,
  isBeadEventType,
  getBeadIdFromEvent,
  isStateTransitionEvent,
  isEpicEvent,
  isAgentEvent,
  type BeadEvent,
  type BeadCreatedEvent,
  type BeadUpdatedEvent,
  type BeadStatusChangedEvent,
  type BeadClosedEvent,
  type BeadReopenedEvent,
  type BeadDeletedEvent,
  type BeadDependencyAddedEvent,
  type BeadDependencyRemovedEvent,
  type BeadLabelAddedEvent,
  type BeadLabelRemovedEvent,
  type BeadCommentAddedEvent,
  type BeadCommentUpdatedEvent,
  type BeadCommentDeletedEvent,
  type BeadEpicChildAddedEvent,
  type BeadEpicChildRemovedEvent,
  type BeadEpicClosureEligibleEvent,
  type BeadAssignedEvent,
  type BeadWorkStartedEvent,
  type BeadCompactedEvent,
} from "./bead-events";
