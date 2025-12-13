/**
 * Tests for mandate promotion engine
 */

import { describe, expect, it } from "vitest";
import {
  evaluateBatchPromotions,
  evaluatePromotion,
  formatPromotionResult,
  getStatusChanges,
  groupByTransition,
  shouldPromote,
} from "./mandate-promotion";
import { DEFAULT_MANDATE_DECAY_CONFIG } from "./schemas/mandate";
import type { MandateEntry, MandateScore } from "./schemas/mandate";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockEntry(
  id: string,
  status: "candidate" | "established" | "mandate" | "rejected" = "candidate",
): MandateEntry {
  return {
    id,
    content: "Test mandate content",
    content_type: "idea",
    author_agent: "TestAgent",
    created_at: new Date().toISOString(),
    status,
    tags: [],
  };
}

function createMockScore(
  mandate_id: string,
  net_votes: number,
  vote_ratio: number,
  raw_upvotes: number = Math.max(0, net_votes),
  raw_downvotes: number = 0,
): MandateScore {
  return {
    mandate_id,
    net_votes,
    vote_ratio,
    decayed_score: net_votes * vote_ratio,
    last_calculated: new Date().toISOString(),
    raw_upvotes,
    raw_downvotes,
    decayed_upvotes: raw_upvotes,
    decayed_downvotes: raw_downvotes,
  };
}

// ============================================================================
// shouldPromote Tests
// ============================================================================

describe("shouldPromote", () => {
  it("candidate stays candidate with insufficient votes", () => {
    const score = createMockScore("m1", 1, 1.0);
    const result = shouldPromote(score, "candidate");
    expect(result).toBe("candidate");
  });

  it("candidate → established at threshold (net_votes >= 2)", () => {
    const score = createMockScore("m1", 2, 1.0);
    const result = shouldPromote(score, "candidate");
    expect(result).toBe("established");
  });

  it("candidate → established above threshold", () => {
    const score = createMockScore("m1", 3, 0.9);
    const result = shouldPromote(score, "candidate");
    expect(result).toBe("established");
  });

  it("established stays established with insufficient mandate votes", () => {
    const score = createMockScore("m1", 3, 0.8);
    const result = shouldPromote(score, "established");
    expect(result).toBe("established");
  });

  it("established stays established with low vote ratio", () => {
    const score = createMockScore("m1", 6, 0.6); // net_votes OK, but ratio < 0.7
    const result = shouldPromote(score, "established");
    expect(result).toBe("established");
  });

  it("established → mandate at threshold (net >= 5, ratio >= 0.7)", () => {
    const score = createMockScore("m1", 5, 0.7);
    const result = shouldPromote(score, "established");
    expect(result).toBe("mandate");
  });

  it("established → mandate above threshold", () => {
    const score = createMockScore("m1", 10, 0.9);
    const result = shouldPromote(score, "established");
    expect(result).toBe("mandate");
  });

  it("mandate stays mandate (no demotion)", () => {
    const score = createMockScore("m1", 3, 0.5); // Degraded score
    const result = shouldPromote(score, "mandate");
    expect(result).toBe("mandate");
  });

  it("candidate → rejected with negative votes", () => {
    const score = createMockScore("m1", -3, 0.2);
    const result = shouldPromote(score, "candidate");
    expect(result).toBe("rejected");
  });

  it("established → rejected with negative votes", () => {
    const score = createMockScore("m1", -4, 0.1);
    const result = shouldPromote(score, "established");
    expect(result).toBe("rejected");
  });

  it("rejected stays rejected (permanent)", () => {
    const score = createMockScore("m1", 5, 0.9); // Even with good score
    const result = shouldPromote(score, "rejected");
    expect(result).toBe("rejected");
  });

  it("uses custom config thresholds", () => {
    const score = createMockScore("m1", 3, 0.6);
    const customConfig = {
      ...DEFAULT_MANDATE_DECAY_CONFIG,
      establishedNetVotesThreshold: 3,
      mandateNetVotesThreshold: 3,
      mandateVoteRatioThreshold: 0.6,
    };
    const result = shouldPromote(score, "candidate", customConfig);
    expect(result).toBe("established");

    const result2 = shouldPromote(score, "established", customConfig);
    expect(result2).toBe("mandate");
  });
});

// ============================================================================
// evaluatePromotion Tests
// ============================================================================

