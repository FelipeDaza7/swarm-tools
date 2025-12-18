/**
 * Memory Module - Semantic Memory Adapter
 *
 * Provides a high-level adapter around swarm-mail's MemoryStore + Ollama.
 * Used by semantic-memory_* tools in the plugin.
 *
 * ## Design
 * - Wraps MemoryStore (vector storage) + Ollama (embeddings)
 * - Handles ID generation, metadata parsing, error handling
 * - Tool-friendly API (string inputs/outputs, no Effect-TS in signatures)
 *
 * ## Usage
 * ```typescript
 * const adapter = await createMemoryAdapter(swarmMail.db);
 *
 * // Store memory
 * const { id } = await adapter.store({
 *   information: "OAuth tokens need 5min buffer",
 *   tags: "auth,tokens",
 * });
 *
 * // Search memories
 * const results = await adapter.find({
 *   query: "token refresh",
 *   limit: 5,
 * });
 * ```
 */

import { Effect } from "effect";
import {
	type DatabaseAdapter,
	createMemoryStore,
	getDefaultConfig,
	makeOllamaLive,
	Ollama,
	type Memory,
	type SearchResult,
} from "swarm-mail";

// ============================================================================
// Types
// ============================================================================

/** Arguments for store operation */
export interface StoreArgs {
	readonly information: string;
	readonly collection?: string;
	readonly tags?: string;
	readonly metadata?: string;
}

/** Arguments for find operation */
export interface FindArgs {
	readonly query: string;
	readonly limit?: number;
	readonly collection?: string;
	readonly expand?: boolean;
	readonly fts?: boolean;
}

/** Arguments for get/remove/validate operations */
export interface IdArgs {
	readonly id: string;
}

/** Arguments for list operation */
export interface ListArgs {
	readonly collection?: string;
}

/** Result from store operation */
export interface StoreResult {
	readonly id: string;
	readonly message: string;
}

/** Result from find operation */
export interface FindResult {
	readonly results: Array<{
		readonly id: string;
		readonly content: string;
		readonly score: number;
		readonly collection: string;
		readonly metadata: Record<string, unknown>;
		readonly createdAt: string;
	}>;
	readonly count: number;
}

/** Result from stats operation */
export interface StatsResult {
	readonly memories: number;
	readonly embeddings: number;
}

/** Result from health check */
export interface HealthResult {
	readonly ollama: boolean;
	readonly message?: string;
}

/** Result from validate/remove operations */
export interface OperationResult {
	readonly success: boolean;
	readonly message?: string;
}

// ============================================================================
// Memory Adapter
// ============================================================================

/**
 * Memory Adapter Interface
 *
 * High-level API for semantic memory operations.
 */
export interface MemoryAdapter {
	readonly store: (args: StoreArgs) => Promise<StoreResult>;
	readonly find: (args: FindArgs) => Promise<FindResult>;
	readonly get: (args: IdArgs) => Promise<Memory | null>;
	readonly remove: (args: IdArgs) => Promise<OperationResult>;
	readonly validate: (args: IdArgs) => Promise<OperationResult>;
	readonly list: (args: ListArgs) => Promise<Memory[]>;
	readonly stats: () => Promise<StatsResult>;
	readonly checkHealth: () => Promise<HealthResult>;
}

/**
 * Create Memory Adapter
 *
 * @param db - DatabaseAdapter (from SwarmMail)
 * @returns Memory adapter with high-level operations
 *
 * @example
 * ```typescript
 * import { getSwarmMail } from 'swarm-mail';
 * import { createMemoryAdapter } from './memory';
 *
 * const swarmMail = await getSwarmMail('/path/to/project');
 * const adapter = await createMemoryAdapter(swarmMail.db);
 *
 * await adapter.store({ information: "Learning X" });
 * const results = await adapter.find({ query: "X" });
 * ```
 */
