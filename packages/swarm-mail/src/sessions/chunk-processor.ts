/**
 * Chunk Processor
 *
 * Splits sessions into message-level chunks and embeds them with Ollama.
 *
 * @module sessions/chunk-processor
 *
 * @example
 * ```typescript
 * import { ChunkProcessor } from './sessions/chunk-processor';
 * import { makeOllamaLive } from './memory/ollama';
 * import { Effect } from 'effect';
 *
 * const processor = new ChunkProcessor();
 *
 * // Chunk messages (1:1 for Phase 1)
 * const chunks = processor.chunk(messages);
 *
 * // Embed with Ollama
 * const ollamaLayer = makeOllamaLive({
 *   ollamaHost: 'http://localhost:11434',
 *   ollamaModel: 'mxbai-embed-large'
 * });
 *
 * const embedded = await Effect.runPromise(
 *   processor.embed(chunks).pipe(Effect.provide(ollamaLayer))
 * );
 * ```
 */

import { Effect } from "effect";
import { Ollama } from "../memory/ollama";

/**
 * Normalized message from session parser
 */
export interface NormalizedMessage {
	session_id: string;
	agent_type: string;
	message_idx: number;
	timestamp: string;
	role: "user" | "assistant" | "system";
	content: string;
	metadata?: Record<string, unknown>;
}

/**
 * Message chunk (1:1 with messages in Phase 1)
 */
export interface MessageChunk {
	session_id: string;
	agent_type: string;
	message_idx: number;
	timestamp: string;
	role: "user" | "assistant" | "system";
	content: string;
	metadata?: Record<string, unknown>;
}

/**
 * Chunk with embedding vector
 */
export interface EmbeddedChunk extends MessageChunk {
	embedding: number[] | null;
}

/**
 * Chunk processor for message-level chunking and embedding.
 *
 * Strategy (Phase 1):
 * - 1 chunk = 1 message (no further splitting)
 * - Batch embedding with Ollama (concurrency controlled by Ollama service)
 * - Graceful degradation: returns null embeddings if Ollama fails
 *
 * Future (Phase 2):
 * - Split long messages at sentence boundaries if >2000 tokens
 * - Sliding window for context preservation
 */
export class ChunkProcessor {
	/**
	 * Chunk messages into searchable units.
	 *
	 * Phase 1: 1:1 mapping (no splitting).
	 *
	 * @param messages - Normalized messages from session parser
	 * @returns Message chunks
	 */
	chunk(messages: NormalizedMessage[]): MessageChunk[] {
		// Phase 1: 1:1 mapping - each message becomes a chunk
		return messages.map((msg) => ({ ...msg }));
	}

	/**
	 * Embed chunks with Ollama.
	 *
	 * Uses batch embedding for efficiency (controlled concurrency via Ollama service).
	 * Gracefully handles Ollama failures by returning null embeddings.
	 *
	 * @param chunks - Message chunks to embed
	 * @returns Effect that produces embedded chunks
	 */
	embed(chunks: MessageChunk[]): Effect.Effect<EmbeddedChunk[], never, Ollama> {
		return Effect.gen(function* () {
			const ollama = yield* Ollama;

			// Extract content for batch embedding
			const texts = chunks.map((chunk) => chunk.content);

			// Attempt batch embedding with graceful degradation
			const embeddings = yield* ollama.embedBatch(texts).pipe(
				// Graceful degradation: return null embeddings on failure
				Effect.catchAll(() => Effect.succeed(texts.map(() => null))),
			);

			// Combine chunks with their embeddings
			return chunks.map((chunk, i) => ({
				...chunk,
				embedding: embeddings[i],
			}));
		});
	}

	/**
	 * Embed a single query string.
	 *
	 * Used for search queries.
	 *
	 * @param query - Query text to embed
	 * @returns Effect that produces embedding vector
	 */
	embedQuery(query: string): Effect.Effect<number[], never, Ollama> {
		return Effect.gen(function* () {
			const ollama = yield* Ollama;
			const embedding = yield* ollama.embed(query).pipe(
				// Graceful degradation: return empty vector on failure
				Effect.catchAll(() => Effect.succeed([])),
			);
			return embedding;
		});
	}
}
