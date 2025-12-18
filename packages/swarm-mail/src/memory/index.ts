/**
 * Memory Module - Semantic memory with vector embeddings
 *
 * Provides Ollama-based embedding generation and memory storage.
 */

// High-level adapter (primary API)
export {
	createMemoryAdapter,
	type FindOptions,
	type HealthStatus,
	type Memory,
	type MemoryConfig,
	type SearchResult,
	type StoreOptions,
} from "./adapter.js";

// Low-level services (advanced usage)
export {
	getDefaultConfig,
	makeOllamaLive,
	Ollama,
	OllamaError,
} from "./ollama.js";

export { createMemoryStore, EMBEDDING_DIM } from "./store.js";

// Migrations
export { memoryMigration, memoryMigrations } from "./migrations.js";
