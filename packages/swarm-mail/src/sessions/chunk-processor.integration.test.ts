/**
 * Chunk Processor Integration Tests
 *
 * Tests integration with real Ollama service (requires Ollama running locally).
 * These tests are skipped by default - run with INTEGRATION=true to enable.
 */

import { describe, expect, test } from "vitest";
import { Effect } from "effect";
import { ChunkProcessor, type NormalizedMessage } from "./chunk-processor";
import { makeOllamaLive, getDefaultConfig } from "../memory/ollama";

const SKIP_INTEGRATION = !process.env.INTEGRATION;

describe.skipIf(SKIP_INTEGRATION)(
	"ChunkProcessor - Ollama Integration (INTEGRATION=true to run)",
	() => {
		test("embeds chunks with real Ollama service", async () => {
			const messages: NormalizedMessage[] = [
				{
					session_id: "ses_integration",
					agent_type: "opencode-swarm",
					message_idx: 0,
					timestamp: "2025-12-26T10:00:00Z",
					role: "user",
					content: "How do I implement authentication in Next.js?",
				},
				{
					session_id: "ses_integration",
					agent_type: "opencode-swarm",
					message_idx: 1,
					timestamp: "2025-12-26T10:01:00Z",
					role: "assistant",
					content:
						"Use NextAuth.js for authentication. Configure providers in api/auth/[...nextauth].ts",
				},
			];

			const processor = new ChunkProcessor();
			const chunks = processor.chunk(messages);

			// Real Ollama layer
			const ollamaConfig = getDefaultConfig();
			const ollamaLayer = makeOllamaLive(ollamaConfig);

			const embedded = await Effect.runPromise(
				processor.embed(chunks).pipe(Effect.provide(ollamaLayer)),
			);

			// Verify real embeddings
			expect(embedded).toHaveLength(2);
			expect(embedded[0].embedding).toHaveLength(1024); // mxbai-embed-large dims
			expect(embedded[1].embedding).toHaveLength(1024);

			// Embeddings should be non-zero floats
			expect(embedded[0].embedding![0]).not.toBe(0);
			expect(embedded[1].embedding![0]).not.toBe(0);

			// Different messages should have different embeddings
			const similarity = cosineSimilarity(
				embedded[0].embedding!,
				embedded[1].embedding!,
			);
			expect(similarity).toBeLessThan(1.0); // Not identical
			expect(similarity).toBeGreaterThan(0.3); // But related (both about auth)
		}, 10000); // 10s timeout for real Ollama call

		test("handles graceful degradation when Ollama is down", async () => {
			const messages: NormalizedMessage[] = [
				{
					session_id: "ses_fail",
					agent_type: "opencode-swarm",
					message_idx: 0,
					timestamp: "2025-12-26T10:00:00Z",
					role: "user",
					content: "Test message",
				},
			];

			const processor = new ChunkProcessor();
			const chunks = processor.chunk(messages);

			// Point to non-existent Ollama host
			const failingOllamaLayer = makeOllamaLive({
				ollamaHost: "http://localhost:99999", // Invalid port
				ollamaModel: "mxbai-embed-large",
			});

			const embedded = await Effect.runPromise(
				processor.embed(chunks).pipe(Effect.provide(failingOllamaLayer)),
			);

			// Should still return chunks with null embeddings (FTS5 fallback mode)
			expect(embedded).toHaveLength(1);
			expect(embedded[0].embedding).toBeNull();
			expect(embedded[0].content).toBe("Test message");
		}, 5000);
	},
);

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) throw new Error("Vectors must have same length");

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
