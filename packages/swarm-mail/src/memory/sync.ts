/**
 * Memory Sync - JSONL Export/Import for Git Sync
 *
 * Implements git-synced memory persistence, similar to how hive syncs issues.jsonl.
 * Memories travel with the repo so team members share learnings.
 *
 * ## Architecture
 * ```
 * .hive/
 *   issues.jsonl      # existing
 *   memories.jsonl    # NEW
 * ```
 *
 * ## JSONL Format
 * ```json
 * {"id":"mem_abc123","information":"OAuth tokens need 5min buffer...","metadata":"auth,tokens","tags":"oauth,refresh","confidence":0.9,"created_at":"2024-12-19T00:00:00Z"}
 * ```
 *
 * Note: Embeddings are NOT stored (too large). Regenerated on import if Ollama available.
 *
 * @module memory/sync
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseAdapter } from "../types/database.js";

// ============================================================================
// Types
// ============================================================================

/**
 * JSONL export format for memories
 *
 * Embeddings are NOT included - they're too large and can be regenerated.
 */
export interface MemoryExport {
  id: string;
  information: string;
  metadata?: string;
  tags?: string;
  confidence?: number;
  created_at: string; // ISO 8601
}

export interface ExportOptions {
  /** Filter by collection */
  collection?: string;
}

export interface ImportOptions {
  /** Skip existing memories (default: true) */
  skipExisting?: boolean;
}

export interface MemoryImportResult {
  created: number;
  skipped: number;
  errors: Array<{ memoryId: string; error: string }>;
}

// ============================================================================
// Serialize / Parse
// ============================================================================

/**
 * Serialize a memory to a JSONL line
 */
export function serializeMemoryToJSONL(memory: MemoryExport): string {
  // Only include defined fields
  const clean: Record<string, unknown> = {
    id: memory.id,
    information: memory.information,
    created_at: memory.created_at,
  };

  if (memory.metadata !== undefined) {
    clean.metadata = memory.metadata;
  }
  if (memory.tags !== undefined) {
    clean.tags = memory.tags;
  }
  if (memory.confidence !== undefined) {
    clean.confidence = memory.confidence;
  }

  return JSON.stringify(clean);
}

/**
 * Parse JSONL string to memory exports
 *
 * Skips empty lines. Throws on invalid JSON.
 */
