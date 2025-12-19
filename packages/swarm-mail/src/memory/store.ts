/**
 * Memory Store - PGlite + pgvector operations
 *
 * Provides CRUD operations and semantic search for memories using
 * an existing shared PGlite instance. Does NOT create its own database.
 *
 * ## Design Pattern
 * - Accept DatabaseAdapter via factory parameter (dependency injection)
 * - Share PGlite instance with other swarm-mail services
 * - Schema migrations handled separately (by migrations task)
 *
 * ## Key Operations
 * - store: Insert or update memory with embedding
 * - search: Vector similarity search with threshold/limit/collection filters
 * - ftsSearch: Full-text search with PostgreSQL FTS
 * - list: List all memories, optionally filtered by collection
 * - get: Retrieve single memory by ID
 * - delete: Remove memory and its embedding
 * - getStats: Memory and embedding counts
 *
 * ## Vector Search Query
 * Uses pgvector's <=> operator for cosine distance, where:
 * - 0 = identical vectors
 * - 2 = opposite vectors
 * - Score = 1 - distance (higher is more similar)
 */

import type { DatabaseAdapter } from "../types/database.js";

// ============================================================================
// Types
// ============================================================================

/** Embedding dimension for mxbai-embed-large */
export const EMBEDDING_DIM = 1024;

/** Memory data structure */
export interface Memory {
  readonly id: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly collection: string;
  readonly createdAt: Date;
  /** Confidence level (0.0-1.0) affecting decay rate. Higher = slower decay. Default 0.7 */
  readonly confidence?: number;
}

/** Search result with similarity score */
export interface SearchResult {
  readonly memory: Memory;
  readonly score: number;
  readonly matchType: "vector" | "fts";
}

