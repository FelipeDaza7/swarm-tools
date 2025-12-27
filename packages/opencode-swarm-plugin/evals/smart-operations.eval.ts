/**
 * Smart Memory Operations Eval
 *
 * Tests the quality of memory operation decisions (ADD/UPDATE/DELETE/NOOP).
 * Uses real LLM calls to adapter.upsert() with useSmartOps=true.
 *
 * Scorer evaluates:
 * - Correctness of operation choice (right action for the scenario)
 * - Reasoning quality (sound justification)
 * - Edge case handling (exact matches, contradictions, refinements)
 * - Consistency (similar inputs → similar decisions)
 *
 * Run with: bun run eval:smart-operations
 *
 * Requires: AI_GATEWAY_API_KEY environment variable
 */

import { evalite } from "evalite";
import { createInMemorySwarmMail } from "swarm-mail";
import { createMemoryAdapter } from "swarm-mail";
import { smartOperationCases } from "./fixtures/smart-operations-fixtures.js";
import { smartOperationQuality } from "./scorers/smart-operations-scorer.js";

/**
 * Smart Memory Operations Eval
 *
 * Tests upsert() with useSmartOps=true against known scenarios.
 */
evalite("Smart Memory Operations", {
  // Test data from fixtures
  data: async () =>
    smartOperationCases.map((testCase) => ({
      input: {
        newInformation: testCase.newInformation,
        existingMemories: testCase.existingMemories,
        description: testCase.description,
      },
      expected: testCase.expected,
    })),

  // Task: set up in-memory DB, seed existing memories, call upsert()
  task: async (input) => {
    // Create in-memory swarm mail instance
    const swarmMail = await createInMemorySwarmMail("smart-ops-eval");
    const db = swarmMail.getDrizzle();

    // Create memory adapter with Ollama config
    const adapter = createMemoryAdapter(db, {
      ollamaHost: process.env.OLLAMA_HOST || "http://localhost:11434",
      ollamaModel: process.env.OLLAMA_MODEL || "mxbai-embed-large",
    });

    // Seed existing memories if any
    for (const memory of input.existingMemories) {
      // Store directly without smart ops to seed known state
      await adapter.store(memory.content, {
        collection: memory.collection,
        tags: Array.isArray(memory.metadata.tags)
          ? memory.metadata.tags.join(",")
          : undefined,
        confidence: memory.confidence,
      });
    }

    // Call upsert with smart operations enabled
    const result = await adapter.upsert(input.newInformation, {
      useSmartOps: true,
    });

    // Clean up
    await swarmMail.close();

    // Return result for scoring
    return {
      operation: result.operation,
      reason: result.reason,
      id: result.id,
    };
  },

  // Scorer evaluates decision quality
  scorers: [smartOperationQuality],
});

/**
 * Edge Cases Eval
 *
 * Tests boundary conditions:
 * - Empty existing memories (always ADD)
 * - Multiple similar memories (pick best match)
 * - Ambiguous cases (UPDATE vs NOOP, DELETE vs UPDATE)
 */
evalite("Smart Operations Edge Cases", {
  data: async () => [
    {
      input: {
        newInformation: "New feature: implement dark mode toggle",
        existingMemories: [],
        description: "No existing memories → must ADD",
      },
      expected: { operation: "ADD" },
    },
    {
      input: {
        newInformation: "OAuth tokens should use 5min buffer",
        existingMemories: [
          {
            id: "mem-1",
            content: "OAuth tokens need refresh buffer",
            metadata: { tags: ["auth"] },
            collection: "default",
            createdAt: new Date("2025-12-20T10:00:00Z"),
            confidence: 0.7,
          },
          {
            id: "mem-2",
            content: "Use 5min buffer for token refresh",
            metadata: { tags: ["auth", "oauth"] },
            collection: "default",
            createdAt: new Date("2025-12-20T11:00:00Z"),
            confidence: 0.8,
          },
        ],
        description: "Multiple similar → pick best match for NOOP/UPDATE",
      },
      expected: { operation: "NOOP" }, // or UPDATE if it adds value
    },
  ],

  task: async (input) => {
    const swarmMail = await createInMemorySwarmMail("smart-ops-edge-eval");
    const db = swarmMail.getDrizzle();

    const adapter = createMemoryAdapter(db, {
      ollamaHost: process.env.OLLAMA_HOST || "http://localhost:11434",
      ollamaModel: process.env.OLLAMA_MODEL || "mxbai-embed-large",
    });

    // Seed existing memories
    for (const memory of input.existingMemories) {
      await adapter.store(memory.content, {
        collection: memory.collection,
        tags: Array.isArray(memory.metadata.tags)
          ? memory.metadata.tags.join(",")
          : undefined,
        confidence: memory.confidence,
      });
    }

    const result = await adapter.upsert(input.newInformation, {
      useSmartOps: true,
    });

    await swarmMail.close();

    return {
      operation: result.operation,
      reason: result.reason,
      id: result.id,
    };
  },

  scorers: [smartOperationQuality],
});