export function parseMemoryJSONL(jsonl: string): MemoryExport[] {
  if (!jsonl || jsonl.trim() === "") {
    return [];
  }

  const lines = jsonl.split("\n");
  const memories: MemoryExport[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }

    try {
      const memory = JSON.parse(trimmed) as MemoryExport;
      memories.push(memory);
    } catch (err) {
      throw new Error(
        `Invalid JSON in JSONL: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return memories;
}

// ============================================================================
// Export
// ============================================================================

/**
 * Export all memories to JSONL string
 *
 * Embeddings are NOT included - they're too large for git sync.
 * They can be regenerated on import if Ollama is available.
 */
export async function exportMemories(
  db: DatabaseAdapter,
  options: ExportOptions = {}
): Promise<string> {
  // Build query
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (options.collection) {
    conditions.push(`collection = $${paramIndex++}`);
    params.push(options.collection);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT id, content, metadata, collection, created_at
    FROM memories
    ${whereClause}
    ORDER BY id ASC
  `;

  const result = await db.query<{
    id: string;
    content: string;
    metadata: string;
    collection: string;
    created_at: string;
  }>(query, params);

  if (result.rows.length === 0) {
    return "";
  }

  // Convert each memory to export format
  const lines: string[] = [];

  for (const row of result.rows) {
    // Parse metadata to extract tags and confidence
    // Note: PGlite returns JSONB as object, not string
    let metadata: Record<string, unknown> = {};
    try {
      if (typeof row.metadata === "string") {
        metadata = JSON.parse(row.metadata || "{}");
      } else if (row.metadata && typeof row.metadata === "object") {
        metadata = row.metadata as Record<string, unknown>;
      }
    } catch {
      // Ignore parse errors
    }

    // Extract tags as comma-separated string
    const tags = Array.isArray(metadata.tags) ? metadata.tags.join(",") : undefined;

    // Extract confidence
    const confidence = typeof metadata.confidence === "number" ? metadata.confidence : undefined;

    // Build metadata string (excluding tags and confidence which are top-level)
    const metadataWithoutSpecial = { ...metadata };
    delete metadataWithoutSpecial.tags;
    delete metadataWithoutSpecial.confidence;
    const metadataStr =
      Object.keys(metadataWithoutSpecial).length > 0
        ? JSON.stringify(metadataWithoutSpecial)
        : undefined;

    const memoryExport: MemoryExport = {
      id: row.id,
      information: row.content,
      metadata: metadataStr,
      tags,
      confidence,
      created_at: row.created_at,
    };

    lines.push(serializeMemoryToJSONL(memoryExport));
  }

  return lines.join("\n");
}

// ============================================================================
// Import
// ============================================================================

/**
 * Import memories from JSONL string
 *
 * Features:
 * - Creates new memories
 * - Skips existing memories (by ID)
 * - Embeddings NOT imported (regenerate with Ollama if needed)
 */
export async function importMemories(
  db: DatabaseAdapter,
  jsonl: string,
  options: ImportOptions = {}
): Promise<MemoryImportResult> {
  const { skipExisting = true } = options;

  const memories = parseMemoryJSONL(jsonl);
  const result: MemoryImportResult = {
    created: 0,
    skipped: 0,
    errors: [],
  };

  for (const memoryExport of memories) {
    try {
      await importSingleMemory(db, memoryExport, skipExisting, result);
    } catch (err) {
      result.errors.push({
        memoryId: memoryExport.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/**
 * Import a single memory
 */
async function importSingleMemory(
  db: DatabaseAdapter,
  memoryExport: MemoryExport,
  skipExisting: boolean,
  result: MemoryImportResult
): Promise<void> {
  // Validate ID
  if (!memoryExport.id || memoryExport.id.trim() === "") {
    throw new Error("Memory ID is required");
  }

  // Check if exists
  const existingResult = await db.query<{ id: string }>(
    "SELECT id FROM memories WHERE id = $1",
    [memoryExport.id]
  );

  if (existingResult.rows.length > 0) {
    if (skipExisting) {
      result.skipped++;
      return;
    }
    // If not skipping, we could update - but for now just skip
    result.skipped++;
    return;
  }

  // Build metadata object
  const metadata: Record<string, unknown> = {};

  // Parse existing metadata if present
  if (memoryExport.metadata) {
    try {
      const parsed = JSON.parse(memoryExport.metadata);
      Object.assign(metadata, parsed);
    } catch {
      // If not JSON, treat as string
      metadata.raw = memoryExport.metadata;
    }
  }

  // Add tags
  if (memoryExport.tags) {
    metadata.tags = memoryExport.tags.split(",").map((t) => t.trim());
  }

  // Add confidence
  if (memoryExport.confidence !== undefined) {
    metadata.confidence = memoryExport.confidence;
  }

  // Insert memory
  await db.query(
    `INSERT INTO memories (id, content, metadata, collection, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      memoryExport.id,
      memoryExport.information,
      JSON.stringify(metadata),
      "default", // Default collection for imported memories
      memoryExport.created_at,
    ]
  );

  result.created++;
}

// ============================================================================
// Sync
// ============================================================================

/**
 * Bidirectional sync between database and .hive/memories.jsonl
 *
 * 1. Import from file (new memories only)
 * 2. Export all to file (overwrites)
 *
 * This ensures:
 * - Memories from git are imported
 * - Local memories are exported for git commit
 */
export async function syncMemories(
  db: DatabaseAdapter,
  hivePath: string
): Promise<{ imported: MemoryImportResult; exported: number }> {
  const memoriesPath = join(hivePath, "memories.jsonl");

  // Step 1: Import from file if exists
  let importResult: MemoryImportResult = { created: 0, skipped: 0, errors: [] };

  if (existsSync(memoriesPath)) {
    const fileContent = readFileSync(memoriesPath, "utf-8");
    importResult = await importMemories(db, fileContent);
  }

  // Step 2: Export all memories to file
  const exportContent = await exportMemories(db);
  writeFileSync(memoriesPath, exportContent);

  // Count exported
  const exportedCount = exportContent ? exportContent.split("\n").filter(Boolean).length : 0;

  return {
    imported: importResult,
    exported: exportedCount,
  };
}
