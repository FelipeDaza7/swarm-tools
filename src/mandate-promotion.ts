/**
 * Mandate Promotion Engine
 *
 * Handles state transitions for mandate entries based on vote scores:
 * - candidate → established: net_votes >= 2
 * - established → mandate: net_votes >= 5 AND vote_ratio >= 0.7
 * - any → rejected: net_votes <= -3
 *
 * Integrates with pattern-maturity.ts decay calculations and state machine patterns.
 */

import { DEFAULT_MANDATE_DECAY_CONFIG } from "./schemas/mandate";
import type {
  MandateDecayConfig,
  MandateEntry,
  MandateScore,
  MandateStatus,
} from "./schemas/mandate";

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a promotion evaluation
 */
export interface PromotionResult {
  /** The mandate entry ID */
  mandate_id: string;
  /** Status before evaluation */
  previous_status: MandateStatus;
  /** Status after evaluation */
  new_status: MandateStatus;
  /** Calculated score */
  score: MandateScore;
  /** Whether status changed */
  promoted: boolean;
  /** Human-readable reason for the transition (or lack thereof) */
  reason: string;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Determine new status based on score and current status
 *
 * State machine:
 * - candidate → established: net_votes >= establishedNetVotesThreshold (2)
 * - established → mandate: net_votes >= mandateNetVotesThreshold (5) AND vote_ratio >= mandateVoteRatioThreshold (0.7)
 * - any → rejected: net_votes <= rejectedNetVotesThreshold (-3)
 * - mandate stays mandate (no demotion)
 * - rejected stays rejected (permanent)
 *
 * @param score - Calculated mandate score with decayed votes
 * @param currentStatus - Current status of the mandate entry
 * @param config - Threshold configuration
 * @returns New status after applying transition rules
 */
export function shouldPromote(
  score: MandateScore,
  currentStatus: MandateStatus,
  config: MandateDecayConfig = DEFAULT_MANDATE_DECAY_CONFIG,
): MandateStatus {
  // Edge case: already rejected, stays rejected (permanent)
  if (currentStatus === "rejected") {
    return "rejected";
  }

  // Edge case: already mandate, stays mandate (no demotion)
  if (currentStatus === "mandate") {
    return "mandate";
  }

  // Now we know status is either "candidate" or "established"
  // Check rejection threshold first
  if (score.net_votes <= config.rejectedNetVotesThreshold) {
    return "rejected";
  }

  // Check mandate promotion (from established only)
  if (currentStatus === "established") {
    if (
      score.net_votes >= config.mandateNetVotesThreshold &&
      score.vote_ratio >= config.mandateVoteRatioThreshold
    ) {
      return "mandate";
    }
    return "established"; // Stays established
  }

  // Now we know status is "candidate"
  // Check established promotion
  if (score.net_votes >= config.establishedNetVotesThreshold) {
    return "established";
  }

  return "candidate"; // Stays candidate
}

/**
 * Evaluate promotion for a mandate entry
 *
 * Main entry point for promotion logic. Calculates new status and provides
 * detailed reasoning for the decision.
 *
 * @param entry - The mandate entry to evaluate
 * @param score - Calculated score with decayed votes
 * @param config - Threshold configuration (optional)
 * @returns Promotion result with status change and reasoning
 */
export function evaluatePromotion(
  entry: MandateEntry,
  score: MandateScore,
  config: MandateDecayConfig = DEFAULT_MANDATE_DECAY_CONFIG,
): PromotionResult {
  const previousStatus = entry.status;
  const newStatus = shouldPromote(score, previousStatus, config);
  const promoted = newStatus !== previousStatus;

  // Generate reason based on transition
  let reason: string;

  if (newStatus === "rejected" && previousStatus === "rejected") {
    reason = `Remains rejected (permanent)`;
  } else if (newStatus === "rejected") {
    reason = `Rejected due to negative consensus (net_votes: ${score.net_votes.toFixed(2)} ≤ ${config.rejectedNetVotesThreshold})`;
  } else if (newStatus === "mandate" && previousStatus === "mandate") {
    reason = `Remains mandate (no demotion)`;
  } else if (newStatus === "mandate" && previousStatus === "established") {
    reason = `Promoted to mandate (net_votes: ${score.net_votes.toFixed(2)} ≥ ${config.mandateNetVotesThreshold}, ratio: ${score.vote_ratio.toFixed(2)} ≥ ${config.mandateVoteRatioThreshold})`;
  } else if (newStatus === "established" && previousStatus === "established") {
    reason = `Remains established (net_votes: ${score.net_votes.toFixed(2)}, ratio: ${score.vote_ratio.toFixed(2)} below mandate threshold)`;
  } else if (newStatus === "established" && previousStatus === "candidate") {
    reason = `Promoted to established (net_votes: ${score.net_votes.toFixed(2)} ≥ ${config.establishedNetVotesThreshold})`;
  } else if (newStatus === "candidate") {
    reason = `Remains candidate (net_votes: ${score.net_votes.toFixed(2)} below threshold)`;
  } else {
    reason = `No status change (current: ${previousStatus})`;
  }

  return {
    mandate_id: entry.id,
    previous_status: previousStatus,
    new_status: newStatus,
    score,
    promoted,
    reason,
  };
}

/**
 * Format promotion result for logging or display
 *
 * @param result - Promotion result
 * @returns Formatted string
 */
export function formatPromotionResult(result: PromotionResult): string {
  const arrow = result.promoted
    ? `${result.previous_status} → ${result.new_status}`
    : result.new_status;

  return `[${result.mandate_id}] ${arrow}: ${result.reason}`;
}

/**
 * Batch evaluate promotions for multiple entries
 *
 * Useful for periodic recalculation of all mandate statuses.
 *
 * @param entries - Map of mandate IDs to entries
 * @param scores - Map of mandate IDs to scores
 * @param config - Threshold configuration (optional)
 * @returns Array of promotion results
 */
export function evaluateBatchPromotions(
  entries: Map<string, MandateEntry>,
  scores: Map<string, MandateScore>,
  config: MandateDecayConfig = DEFAULT_MANDATE_DECAY_CONFIG,
): PromotionResult[] {
  const results: PromotionResult[] = [];

  for (const [id, entry] of entries) {
    const score = scores.get(id);
    if (!score) {
      // Skip entries without scores
      continue;
    }

    const result = evaluatePromotion(entry, score, config);
    results.push(result);
  }

  return results;
}

/**
 * Get entries that changed status (promoted or demoted)
 *
 * Useful for filtering batch results to only show changes.
 *
 * @param results - Promotion results
 * @returns Only the results where status changed
 */
export function getStatusChanges(
  results: PromotionResult[],
): PromotionResult[] {
  return results.filter((r) => r.promoted);
}

/**
 * Group promotion results by status transition
 *
 * Useful for analytics and reporting.
 *
 * @param results - Promotion results
 * @returns Map of transition keys (e.g., "candidate→established") to results
 */
export function groupByTransition(
  results: PromotionResult[],
): Map<string, PromotionResult[]> {
  const groups = new Map<string, PromotionResult[]>();

  for (const result of results) {
    const key = result.promoted
      ? `${result.previous_status}→${result.new_status}`
      : result.new_status;

    const existing = groups.get(key);
    if (existing) {
      existing.push(result);
    } else {
      groups.set(key, [result]);
    }
  }

  return groups;
}
