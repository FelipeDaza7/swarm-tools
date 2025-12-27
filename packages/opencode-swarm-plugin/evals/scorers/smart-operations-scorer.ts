/**
 * Smart Operations Scorer
 *
 * LLM-as-judge scorer for evaluating memory operation decisions (ADD/UPDATE/DELETE/NOOP).
 *
 * Evaluates:
 * - Correctness of operation choice (did LLM pick the right action?)
 * - Reasoning quality (is the justification sound?)
 * - Edge case handling (handles exact matches, contradictions, etc.)
 * - Consistency (similar inputs produce similar decisions)
 *
 * Uses claude-haiku-4-5 (fast, cheap, good at classification).
 */

import { createScorer } from "evalite";
import { generateText } from "ai";
import type { GatewayModelId } from "ai";

const JUDGE_MODEL: GatewayModelId = "anthropic/claude-haiku-4-5";

/**
 * Scorer for memory operation decision quality
 *
 * Evaluates whether the LLM made the correct ADD/UPDATE/DELETE/NOOP decision
 * given the new information and existing memories.
 *
 * @param output - The actual operation decision from upsert() { operation, reason, id }
 * @param expected - Expected operation type { operation, targetId? }
 * @param input - Original test case { newInformation, existingMemories, description }
 * @returns Score 0-1 with issues/strengths
 */
export const smartOperationQuality = createScorer({
  name: "Smart Operation Quality (LLM Judge)",
  description: "Evaluates memory operation decision correctness and reasoning",
  scorer: async ({ output, expected, input }) => {
    try {
      // Parse output (might be JSON string or object)
      const decision =
        typeof output === "string" ? JSON.parse(output) : output;

      // Extract expected operation from test case
      const expectedOp =
        typeof expected === "object" && expected !== null && "operation" in expected
          ? expected.operation
          : "UNKNOWN";

      // Extract input context
      const inputData =
        typeof input === "object" && input !== null
          ? input
          : { newInformation: "Unknown", existingMemories: [], description: "Unknown" };

      // Build context for judge
      const existingContext =
        Array.isArray(inputData.existingMemories) && inputData.existingMemories.length > 0
          ? inputData.existingMemories
              .map((m: any, i: number) => `[${i + 1}] ID: ${m.id}\n    Content: ${m.content}`)
              .join("\n")
          : "No existing memories.";

      const { text } = await generateText({
        model: JUDGE_MODEL,
        prompt: `You are evaluating a memory operation decision. The system must decide whether to ADD, UPDATE, DELETE, or NOOP when new information arrives.

TEST CASE:
Description: ${inputData.description || "Unknown"}

NEW INFORMATION:
${inputData.newInformation || "Unknown"}

EXISTING MEMORIES:
${existingContext}

EXPECTED OPERATION:
${expectedOp}

ACTUAL DECISION:
Operation: ${decision.operation || "UNKNOWN"}
Reason: ${decision.reason || "No reason provided"}
Target ID: ${decision.id || "N/A"}

Evaluate on these criteria (be harsh - wrong decisions corrupt the memory graph):

1. CORRECTNESS (40%): Did the system choose the right operation?
   - NOOP: Use for exact/semantic matches (already captured)
   - UPDATE: Use for refinements/additions to existing memory
   - DELETE: Use for contradictions/invalidations
   - ADD: Use for genuinely new information
   
2. REASONING (30%): Is the justification sound?
   - Does the reason align with the decision?
   - Is it specific (not generic)?
   - Does it reference the relevant existing memory (if applicable)?

3. EDGE CASES (20%): Does it handle nuance?
   - Exact match → NOOP (not UPDATE)
   - Similar but adds value → UPDATE (not NOOP)
   - Contradiction → DELETE (not UPDATE)
   - Related but distinct → ADD (not UPDATE)

4. CONSISTENCY (10%): Is the decision predictable?
   - Would similar inputs produce similar decisions?
   - No arbitrary choices?

Return ONLY valid JSON (no markdown, no explanation):
{"score": <0-100>, "issues": ["issue1", "issue2"], "strengths": ["strength1"]}`,
        maxOutputTokens: 512,
      });

      // Parse JSON response - handle potential markdown wrapping
      let jsonText = text.trim();
      if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/```json?\n?/g, "").replace(/```$/g, "");
      }

      const result = JSON.parse(jsonText) as {
        score: number;
        issues: string[];
        strengths?: string[];
      };

      const issueText =
        result.issues.length > 0 ? result.issues.join("; ") : "No issues";
      const strengthText =
        result.strengths && result.strengths.length > 0
          ? ` | Strengths: ${result.strengths.join("; ")}`
          : "";

      return {
        score: result.score / 100,
        message: `${issueText}${strengthText}`,
      };
    } catch (error) {
      // Graceful degradation: return neutral score if judge fails
      return {
        score: 0.5,
        message: `LLM judge error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