export async function createMemoryAdapter(
	db: DatabaseAdapter,
): Promise<MemoryAdapter> {
	const store = createMemoryStore(db);
	const config = getDefaultConfig();
	const ollamaLayer = makeOllamaLive(config);

	/**
	 * Generate unique memory ID
	 */
	const generateId = (): string => {
		const timestamp = Date.now().toString(36);
		const random = Math.random().toString(36).substring(2, 9);
		return `mem_${timestamp}_${random}`;
	};

	/**
	 * Parse tags string to metadata object
	 */
	const parseTags = (tags?: string): string[] => {
		if (!tags) return [];
		return tags
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
	};

	/**
	 * Truncate content for preview
	 */
	const truncateContent = (content: string, maxLength = 200): string => {
		if (content.length <= maxLength) return content;
		return `${content.substring(0, maxLength)}...`;
	};

	return {
		/**
		 * Store a memory with embedding
		 */
		async store(args: StoreArgs): Promise<StoreResult> {
			const id = generateId();
			const tags = parseTags(args.tags);
			const collection = args.collection ?? "default";

			// Parse metadata if provided
			let metadata: Record<string, unknown> = {};
			if (args.metadata) {
				try {
					metadata = JSON.parse(args.metadata);
				} catch {
					metadata = { raw: args.metadata };
				}
			}

			// Add tags to metadata
			if (tags.length > 0) {
				metadata.tags = tags;
			}

			const memory: Memory = {
				id,
				content: args.information,
				metadata,
				collection,
				createdAt: new Date(),
			};

			// Generate embedding
			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				return yield* ollama.embed(args.information);
			});

			const embedding = await Effect.runPromise(
				program.pipe(Effect.provide(ollamaLayer)),
			);

			// Store memory
			await store.store(memory, embedding);

			return {
				id,
				message: `Stored memory ${id} in collection: ${collection}`,
			};
		},

		/**
		 * Find memories by semantic similarity or full-text search
		 */
		async find(args: FindArgs): Promise<FindResult> {
			const limit = args.limit ?? 10;

			let results: SearchResult[];

			if (args.fts) {
				// Full-text search
				results = await store.ftsSearch(args.query, {
					limit,
					collection: args.collection,
				});
			} else {
				// Vector search - generate query embedding
				const program = Effect.gen(function* () {
					const ollama = yield* Ollama;
					return yield* ollama.embed(args.query);
				});

				const queryEmbedding = await Effect.runPromise(
					program.pipe(Effect.provide(ollamaLayer)),
				);

				results = await store.search(queryEmbedding, {
					limit,
					threshold: 0.3,
					collection: args.collection,
				});
			}

			return {
				results: results.map((r) => ({
					id: r.memory.id,
					content: args.expand
						? r.memory.content
						: truncateContent(r.memory.content),
					score: r.score,
					collection: r.memory.collection,
					metadata: r.memory.metadata,
					createdAt: r.memory.createdAt.toISOString(),
				})),
				count: results.length,
			};
		},

		/**
		 * Get a single memory by ID
		 */
		async get(args: IdArgs): Promise<Memory | null> {
			return store.get(args.id);
		},

		/**
		 * Remove a memory
		 */
		async remove(args: IdArgs): Promise<OperationResult> {
			await store.delete(args.id);
			return {
				success: true,
				message: `Removed memory ${args.id}`,
			};
		},

		/**
		 * Validate a memory (reset decay timer)
		 *
		 * TODO: Implement decay tracking in MemoryStore
		 * For now, this is a no-op placeholder.
		 */
		async validate(args: IdArgs): Promise<OperationResult> {
			const memory = await store.get(args.id);
			if (!memory) {
				return {
					success: false,
					message: `Memory ${args.id} not found`,
				};
			}

			// TODO: Implement decay reset in MemoryStore
			// For now, just verify it exists
			return {
				success: true,
				message: `Memory ${args.id} validated`,
			};
		},

		/**
		 * List memories
		 */
		async list(args: ListArgs): Promise<Memory[]> {
			return store.list(args.collection);
		},

		/**
		 * Get statistics
		 */
		async stats(): Promise<StatsResult> {
			return store.getStats();
		},

		/**
		 * Check Ollama health
		 */
		async checkHealth(): Promise<HealthResult> {
			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				return yield* ollama.checkHealth();
			});

			try {
				await Effect.runPromise(program.pipe(Effect.provide(ollamaLayer)));
				return { ollama: true };
			} catch (error) {
				return {
					ollama: false,
					message:
						error instanceof Error ? error.message : "Ollama not available",
				};
			}
		},
	};
}
