/**
 * Fixtures for smart memory operations eval
 *
 * Test scenarios for ADD/UPDATE/DELETE/NOOP decisions:
 * - Exact match → NOOP (already captured)
 * - Similar content → UPDATE (refine existing)
 * - Contradiction → DELETE (invalidates old memory)
 * - New information → ADD (genuinely new)
 */

import type { Memory } from "swarm-mail";

/**
 * Test case structure for smart operations eval
 */
export interface SmartOperationTestCase {
  /** The new information to upsert */
  readonly newInformation: string;
  /** Existing memories to compare against */
  readonly existingMemories: Memory[];
  /** Expected operation decision */
  readonly expected: {
    readonly operation: "ADD" | "UPDATE" | "DELETE" | "NOOP";
    /** Optional: ID of target memory for UPDATE/DELETE */
    readonly targetId?: string;
  };
  /** Test case description for debugging */
  readonly description: string;
}

/**
 * Fixture data for smart operations eval
 *
 * Covers the four core decision types with clear scenarios.
 */
export const smartOperationCases: SmartOperationTestCase[] = [
  // ============================================================================
  // NOOP Cases - Information already captured
  // ============================================================================
  {
    description: "Exact match → NOOP (no action needed)",
    newInformation: "OAuth tokens need 5min refresh buffer to avoid race conditions",
    existingMemories: [
      {
        id: "mem-exact-match",
        content: "OAuth tokens need 5min refresh buffer to avoid race conditions",
        metadata: { tags: ["auth", "oauth", "tokens"] },
        collection: "default",
        createdAt: new Date("2025-12-20T10:00:00Z"),
        confidence: 0.9,
      },
    ],
    expected: {
      operation: "NOOP",
      targetId: "mem-exact-match",
    },
  },
  {
    description: "Semantically identical → NOOP (already captured)",
    newInformation: "Need to add a 5-minute buffer before OAuth token expiry",
    existingMemories: [
      {
        id: "mem-semantic-match",
        content: "OAuth tokens need 5min refresh buffer to avoid race conditions",
        metadata: { tags: ["auth", "oauth"] },
        collection: "default",
        createdAt: new Date("2025-12-20T10:00:00Z"),
        confidence: 0.8,
      },
    ],
    expected: {
      operation: "NOOP",
      targetId: "mem-semantic-match",
    },
  },

  // ============================================================================
  // UPDATE Cases - Refine/extend existing memory
  // ============================================================================
  {
    description: "Additional detail → UPDATE (extend existing)",
    newInformation:
      "OAuth refresh buffer should be 5min and use exponential backoff if refresh fails",
    existingMemories: [
      {
        id: "mem-needs-detail",
        content: "OAuth tokens need 5min refresh buffer",
        metadata: { tags: ["auth", "oauth"] },
        collection: "default",
        createdAt: new Date("2025-12-20T10:00:00Z"),
        confidence: 0.7,
      },
    ],
    expected: {
      operation: "UPDATE",
      targetId: "mem-needs-detail",
    },
  },
  {
    description: "Refinement with context → UPDATE (add nuance)",
    newInformation:
      "In this project, User.role='admin' does NOT grant deletion rights - need explicit User.permissions.canDelete=true",
    existingMemories: [
      {
        id: "mem-needs-context",
        content: "Admin users have elevated permissions",
        metadata: { tags: ["auth", "permissions"] },
        collection: "default",
        createdAt: new Date("2025-12-20T10:00:00Z"),
        confidence: 0.6,
      },
    ],
    expected: {
      operation: "UPDATE",
      targetId: "mem-needs-context",
    },
  },

  // ============================================================================
  // DELETE Cases - Contradicts existing memory
  // ============================================================================
  {
    description: "Direct contradiction → DELETE (invalidates old)",
    newInformation: "OAuth tokens should refresh immediately when <1min remaining",
    existingMemories: [
      {
        id: "mem-contradicted",
        content: "OAuth tokens need 5min refresh buffer to avoid race conditions",
        metadata: { tags: ["auth", "oauth"] },
        collection: "default",
        createdAt: new Date("2025-12-20T10:00:00Z"),
        confidence: 0.8,
      },
    ],
    expected: {
      operation: "DELETE",
      targetId: "mem-contradicted",
    },
  },
  {
    description: "Obsolete information → DELETE (no longer true)",
    newInformation: "Authentication is now handled by external SSO provider - no local JWT validation",
    existingMemories: [
      {
        id: "mem-obsolete",
        content: "JWT tokens are validated locally using HMAC-SHA256 signature",
        metadata: { tags: ["auth", "jwt"] },
        collection: "default",
        createdAt: new Date("2025-12-15T10:00:00Z"),
        confidence: 0.9,
      },
    ],
    expected: {
      operation: "DELETE",
      targetId: "mem-obsolete",
    },
  },

  // ============================================================================
  // ADD Cases - Genuinely new information
  // ============================================================================
  {
    description: "New topic → ADD (no existing coverage)",
    newInformation:
      "Rate limiting is implemented per-IP with 100 req/min limit and 1-hour ban on violation",
    existingMemories: [
      {
        id: "mem-different-topic",
        content: "OAuth tokens need 5min refresh buffer to avoid race conditions",
        metadata: { tags: ["auth", "oauth"] },
        collection: "default",
        createdAt: new Date("2025-12-20T10:00:00Z"),
        confidence: 0.8,
      },
    ],
    expected: {
      operation: "ADD",
    },
  },
  {
    description: "No existing memories → ADD (first memory)",
    newInformation: "Next.js 16 Cache Components require Suspense boundaries for async operations",
    existingMemories: [],
    expected: {
      operation: "ADD",
    },
  },
  {
    description: "Related but distinct → ADD (different aspect)",
    newInformation: "API keys are stored in Vault with automatic rotation every 90 days",
    existingMemories: [
      {
        id: "mem-related",
        content: "OAuth tokens need 5min refresh buffer to avoid race conditions",
        metadata: { tags: ["auth", "oauth"] },
        collection: "default",
        createdAt: new Date("2025-12-20T10:00:00Z"),
        confidence: 0.8,
      },
    ],
    expected: {
      operation: "ADD",
    },
  },
];
