/**
 * Pagination API - Field Selection for Compact Output
 *
 * Defines field sets for memory query responses to optimize token usage.
 * Supports preset field sets (minimal, summary, full) and custom field arrays.
 *
 * ## Usage
 * ```typescript
 * import { FIELD_SETS, type FieldSet, type MemoryField } from './pagination.js';
 *
 * // Preset field sets
 * const fields = FIELD_SETS.minimal; // ['id', 'content', 'createdAt']
 *
 * // Custom field array
 * const custom: MemoryField[] = ['id', 'content', 'score'];
 * ```
 *
 * ## Token Budget Optimization
 * - **minimal**: ~80% token reduction (id + preview only)
 * - **summary**: ~50% token reduction (adds score + matchType, excludes metadata)
 * - **full**: No reduction (all fields)
 */

import type { Memory, SearchResult } from "../memory/store.js";

/**
 * Available fields in Memory objects
 */
export type MemoryField = 
  | "id"
  | "content"
  | "metadata"
  | "collection"
  | "createdAt"
  | "confidence";

/**
 * Available fields in SearchResult objects (includes Memory fields + score/matchType)
 */
export type SearchResultField = MemoryField | "score" | "matchType";

/**
 * Field set presets
 */
export type FieldSet = "minimal" | "summary" | "full";

/**
 * Field selection configuration
 */
export type FieldSelection = FieldSet | SearchResultField[];

/**
 * Predefined field sets for common use cases
 */
export const FIELD_SETS: Record<FieldSet, SearchResultField[] | "*"> = {
  /** Minimal output: id + content preview + timestamp */
  minimal: ["id", "content", "createdAt"],
  
  /** Summary output: minimal + score + matchType (excludes metadata) */
  summary: ["id", "content", "createdAt", "score", "matchType"],
  
  /** Full output: all fields (default) */
  full: "*",
};

/**
 * Project SearchResult to include only requested fields
 *
 * @param result - Search result to project
 * @param fields - Field selection (preset or custom array)
 * @returns Projected search result with only requested fields
 */
export function projectSearchResult(
  result: SearchResult,
  fields: FieldSelection = "full"
): SearchResult | Partial<SearchResult> {
  // Resolve field set to array
  const fieldArray = typeof fields === "string" ? FIELD_SETS[fields] : fields;

  // Full mode - return everything
  if (fieldArray === "*") {
    return result;
  }

  // Project memory fields
  const memoryFields = fieldArray.filter((f): f is MemoryField => 
    ["id", "content", "metadata", "collection", "createdAt", "confidence"].includes(f)
  );

  const projectedMemory: Record<string, any> = {};
  for (const field of memoryFields) {
    if (field in result.memory) {
      projectedMemory[field] = result.memory[field];
    }
  }

  // Build result object directly to avoid readonly assignment issues
  const projected: Record<string, any> = {
    memory: projectedMemory,
  };

  if (fieldArray.includes("score")) {
    projected.score = result.score;
  }

  if (fieldArray.includes("matchType")) {
    projected.matchType = result.matchType;
  }

  return projected as Partial<SearchResult>;
}

/**
 * Project array of SearchResults
 *
 * @param results - Search results to project
 * @param fields - Field selection (preset or custom array)
 * @returns Projected search results
 */
export function projectSearchResults(
  results: SearchResult[],
  fields: FieldSelection = "full"
): Array<SearchResult | Partial<SearchResult>> {
  return results.map((r) => projectSearchResult(r, fields));
}