describe("evaluatePromotion", () => {
  it("returns correct promotion result for candidate → established", () => {
    const entry = createMockEntry("m1", "candidate");
    const score = createMockScore("m1", 2, 1.0);
    const result = evaluatePromotion(entry, score);

    expect(result.mandate_id).toBe("m1");
    expect(result.previous_status).toBe("candidate");
    expect(result.new_status).toBe("established");
    expect(result.promoted).toBe(true);
    expect(result.reason).toContain("Promoted to established");
    expect(result.score).toEqual(score);
  });

  it("returns correct promotion result for established → mandate", () => {
    const entry = createMockEntry("m1", "established");
    const score = createMockScore("m1", 5, 0.7);
    const result = evaluatePromotion(entry, score);

    expect(result.mandate_id).toBe("m1");
    expect(result.previous_status).toBe("established");
    expect(result.new_status).toBe("mandate");
    expect(result.promoted).toBe(true);
    expect(result.reason).toContain("Promoted to mandate");
  });

  it("returns correct promotion result for candidate → rejected", () => {
    const entry = createMockEntry("m1", "candidate");
    const score = createMockScore("m1", -3, 0.2);
    const result = evaluatePromotion(entry, score);

    expect(result.mandate_id).toBe("m1");
    expect(result.previous_status).toBe("candidate");
    expect(result.new_status).toBe("rejected");
    expect(result.promoted).toBe(true);
    expect(result.reason).toContain("Rejected due to negative consensus");
  });

  it("returns correct result for no status change", () => {
    const entry = createMockEntry("m1", "candidate");
    const score = createMockScore("m1", 1, 0.8);
    const result = evaluatePromotion(entry, score);

    expect(result.mandate_id).toBe("m1");
    expect(result.previous_status).toBe("candidate");
    expect(result.new_status).toBe("candidate");
    expect(result.promoted).toBe(false);
    expect(result.reason).toContain("Remains candidate");
  });

  it("returns correct result for mandate staying mandate", () => {
    const entry = createMockEntry("m1", "mandate");
    const score = createMockScore("m1", 3, 0.5); // Degraded
    const result = evaluatePromotion(entry, score);

    expect(result.mandate_id).toBe("m1");
    expect(result.previous_status).toBe("mandate");
    expect(result.new_status).toBe("mandate");
    expect(result.promoted).toBe(false);
    expect(result.reason).toContain("Remains mandate");
  });

  it("returns correct result for rejected staying rejected", () => {
    const entry = createMockEntry("m1", "rejected");
    const score = createMockScore("m1", 10, 0.95); // Good score
    const result = evaluatePromotion(entry, score);

    expect(result.mandate_id).toBe("m1");
    expect(result.previous_status).toBe("rejected");
    expect(result.new_status).toBe("rejected");
    expect(result.promoted).toBe(false);
    expect(result.reason).toContain("Remains rejected");
  });
});

// ============================================================================
// Decay Effect Tests
// ============================================================================

describe("decay affects promotion timing", () => {
  it("net_votes can decay below promotion threshold", () => {
    // Entry was established with 2.5 decayed net_votes
    const entry = createMockEntry("m1", "established");
    const score = createMockScore("m1", 1.5, 0.8); // Decayed below threshold
    const result = evaluatePromotion(entry, score);

    // Stays established (no demotion) even though decayed below candidate→established threshold
    expect(result.new_status).toBe("established");
    expect(result.promoted).toBe(false);
  });

  it("vote_ratio decay prevents mandate promotion", () => {
    const entry = createMockEntry("m1", "established");
    // High net_votes but low ratio due to decay
    const score = createMockScore("m1", 6, 0.65, 10, 4); // ratio < 0.7
    const result = evaluatePromotion(entry, score);

    expect(result.new_status).toBe("established");
    expect(result.promoted).toBe(false);
    expect(result.reason).toContain("below mandate threshold");
  });

  it("fresh votes can push over mandate threshold", () => {
    const entry = createMockEntry("m1", "established");
    const score = createMockScore("m1", 5.1, 0.75, 8, 3); // Fresh votes
    const result = evaluatePromotion(entry, score);

    expect(result.new_status).toBe("mandate");
    expect(result.promoted).toBe(true);
  });
});

// ============================================================================
// Utility Functions Tests
// ============================================================================

describe("formatPromotionResult", () => {
  it("formats promoted result with arrow", () => {
    const entry = createMockEntry("m1", "candidate");
    const score = createMockScore("m1", 2, 1.0);
    const result = evaluatePromotion(entry, score);
    const formatted = formatPromotionResult(result);

    expect(formatted).toContain("[m1]");
    expect(formatted).toContain("candidate → established");
  });

  it("formats no-change result without arrow", () => {
    const entry = createMockEntry("m1", "candidate");
    const score = createMockScore("m1", 1, 0.8);
    const result = evaluatePromotion(entry, score);
    const formatted = formatPromotionResult(result);

    expect(formatted).toContain("[m1]");
    expect(formatted).toContain("candidate");
    expect(formatted).not.toContain("→");
  });
});

