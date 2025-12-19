/**
 * SwarmMailAdapter - High-level interface for swarm-mail operations
 *
 * This interface abstracts all swarm-mail operations (events, messaging,
 * reservations, locks) to enable different storage backends.
 *
 * ## Design Goals
 * - Database-agnostic (works with PGLite, SQLite, PostgreSQL, etc.)
 * - Matches existing swarm-mail API surface
 * - No implementation details leak through interface
 *
 * ## Layering
 * - DatabaseAdapter: Low-level SQL execution
 * - SwarmMailAdapter: High-level swarm-mail operations (uses DatabaseAdapter internally)
 * - Plugin tools: Type-safe Zod-validated wrappers (use SwarmMailAdapter)
 */

import type {
	AgentEvent,
	AgentRegisteredEvent,
	FileReservedEvent,
	MessageSentEvent,
} from "../streams/events";
import type { DatabaseAdapter } from "./database";

// ============================================================================
// Event Store Operations
// ============================================================================

export interface ReadEventsOptions {
	projectKey?: string;
	types?: AgentEvent["type"][];
	since?: number; // timestamp
	until?: number; // timestamp
	afterSequence?: number;
	limit?: number;
	offset?: number;
}

export interface EventStoreAdapter {
	/**
	 * Append a single event to the log
	 *
	 * Updates materialized views automatically.
	 */
	appendEvent(
		event: AgentEvent,
		projectPath?: string,
	): Promise<AgentEvent & { id: number; sequence: number }>;

	/**
	 * Append multiple events in a transaction
	 *
	 * Atomic - all events succeed or all fail.
	 */
	appendEvents(
		events: AgentEvent[],
		projectPath?: string,
	): Promise<Array<AgentEvent & { id: number; sequence: number }>>;

	/**
	 * Read events with filters
	 */
	readEvents(
		options?: ReadEventsOptions,
		projectPath?: string,
	): Promise<Array<AgentEvent & { id: number; sequence: number }>>;

	/**
	 * Get the latest sequence number for a project
	 */
	getLatestSequence(projectKey?: string, projectPath?: string): Promise<number>;

	/**
	 * Replay events to rebuild materialized views
	 */
	replayEvents(
		options?: {
			projectKey?: string;
			fromSequence?: number;
			clearViews?: boolean;
		},
		projectPath?: string,
	): Promise<{ eventsReplayed: number; duration: number }>;
}

// ============================================================================
// Agent Operations
// ============================================================================

export interface AgentAdapter {
	/**
	 * Register an agent for a project
	 */
	registerAgent(
		projectKey: string,
		agentName: string,
		options?: {
			program?: string;
			model?: string;
			taskDescription?: string;
		},
		projectPath?: string,
	): Promise<AgentRegisteredEvent & { id: number; sequence: number }>;

	/**
	 * Get all agents for a project
	 */
	getAgents(
		projectKey: string,
		projectPath?: string,
	): Promise<
		Array<{
			id: number;
			name: string;
			program: string;
			model: string;
			task_description: string | null;
			registered_at: number;
			last_active_at: number;
		}>
	>;

	/**
	 * Get a specific agent by name
	 */
	getAgent(
		projectKey: string,
		agentName: string,
		projectPath?: string,
	): Promise<{
		id: number;
		name: string;
		program: string;
		model: string;
		task_description: string | null;
		registered_at: number;
		last_active_at: number;
	} | null>;
}

// ============================================================================
// Messaging Operations
// ============================================================================

export interface InboxOptions {
	limit?: number;
	urgentOnly?: boolean;
	unreadOnly?: boolean;
	includeBodies?: boolean;
	sinceTs?: string;
}

export interface Message {
	id: number;
	from_agent: string;
	subject: string;
	body?: string;
	thread_id: string | null;
	importance: string;
	ack_required: boolean;
	created_at: number;
	read_at?: number | null;
	acked_at?: number | null;
}

export interface MessagingAdapter {
	/**
	 * Send a message to other agents
	 */
	sendMessage(
		projectKey: string,
		fromAgent: string,
		toAgents: string[],
		subject: string,
		body: string,
		options?: {
			threadId?: string;
			importance?: "low" | "normal" | "high" | "urgent";
			ackRequired?: boolean;
		},
		projectPath?: string,
	): Promise<MessageSentEvent & { id: number; sequence: number }>;

	/**
	 * Get inbox messages for an agent
	 */
	getInbox(
		projectKey: string,
		agentName: string,
		options?: InboxOptions,
		projectPath?: string,
	): Promise<Message[]>;

	/**
	 * Get a single message by ID
	 */
	getMessage(
		projectKey: string,
		messageId: number,
		projectPath?: string,
	): Promise<Message | null>;

	/**
	 * Get all messages in a thread
	 */
	getThreadMessages(
		projectKey: string,
		threadId: string,
		projectPath?: string,
	): Promise<Message[]>;

	/**
	 * Mark a message as read
	 */
	markMessageAsRead(
		projectKey: string,
		messageId: number,
		agentName: string,
		projectPath?: string,
	): Promise<void>;

