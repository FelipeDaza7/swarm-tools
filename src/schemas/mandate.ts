/**
 * Mandate schemas for voting system
 *
 * Agents file and vote on ideas, tips, lore, snippets, and feature requests.
 * High-consensus items become "mandates" that influence future behavior.
 *
 * Vote decay and scoring patterns match learning.ts (90-day half-life).
 */
import { z } from "zod";

// ============================================================================
// Core Types
// ============================================================================

/**
 * Content types for mandate entries
 */
export const MandateContentTypeSchema = z.enum([
  "idea",
  "tip",
  "lore",
  "snippet",
  "feature_request",
]);
export type MandateContentType = z.infer<typeof MandateContentTypeSchema>;

/**
 * Mandate status lifecycle
 *
 * - candidate: New entry, collecting votes
 * - established: Has some consensus but not enough for mandate status
 * - mandate: High consensus (net_votes >= 5 AND vote_ratio >= 0.7)
 * - rejected: Strong negative consensus or explicitly rejected
 */
export const MandateStatusSchema = z.enum([
  "candidate",
  "established",
  "mandate",
  "rejected",
]);
export type MandateStatus = z.infer<typeof MandateStatusSchema>;

/**
 * Vote type
 */
export const VoteTypeSchema = z.enum(["upvote", "downvote"]);
export type VoteType = z.infer<typeof VoteTypeSchema>;

// ============================================================================
// Entry Schema
// ============================================================================

/**
 * A mandate entry represents a proposal from an agent
 *
 * Entries can be ideas, tips, lore, code snippets, or feature requests.
 * Other agents vote on entries to reach consensus.
 */
export const MandateEntrySchema = z.object({
  /** Unique ID for this entry */
  id: z.string(),
  /** The actual content of the mandate */
  content: z.string().min(1, "Content required"),
  /** Type of content */
  content_type: MandateContentTypeSchema,
  /** Agent that created this entry */
  author_agent: z.string(),
  /** When this entry was created (ISO-8601) */
  created_at: z.string().datetime({ offset: true }),
  /** Current status */
  status: MandateStatusSchema.default("candidate"),
  /** Optional tags for categorization and search */
  tags: z.array(z.string()).default([]),
  /** Optional metadata (e.g., code language for snippets) */
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type MandateEntry = z.infer<typeof MandateEntrySchema>;

// ============================================================================
// Vote Schema
// ============================================================================

/**
 * A vote on a mandate entry
 *
 * Each agent can vote once per entry (upvote or downvote).
 * Votes decay with 90-day half-life matching learning.ts patterns.
 */
export const VoteSchema = z.object({
  /** Unique ID for this vote */
  id: z.string(),
  /** The mandate entry this vote applies to */
  mandate_id: z.string(),
  /** Agent that cast this vote */
  agent_name: z.string(),
  /** Type of vote */
  vote_type: VoteTypeSchema,
  /** When this vote was cast (ISO-8601) */
  timestamp: z.string().datetime({ offset: true }),
  /** Raw vote weight before decay (default: 1.0) */
  weight: z.number().min(0).max(1).default(1.0),
});
export type Vote = z.infer<typeof VoteSchema>;

// ============================================================================
// Score Schema
// ============================================================================

/**
 * Calculated score for a mandate entry
 *
 * Scores are recalculated periodically with decay applied.
 * Uses same decay formula as learning.ts (90-day half-life).
 */
export const MandateScoreSchema = z.object({
  /** The mandate entry this score applies to */
  mandate_id: z.string(),
  /** Net votes (upvotes - downvotes) with decay applied */
  net_votes: z.number(),
  /** Vote ratio: upvotes / (upvotes + downvotes) */
  vote_ratio: z.number().min(0).max(1),
  /** Final decayed score for ranking */
  decayed_score: z.number(),
  /** When this score was last calculated (ISO-8601) */
  last_calculated: z.string().datetime({ offset: true }),
  /** Raw vote counts (before decay) */
  raw_upvotes: z.number().int().min(0),
  raw_downvotes: z.number().int().min(0),
  /** Decayed vote counts */
  decayed_upvotes: z.number().min(0),
  decayed_downvotes: z.number().min(0),
});
export type MandateScore = z.infer<typeof MandateScoreSchema>;

// ============================================================================
// Decay Configuration
// ============================================================================

/**
 * Configuration for mandate decay calculation
 *
 * Matches learning.ts decay patterns.
 */
export interface MandateDecayConfig {
  /** Half-life for vote decay in days */
  halfLifeDays: number;
  /** Net votes threshold for mandate status */
  mandateNetVotesThreshold: number;
  /** Vote ratio threshold for mandate status */
  mandateVoteRatioThreshold: number;
  /** Net votes threshold for established status */
  establishedNetVotesThreshold: number;
  /** Negative net votes threshold for rejected status */
  rejectedNetVotesThreshold: number;
}

export const DEFAULT_MANDATE_DECAY_CONFIG: MandateDecayConfig = {
  halfLifeDays: 90,
  mandateNetVotesThreshold: 5,
  mandateVoteRatioThreshold: 0.7,
  establishedNetVotesThreshold: 2,
  rejectedNetVotesThreshold: -3,
};

// ============================================================================
// API Schemas
// ============================================================================

/**
 * Arguments for creating a mandate entry
 */
export const CreateMandateArgsSchema = z.object({
  content: z.string().min(1, "Content required"),
  content_type: MandateContentTypeSchema,
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateMandateArgs = z.infer<typeof CreateMandateArgsSchema>;

/**
 * Arguments for casting a vote
 */
export const CastVoteArgsSchema = z.object({
  mandate_id: z.string(),
  vote_type: VoteTypeSchema,
  weight: z.number().min(0).max(1).default(1.0),
});
export type CastVoteArgs = z.infer<typeof CastVoteArgsSchema>;

/**
 * Arguments for querying mandates
 */
export const QueryMandatesArgsSchema = z.object({
  status: MandateStatusSchema.optional(),
  content_type: MandateContentTypeSchema.optional(),
  tags: z.array(z.string()).optional(),
  author_agent: z.string().optional(),
  limit: z.number().int().positive().default(20),
  min_score: z.number().optional(),
});
export type QueryMandatesArgs = z.infer<typeof QueryMandatesArgsSchema>;

/**
 * Result of score calculation
 */
export const ScoreCalculationResultSchema = z.object({
  mandate_id: z.string(),
  previous_status: MandateStatusSchema,
  new_status: MandateStatusSchema,
  score: MandateScoreSchema,
  status_changed: z.boolean(),
});
export type ScoreCalculationResult = z.infer<
  typeof ScoreCalculationResultSchema
>;

// ============================================================================
// Exports
// ============================================================================

export const mandateSchemas = {
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
};