describe("evaluateBatchPromotions", () => {
  it("evaluates multiple entries", () => {
    const entries = new Map([
      ["m1", createMockEntry("m1", "candidate")],
      ["m2", createMockEntry("m2", "established")],
      ["m3", createMockEntry("m3", "mandate")],
    ]);

    const scores = new Map([
      ["m1", createMockScore("m1", 2, 1.0)], // Will promote
      ["m2", createMockScore("m2", 5, 0.7)], // Will promote
      ["m3", createMockScore("m3", 10, 0.9)], // Stays mandate
    ]);

    const results = evaluateBatchPromotions(entries, scores);

    expect(results).toHaveLength(3);
    expect(results[0].new_status).toBe("established");
    expect(results[1].new_status).toBe("mandate");
    expect(results[2].new_status).toBe("mandate");
  });

  it("skips entries without scores", () => {
    const entries = new Map([
      ["m1", createMockEntry("m1", "candidate")],
      ["m2", createMockEntry("m2", "established")],
    ]);

    const scores = new Map([
      ["m1", createMockScore("m1", 2, 1.0)],
      // m2 has no score
    ]);

    const results = evaluateBatchPromotions(entries, scores);

    expect(results).toHaveLength(1);
    expect(results[0].mandate_id).toBe("m1");
  });
});

describe("getStatusChanges", () => {
  it("filters to only promoted entries", () => {
    const results = [
      {
        mandate_id: "m1",
        previous_status: "candidate" as const,
        new_status: "established" as const,
        score: createMockScore("m1", 2, 1.0),
        promoted: true,
        reason: "Promoted",
      },
      {
        mandate_id: "m2",
        previous_status: "candidate" as const,
        new_status: "candidate" as const,
        score: createMockScore("m2", 1, 0.8),
        promoted: false,
        reason: "No change",
      },
      {
        mandate_id: "m3",
        previous_status: "established" as const,
        new_status: "mandate" as const,
        score: createMockScore("m3", 5, 0.7),
        promoted: true,
        reason: "Promoted",
      },
    ];

    const changes = getStatusChanges(results);

    expect(changes).toHaveLength(2);
    expect(changes[0].mandate_id).toBe("m1");
    expect(changes[1].mandate_id).toBe("m3");
  });
});

describe("groupByTransition", () => {
  it("groups results by transition type", () => {
    const results = [
      {
        mandate_id: "m1",
        previous_status: "candidate" as const,
        new_status: "established" as const,
        score: createMockScore("m1", 2, 1.0),
        promoted: true,
        reason: "Promoted",
      },
      {
        mandate_id: "m2",
        previous_status: "candidate" as const,
        new_status: "established" as const,
        score: createMockScore("m2", 3, 1.0),
        promoted: true,
        reason: "Promoted",
      },
      {
        mandate_id: "m3",
        previous_status: "established" as const,
        new_status: "mandate" as const,
        score: createMockScore("m3", 5, 0.7),
        promoted: true,
        reason: "Promoted",
      },
      {
        mandate_id: "m4",
        previous_status: "candidate" as const,
        new_status: "candidate" as const,
        score: createMockScore("m4", 1, 0.8),
        promoted: false,
        reason: "No change",
      },
    ];

    const grouped = groupByTransition(results);

    expect(grouped.size).toBe(3);
    expect(grouped.get("candidate→established")).toHaveLength(2);
    expect(grouped.get("established→mandate")).toHaveLength(1);
    expect(grouped.get("candidate")).toHaveLength(1);
  });

  it("uses status name for no-change transitions", () => {
    const results = [
      {
        mandate_id: "m1",
        previous_status: "mandate" as const,
        new_status: "mandate" as const,
        score: createMockScore("m1", 10, 0.9),
        promoted: false,
        reason: "Stays",
      },
      {
        mandate_id: "m2",
        previous_status: "rejected" as const,
        new_status: "rejected" as const,
        score: createMockScore("m2", -5, 0.1),
        promoted: false,
        reason: "Stays",
      },
    ];

    const grouped = groupByTransition(results);

    expect(grouped.size).toBe(2);
    expect(grouped.get("mandate")).toHaveLength(1);
    expect(grouped.get("rejected")).toHaveLength(1);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("edge cases", () => {
  it("handles exact threshold values", () => {
    const entry1 = createMockEntry("m1", "candidate");
    const score1 = createMockScore("m1", 2.0, 1.0); // Exact threshold
    const result1 = evaluatePromotion(entry1, score1);
    expect(result1.new_status).toBe("established");

    const entry2 = createMockEntry("m2", "established");
    const score2 = createMockScore("m2", 5.0, 0.7); // Exact threshold
    const result2 = evaluatePromotion(entry2, score2);
    expect(result2.new_status).toBe("mandate");
  });

  it("handles zero votes", () => {
    const entry = createMockEntry("m1", "candidate");
    const score = createMockScore("m1", 0, 0);
    const result = evaluatePromotion(entry, score);
    expect(result.new_status).toBe("candidate");
  });

  it("handles negative vote ratio edge case", () => {
    const entry = createMockEntry("m1", "established");
    const score = createMockScore("m1", 5, 0.2, 1, 4); // Low ratio
    const result = evaluatePromotion(entry, score);
    expect(result.new_status).toBe("established"); // ratio < 0.7
  });

  it("rejects at exact rejection threshold", () => {
    const entry = createMockEntry("m1", "candidate");
    const score = createMockScore("m1", -3, 0.1);
    const result = evaluatePromotion(entry, score);
    expect(result.new_status).toBe("rejected");
  });
});