	/**
	 * Acknowledge a message
	 */
	acknowledgeMessage(
		projectKey: string,
		messageId: number,
		agentName: string,
		projectPath?: string,
	): Promise<void>;
}

// ============================================================================
// Reservation Operations
// ============================================================================

export interface Reservation {
	id: number;
	agent_name: string;
	path_pattern: string;
	exclusive: boolean;
	reason: string | null;
	created_at: number;
	expires_at: number;
}

export interface Conflict {
	path: string;
	holder: string;
	pattern: string;
	exclusive: boolean;
}

export interface ReservationAdapter {
	/**
	 * Reserve files for exclusive editing
	 */
	reserveFiles(
		projectKey: string,
		agentName: string,
		paths: string[],
		options?: {
			reason?: string;
			exclusive?: boolean;
			ttlSeconds?: number;
		},
		projectPath?: string,
	): Promise<FileReservedEvent & { id: number; sequence: number }>;

	/**
	 * Release file reservations
	 */
	releaseFiles(
		projectKey: string,
		agentName: string,
		options?: {
			paths?: string[];
			reservationIds?: number[];
		},
		projectPath?: string,
	): Promise<void>;

	/**
	 * Get active reservations for a project
	 */
	getActiveReservations(
		projectKey: string,
		projectPath?: string,
		agentName?: string,
	): Promise<Reservation[]>;

	/**
	 * Check for conflicts with existing reservations
	 */
	checkConflicts(
		projectKey: string,
		agentName: string,
		paths: string[],
		projectPath?: string,
	): Promise<Conflict[]>;
}

// ============================================================================
// Schema and Health Operations
// ============================================================================

export interface SchemaAdapter {
	/**
	 * Run database migrations
	 *
	 * Initializes tables, indexes, and constraints.
	 */
	runMigrations(projectPath?: string): Promise<void>;

	/**
	 * Check if database is healthy
	 *
	 * Returns enhanced health object with connectivity status and optional WAL health.
	 * Supports custom WAL threshold via options.
	 *
	 * @param options - Optional health check options
	 * @param options.walThresholdMb - Custom WAL size warning threshold in MB (default: 100)
	 * @param projectPath - Optional project path
	 * @returns Health status object with connectivity and WAL health
	 *
	 * @example
	 * ```typescript
	 * const health = await adapter.healthCheck({ walThresholdMb: 50 });
	 * if (!health.connected) {
	 *   console.error("Database not connected");
	 * }
	 * if (health.walHealth && !health.walHealth.healthy) {
	 *   console.warn(health.walHealth.message);
	 *   await adapter.checkpoint?.();
	 * }
	 * ```
	 */
	healthCheck(
		options?: { walThresholdMb?: number },
		projectPath?: string,
	): Promise<{
		connected: boolean;
		walHealth?: { healthy: boolean; message: string };
	}>;

	/**
	 * Get database statistics
	 *
	 * Returns counts of events, agents, messages, reservations, and optional WAL stats.
	 *
	 * @param projectPath - Optional project path
	 * @returns Statistics object including WAL size and file count (if available)
	 */
	getDatabaseStats(projectPath?: string): Promise<{
		events: number;
		agents: number;
		messages: number;
		reservations: number;
		wal?: { size: number; fileCount: number };
	}>;

	/**
	 * Reset database for testing
	 *
	 * Clears all data but keeps schema.
	 */
	resetDatabase(projectPath?: string): Promise<void>;
}

// ============================================================================
// Combined SwarmMailAdapter Interface
// ============================================================================

/**
 * SwarmMailAdapter - Complete interface for swarm-mail operations
 *
 * Combines all sub-adapters into a single interface.
 * Implementations provide a DatabaseAdapter and implement all operations.
 */
export interface SwarmMailAdapter
	extends EventStoreAdapter,
		AgentAdapter,
		MessagingAdapter,
		ReservationAdapter,
		SchemaAdapter {
	/**
	 * Get the underlying database adapter
	 */
	getDatabase(projectPath?: string): Promise<DatabaseAdapter>;

	/**
	 * Close the database connection
	 */
	close(projectPath?: string): Promise<void>;

	/**
	 * Close all database connections
	 */
	closeAll(): Promise<void>;
}

// ============================================================================
// Factory Function Type
// ============================================================================

/**
 * SwarmMailAdapterFactory - Function that creates a SwarmMailAdapter instance
 *
 * Adapters export a factory function with this signature.
 *
 * @example
 * ```typescript
 * import { createPGLiteAdapter } from '@opencode/swarm-mail/adapters/pglite';
 * import { createSQLiteAdapter } from '@opencode/swarm-mail/adapters/sqlite';
 *
 * const adapter = createPGLiteAdapter({ path: './streams.db' });
 * const adapter2 = createSQLiteAdapter({ path: './streams.db' });
 * ```
 */
export type SwarmMailAdapterFactory = (config: {
	path?: string;
	timeout?: number;
}) => SwarmMailAdapter;