/** Search options for queries */
export interface SearchOptions {
  readonly limit?: number;
  readonly threshold?: number;
  readonly collection?: string;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a memory store using a shared DatabaseAdapter
 *
 * @param db - DatabaseAdapter instance (shared PGLite, SQLite, PostgreSQL, etc.)
 * @returns Memory store operations
 *
 * @example
 * ```typescript
 * import { wrapPGlite } from '../pglite.js';
 * import { PGlite } from '@electric-sql/pglite';
 * import { vector } from '@electric-sql/pglite/vector';
 *
 * const pglite = await PGlite.create({ dataDir: './db', extensions: { vector } });
 * const db = wrapPGlite(pglite);
 * const store = createMemoryStore(db);
 *
 * await store.store(memory, embedding);
 * const results = await store.search(queryEmbedding);
 * ```
 */
export function createMemoryStore(db: DatabaseAdapter) {
  /**
   * Helper to parse memory row from database
   */
  const parseMemoryRow = (row: any): Memory => ({
    id: row.id,
    content: row.content,
    metadata: row.metadata ?? {},
    collection: row.collection ?? "default",
    createdAt: new Date(row.created_at),
    confidence: row.confidence ?? 0.7,
  });

  return {
    /**
     * Store a memory with its embedding
     *
     * Uses UPSERT (INSERT ... ON CONFLICT DO UPDATE) to handle both
     * new memories and updates to existing ones atomically.
     *
     * @param memory - Memory to store
     * @param embedding - 1024-dimensional vector
     * @throws Error if database operation fails
     */
    async store(memory: Memory, embedding: number[]): Promise<void> {
      await db.exec("BEGIN");
      try {
        // Insert or update memory
        await db.query(
          `INSERT INTO memories (id, content, metadata, collection, created_at, confidence)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
             content = EXCLUDED.content,
             metadata = EXCLUDED.metadata,
             collection = EXCLUDED.collection,
             confidence = EXCLUDED.confidence`,
          [
            memory.id,
            memory.content,
            JSON.stringify(memory.metadata),
            memory.collection,
            memory.createdAt.toISOString(),
            memory.confidence ?? 0.7,
          ]
        );

        // Insert or update embedding
        const vectorStr = `[${embedding.join(",")}]`;
        await db.query(
          `INSERT INTO memory_embeddings (memory_id, embedding)
           VALUES ($1, $2::vector)
           ON CONFLICT (memory_id) DO UPDATE SET
             embedding = EXCLUDED.embedding`,
          [memory.id, vectorStr]
        );

        await db.exec("COMMIT");
      } catch (error) {
        await db.exec("ROLLBACK");
        throw error;
      }
    },

    /**
     * Vector similarity search
     *
     * Finds memories with embeddings similar to the query embedding.
     * Uses cosine distance (<=> operator) with HNSW index for performance.
     *
     * @param queryEmbedding - 1024-dimensional query vector
     * @param options - Search options (limit, threshold, collection)
     * @returns Array of search results sorted by similarity (highest first)
     */
    async search(
      queryEmbedding: number[],
      options: SearchOptions = {}
    ): Promise<SearchResult[]> {
      const { limit = 10, threshold = 0.3, collection } = options;

      // Format query vector for pgvector
      const vectorStr = `[${queryEmbedding.join(",")}]`;

      let query = `
        SELECT 
          m.id,
          m.content,
          m.metadata,
          m.collection,
          m.created_at,
          m.confidence,
          1 - (e.embedding <=> $1::vector) as score
        FROM memory_embeddings e
        JOIN memories m ON m.id = e.memory_id
      `;

      const params: any[] = [vectorStr];
      let paramIdx = 2;

      // Collection filter
      if (collection) {
        query += ` WHERE m.collection = $${paramIdx}`;
        params.push(collection);
        paramIdx++;
      }

      // Threshold filter
      if (collection) {
        query += ` AND 1 - (e.embedding <=> $1::vector) >= $${paramIdx}`;
      } else {
        query += ` WHERE 1 - (e.embedding <=> $1::vector) >= $${paramIdx}`;
      }
      params.push(threshold);
      paramIdx++;

      // Order and limit
      query += ` ORDER BY e.embedding <=> $1::vector LIMIT $${paramIdx}`;
      params.push(limit);

      const result = await db.query<any>(query, params);

      return result.rows.map((row: any) => ({
        memory: parseMemoryRow(row),
        score: row.score,
        matchType: "vector" as const,
      }));
    },

    /**
     * Full-text search
     *
     * Searches memory content using PostgreSQL's full-text search.
     * Uses GIN index on to_tsvector('english', content) for performance.
     *
     * @param searchQuery - Text query string
     * @param options - Search options (limit, collection)
     * @returns Array of search results ranked by ts_rank
     */
    async ftsSearch(
      searchQuery: string,
      options: SearchOptions = {}
    ): Promise<SearchResult[]> {
      const { limit = 10, collection } = options;

      let sql = `
        SELECT 
          m.id,
          m.content,
          m.metadata,
          m.collection,
          m.created_at,
          m.confidence,
          ts_rank(to_tsvector('english', m.content), plainto_tsquery('english', $1)) as score
        FROM memories m
        WHERE to_tsvector('english', m.content) @@ plainto_tsquery('english', $1)
      `;

      const params: any[] = [searchQuery];
      let paramIdx = 2;

      if (collection) {
        sql += ` AND m.collection = $${paramIdx}`;
        params.push(collection);
        paramIdx++;
      }

      sql += ` ORDER BY score DESC LIMIT $${paramIdx}`;
      params.push(limit);

      const result = await db.query<any>(sql, params);

      return result.rows.map((row: any) => ({
        memory: parseMemoryRow(row),
        score: row.score,
        matchType: "fts" as const,
      }));
    },

    /**
     * List memories
     *
     * @param collection - Optional collection filter
     * @returns Array of memories sorted by created_at DESC
     */
    async list(collection?: string): Promise<Memory[]> {
      let query = "SELECT * FROM memories";
      const params: string[] = [];

      if (collection) {
        query += " WHERE collection = $1";
        params.push(collection);
      }

      query += " ORDER BY created_at DESC";

      const result = await db.query<any>(query, params);
      return result.rows.map(parseMemoryRow);
    },

    /**
     * Get a single memory by ID
     *
     * @param id - Memory ID
     * @returns Memory or null if not found
     */
    async get(id: string): Promise<Memory | null> {
      const result = await db.query<any>(
        "SELECT * FROM memories WHERE id = $1",
        [id]
      );
      return result.rows.length > 0 ? parseMemoryRow(result.rows[0]) : null;
    },

    /**
     * Delete a memory
     *
     * Cascade delete handles memory_embeddings automatically.
     *
     * @param id - Memory ID
     */
    async delete(id: string): Promise<void> {
      await db.query("DELETE FROM memories WHERE id = $1", [id]);
    },

    /**
     * Get database statistics
     *
     * @returns Memory and embedding counts
     */
    async getStats(): Promise<{ memories: number; embeddings: number }> {
      const memories = await db.query<{ count: number }>(
        "SELECT COUNT(*) as count FROM memories"
      );
      const embeddings = await db.query<{ count: number }>(
        "SELECT COUNT(*) as count FROM memory_embeddings"
      );

      return {
        memories: Number(memories.rows[0].count),
        embeddings: Number(embeddings.rows[0].count),
      };
    },
  };
}
