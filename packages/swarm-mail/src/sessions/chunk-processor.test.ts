/**
 * Chunk Processor Tests
 *
 * TDD cycle for message-level chunking and embedding with Ollama.
 * Strategy: 1 chunk = 1 message (no further splitting for Phase 1).
 */

import { describe, expect, test, vi } from "vitest";
import { Effect, Layer } from "effect";
import { Ollama, type MemoryConfig, OllamaError } from "../memory/ollama";
import {
	ChunkProcessor,
	type NormalizedMessage,
	type MessageChunk,
	type EmbeddedChunk,
} from "./chunk-processor";

describe("ChunkProcessor - Message Chunking", () => {
	test("creates one chunk per message (1:1 mapping)", () => {
		const messages: NormalizedMessage[] = [
			{
				session_id: "ses_123",
				agent_type: "opencode-swarm",
				message_idx: 0,
				timestamp: "2025-12-26T10:00:00Z",
				role: "user",
				content: "Hello world",
			},
			{
				session_id: "ses_123",
				agent_type: "opencode-swarm",
				message_idx: 1,
				timestamp: "2025-12-26T10:01:00Z",
				role: "assistant",
				content: "Hi there",
			},
		];

		const processor = new ChunkProcessor();
		const chunks = processor.chunk(messages);

		expect(chunks).toHaveLength(2);
		expect(chunks[0]).toEqual({
			session_id: "ses_123",
			agent_type: "opencode-swarm",
			message_idx: 0,
			timestamp: "2025-12-26T10:00:00Z",
			role: "user",
			content: "Hello world",
		});
		expect(chunks[1].content).toBe("Hi there");
	});

	test("preserves all message metadata in chunks", () => {
		const messages: NormalizedMessage[] = [
			{
				session_id: "ses_456",
				agent_type: "cursor",
				message_idx: 5,
				timestamp: "2025-12-26T11:00:00Z",
				role: "system",
				content: "System message",
				metadata: { event_type: "DECISION", custom_field: "value" },
			},
		];

		const processor = new ChunkProcessor();
		const chunks = processor.chunk(messages);

		expect(chunks[0].metadata).toEqual({
			event_type: "DECISION",
			custom_field: "value",
		});
	});

	test("handles empty messages array", () => {
		const processor = new ChunkProcessor();
		const chunks = processor.chunk([]);
		expect(chunks).toEqual([]);
	});
});

describe("ChunkProcessor - Ollama Embedding Integration", () => {
	test("embeds chunks with Ollama service", async () => {
		const chunks: MessageChunk[] = [
			{
				session_id: "ses_123",
				agent_type: "opencode-swarm",
				message_idx: 0,
				timestamp: "2025-12-26T10:00:00Z",
				role: "user",
				content: "Test message",
			},
		];

		// Mock Ollama layer
		const mockOllamaLayer = Layer.succeed(Ollama, {
			embed: () => Effect.succeed(new Array(1024).fill(0.5)),
			embedBatch: (texts: string[]) =>
				Effect.succeed(texts.map(() => new Array(1024).fill(0.5))),
			checkHealth: () => Effect.succeed(undefined),
		});

		const processor = new ChunkProcessor();
		const embedded = await Effect.runPromise(
			processor.embed(chunks).pipe(Effect.provide(mockOllamaLayer)),
		);

		expect(embedded).toHaveLength(1);
		expect(embedded[0].embedding).toHaveLength(1024);
		expect(embedded[0].embedding).toEqual(new Array(1024).fill(0.5));
	});

	test("processes multiple chunks in batch", async () => {
		const chunks: MessageChunk[] = [
			{
				session_id: "ses_123",
				agent_type: "opencode-swarm",
				message_idx: 0,
				timestamp: "2025-12-26T10:00:00Z",
				role: "user",
				content: "First",
			},
			{
				session_id: "ses_123",
				agent_type: "opencode-swarm",
				message_idx: 1,
				timestamp: "2025-12-26T10:01:00Z",
				role: "assistant",
				content: "Second",
			},
			{
				session_id: "ses_123",
				agent_type: "opencode-swarm",
				message_idx: 2,
				timestamp: "2025-12-26T10:02:00Z",
				role: "user",
				content: "Third",
			},
		];

		const mockOllamaLayer = Layer.succeed(Ollama, {
			embedBatch: (texts: string[]) =>
				Effect.succeed(texts.map(() => new Array(1024).fill(0.7))),
			embed: () => Effect.succeed(new Array(1024).fill(0.7)),
			checkHealth: () => Effect.succeed(undefined),
		});

		const processor = new ChunkProcessor();
		const embedded = await Effect.runPromise(
			processor.embed(chunks).pipe(Effect.provide(mockOllamaLayer)),
		);

		expect(embedded).toHaveLength(3);
		expect(embedded[0].embedding).toHaveLength(1024);
		expect(embedded[2].embedding).toHaveLength(1024);
	});

	test("gracefully handles Ollama failure (FTS5 fallback)", async () => {
		const chunks: MessageChunk[] = [
			{
				session_id: "ses_123",
				agent_type: "opencode-swarm",
				message_idx: 0,
				timestamp: "2025-12-26T10:00:00Z",
				role: "user",
				content: "Test",
			},
		];

		// Mock failing Ollama
		const failingOllamaLayer = Layer.succeed(Ollama, {
			embedBatch: () =>
				Effect.fail(new OllamaError({ reason: "Connection failed" })),
			embed: () => Effect.fail(new OllamaError({ reason: "Connection failed" })),
			checkHealth: () =>
				Effect.fail(new OllamaError({ reason: "Not running" })),
		});

		// Should NOT throw - graceful degradation returns null embeddings
		const processor = new ChunkProcessor();
		const embedded = await Effect.runPromise(
			processor.embed(chunks).pipe(Effect.provide(failingOllamaLayer)),
		);

		expect(embedded).toHaveLength(1);
		expect(embedded[0].embedding).toBeNull();
		expect(embedded[0].content).toBe("Test"); // Chunk data preserved
	});
});
