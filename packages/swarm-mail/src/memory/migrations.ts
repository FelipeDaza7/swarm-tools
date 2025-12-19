/**
 * Memory Schema Migration
 *
 * Adds semantic memory tables to the shared PGLite database.
 * This migration extends the existing swarm-mail schema.
 *
 * ## Migration Strategy
 * - Migration v9 adds memory tables to existing swarm-mail schema (v0-v8)
 * - Shares same PGLite database instance and migration system
 * - Uses same schema_version table for tracking
 *
 * ## Tables Created
 * - memories: Core memory records with content, metadata, collection
 * - memory_embeddings: Vector embeddings for semantic search (pgvector)
 *
 * ## Indexes
 * - HNSW index on embeddings for fast approximate nearest neighbor search
 * - GIN index on content for full-text search
 * - B-tree index on collection for filtering
 *
 * ## Design Notes
 * - Uses TEXT for IDs (like hive/beads)
 * - Uses TIMESTAMPTZ for timestamps (Postgres standard)
 * - Uses JSONB for metadata (flexible key-value storage)
 * - Uses vector(1024) for embeddings (mxbai-embed-large dimension)
 * - CASCADE deletes for referential integrity
 *
 * @module memory/migrations
 */

import type { Migration } from "../streams/migrations.js";

/**
 * Migration v9: Add memory tables
 *
 * This migration is designed to be appended to the existing migrations array
 * in src/streams/migrations.ts.
 */
export const memoryMigration: Migration = {
  version: 9,
  description: "Add semantic memory tables (memories, memory_embeddings)",
  up: `
    -- ========================================================================
    -- Enable pgvector extension (required for vector type)
    -- ========================================================================
    CREATE EXTENSION IF NOT EXISTS vector;

    -- ========================================================================
    -- Memories Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      metadata JSONB DEFAULT '{}',
      collection TEXT DEFAULT 'default',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      confidence REAL DEFAULT 0.7
    );

    -- Collection filtering index
    CREATE INDEX IF NOT EXISTS idx_memories_collection ON memories(collection);

    -- Full-text search index
    CREATE INDEX IF NOT EXISTS memories_content_idx 
    ON memories 
    USING gin (to_tsvector('english', content));

    -- ========================================================================
    -- Memory Embeddings Table (pgvector)
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS memory_embeddings (
      memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
      embedding vector(1024) NOT NULL
    );

    -- HNSW index for fast approximate nearest neighbor search
    CREATE INDEX IF NOT EXISTS memory_embeddings_hnsw_idx 
    ON memory_embeddings 
    USING hnsw (embedding vector_cosine_ops);
  `,
  down: `
    -- Drop in reverse order to handle foreign key constraints
    DROP INDEX IF EXISTS memory_embeddings_hnsw_idx;
    DROP TABLE IF EXISTS memory_embeddings;
    DROP INDEX IF EXISTS memories_content_idx;
    DROP INDEX IF EXISTS idx_memories_collection;
    DROP TABLE IF EXISTS memories;
  `,
};

/**
 * Export memory migrations array
 */
export const memoryMigrations: Migration[] = [memoryMigration];
