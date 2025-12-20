/**
 * Semantic Memory Plugin Tools - Embedded implementation
 *
 * Provides semantic memory operations using swarm-mail's MemoryStore + Ollama.
 * Replaces external MCP-based semantic-memory calls with embedded storage.
 *
 * Key features:
 * - Vector similarity search with Ollama embeddings
 * - Full-text search fallback
 * - Memory decay tracking (TODO: implement in MemoryStore)
 * - Collection-based organization
 *
 * Tool signatures maintained for backward compatibility with existing prompts.
 */

import { tool } from "@opencode-ai/plugin";
import { getSwarmMailLibSQL } from "swarm-mail";
import {
	createMemoryAdapter,
	type MemoryAdapter,
	type StoreArgs,
	type FindArgs,
	type IdArgs,
	type ListArgs,
	type StoreResult,
	type FindResult,
	type StatsResult,
	type HealthResult,
	type OperationResult,
} from "./memory";

// Re-export types for external use
export type {
	MemoryAdapter,
	StoreArgs,
	FindArgs,
	IdArgs,
	ListArgs,
	StoreResult,
	FindResult,
	StatsResult,
	HealthResult,
	OperationResult,
};

// ============================================================================
// Types
// ============================================================================

/** Tool execution context from OpenCode plugin */
interface ToolContext {
	sessionID: string;
}

// ============================================================================
// Memory Adapter Cache
// ============================================================================

let cachedAdapter: MemoryAdapter | null = null;
let cachedProjectPath: string | null = null;

/**
 * Get or create memory adapter for the current project
 *
 * @param projectPath - Project path (uses CWD if not provided)
 * @returns Memory adapter instance
 */
async function getMemoryAdapter(
	projectPath?: string,
): Promise<MemoryAdapter> {
	const path = projectPath || process.cwd();

	// Return cached adapter if same project
	if (cachedAdapter && cachedProjectPath === path) {
		return cachedAdapter;
	}

	// Create new adapter
	const swarmMail = await getSwarmMailLibSQL(path);
	const dbAdapter = await swarmMail.getDatabase();
	
	// createMemoryAdapter now accepts DatabaseAdapter directly and converts internally
	cachedAdapter = await createMemoryAdapter(dbAdapter);
	cachedProjectPath = path;

	return cachedAdapter;
}

/**
 * Reset adapter cache (for testing)
 */
export function resetMemoryCache(): void {
	cachedAdapter = null;
	cachedProjectPath = null;
}

// Re-export createMemoryAdapter for external use
export { createMemoryAdapter };

// ============================================================================
// Plugin Tools
// ============================================================================

/**
 * Store a memory with semantic embedding
 */
export const semantic_memory_store = tool({
	description:
		"Store a memory with semantic embedding. Memories are searchable by semantic similarity and can be organized into collections. Confidence affects decay rate: high confidence (1.0) = 135 day half-life, low confidence (0.0) = 45 day half-life.",
	args: {
		information: tool.schema
			.string()
			.describe("The information to store (required)"),
		collection: tool.schema
			.string()
			.optional()
			.describe("Collection name (defaults to 'default')"),
		tags: tool.schema
			.string()
			.optional()
			.describe("Comma-separated tags (e.g., 'auth,tokens,oauth')"),
		metadata: tool.schema
			.string()
			.optional()
			.describe("JSON string with additional metadata"),
		confidence: tool.schema
			.number()
			.optional()
			.describe("Confidence level (0.0-1.0) affecting decay rate. Higher = slower decay. Default 0.7"),
	},
	async execute(args, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const result = await adapter.store(args);
		return JSON.stringify(result, null, 2);
	},
});

/**
 * Find memories by semantic similarity or full-text search
 */
export const semantic_memory_find = tool({
	description:
		"Search memories by semantic similarity (vector search) or full-text search. Returns results ranked by relevance score.",
	args: {
		query: tool.schema.string().describe("Search query (required)"),
		limit: tool.schema
			.number()
			.optional()
			.describe("Maximum number of results (default: 10)"),
		collection: tool.schema
			.string()
			.optional()
			.describe("Filter by collection name"),
		expand: tool.schema
			.boolean()
			.optional()
			.describe("Return full content instead of truncated preview (default: false)"),
		fts: tool.schema
			.boolean()
			.optional()
			.describe("Use full-text search instead of vector search (default: false)"),
	},
	async execute(args, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const result = await adapter.find(args);
		return JSON.stringify(result, null, 2);
	},
});

/**
 * Get a single memory by ID
 */
export const semantic_memory_get = tool({
	description: "Retrieve a specific memory by its ID.",
	args: {
		id: tool.schema.string().describe("Memory ID (required)"),
	},
	async execute(args, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const memory = await adapter.get(args);
		return memory ? JSON.stringify(memory, null, 2) : "Memory not found";
	},
});

/**
 * Remove a memory
 */
export const semantic_memory_remove = tool({
	description: "Delete a memory by ID. Use this to remove outdated or incorrect memories.",
	args: {
		id: tool.schema.string().describe("Memory ID (required)"),
	},
	async execute(args, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const result = await adapter.remove(args);
		return JSON.stringify(result, null, 2);
	},
});

/**
 * Validate a memory (reset decay timer)
 */
export const semantic_memory_validate = tool({
	description:
		"Validate that a memory is still accurate and reset its decay timer. Use when you confirm a memory is correct.",
	args: {
		id: tool.schema.string().describe("Memory ID (required)"),
	},
	async execute(args, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const result = await adapter.validate(args);
		return JSON.stringify(result, null, 2);
	},
});

/**
 * List memories
 */
export const semantic_memory_list = tool({
	description: "List all stored memories, optionally filtered by collection.",
	args: {
		collection: tool.schema
			.string()
			.optional()
			.describe("Filter by collection name"),
	},
	async execute(args, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const memories = await adapter.list(args);
		return JSON.stringify(memories, null, 2);
	},
});

/**
 * Get memory statistics
 */
export const semantic_memory_stats = tool({
	description: "Get statistics about stored memories and embeddings.",
	args: {},
	async execute(args, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const stats = await adapter.stats();
		return JSON.stringify(stats, null, 2);
	},
});

/**
 * Check Ollama health
 */
export const semantic_memory_check = tool({
	description:
		"Check if Ollama is running and available for embedding generation.",
	args: {},
	async execute(args, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const health = await adapter.checkHealth();
		return JSON.stringify(health, null, 2);
	},
});

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * All semantic memory tools
 *
 * Register these in the plugin with spread operator: { ...memoryTools }
 */
export const memoryTools = {
	"semantic-memory_store": semantic_memory_store,
	"semantic-memory_find": semantic_memory_find,
	"semantic-memory_get": semantic_memory_get,
	"semantic-memory_remove": semantic_memory_remove,
	"semantic-memory_validate": semantic_memory_validate,
	"semantic-memory_list": semantic_memory_list,
	"semantic-memory_stats": semantic_memory_stats,
	"semantic-memory_check": semantic_memory_check,
} as const;
