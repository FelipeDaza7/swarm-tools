import type { SwarmMailAdapter } from "../types/adapter.js";

/**
 * Staleness Detector - Tracks index freshness vs file mtimes (ADR-010 Section 4.6)
 * 
 * Staleness definition: file_mtime > last_indexed_at + 300 (5 min grace period)
 * 
 * Schema: session_index_state table
 * - source_path: Absolute file path (PRIMARY KEY)
 * - last_indexed_at: Unix timestamp when file was last indexed
 * - file_mtime: Unix timestamp of file modification time at last index
 * - message_count: Number of messages indexed from file
 */

const GRACE_PERIOD_SECONDS = 300; // 5 minutes

export interface IndexState {
  source_path: string;
  last_indexed_at: number;
  file_mtime: number;
  message_count: number;
}

export interface RecordIndexedOpts {
  mtime: number;
  messageCount: number;
}

export interface CheckStalenessOpts {
  currentMtime: number;
}

export interface BulkStalenessCheckItem {
  path: string;
  currentMtime: number;
}

export interface BulkStalenessResult {
  path: string;
  isStale: boolean;
  indexState?: IndexState;
}

export class StalenessDetector {
  constructor(private adapter: SwarmMailAdapter) {}

  /**
   * Record that a file was indexed at current time
   */
  async recordIndexed(
    path: string,
    opts: RecordIndexedOpts
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
    
    const db = await this.adapter.getDatabase();
    
    // Ensure table exists
    await this.ensureTableExists();
    
    // Upsert index state
    await db.query(
      `INSERT INTO session_index_state (source_path, last_indexed_at, file_mtime, message_count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(source_path) DO UPDATE SET
         last_indexed_at = excluded.last_indexed_at,
         file_mtime = excluded.file_mtime,
         message_count = excluded.message_count`,
      [path, now, opts.mtime, opts.messageCount]
    );
  }

  /**
   * Get index state for a file
   */
  async getIndexState(path: string): Promise<IndexState | undefined> {
    const db = await this.adapter.getDatabase();
    
    await this.ensureTableExists();
    
    const result = await db.query<IndexState>(
      `SELECT source_path, last_indexed_at, file_mtime, message_count
       FROM session_index_state
       WHERE source_path = $1`,
      [path]
    );
    
    return result.rows[0];
  }

  /**
   * Check if a file is stale (needs re-indexing)
   * 
   * Staleness criteria:
   * - File was never indexed → stale
   * - file_mtime > last_indexed_at + grace_period → stale
   * - Otherwise → fresh
   */
  async checkStaleness(
    path: string,
    opts: CheckStalenessOpts
  ): Promise<boolean> {
    const state = await this.getIndexState(path);
    
    // Never indexed = stale
    if (!state) {
      return true;
    }
    
    // Check if mtime exceeds grace period
    // Note: We compare mtime with last_indexed_at, not current time
    // This way we detect file changes, not just time passage
    const mtimeDelta = opts.currentMtime - state.file_mtime;
    const isStale = mtimeDelta > GRACE_PERIOD_SECONDS;
    
    return isStale;
  }

  /**
   * Check staleness for multiple files in one batch
   * Optimizes with a single query instead of N queries
   */
  async checkBulkStaleness(
    items: BulkStalenessCheckItem[]
  ): Promise<BulkStalenessResult[]> {
    if (items.length === 0) {
      return [];
    }
    
    const db = await this.adapter.getDatabase();
    await this.ensureTableExists();
    
    // Build query with placeholders for IN clause
    const placeholders = items.map((_, i) => `$${i + 1}`).join(",");
    const paths = items.map(item => item.path);
    
    const result = await db.query<IndexState>(
      `SELECT source_path, last_indexed_at, file_mtime, message_count
       FROM session_index_state
       WHERE source_path IN (${placeholders})`,
      paths
    );
    
    // Create lookup map for indexed files
    const stateMap = new Map<string, IndexState>();
    for (const row of result.rows) {
      stateMap.set(row.source_path, row);
    }
    
    // Check each file
    const results: BulkStalenessResult[] = [];
    for (const item of items) {
      const state = stateMap.get(item.path);
      
      if (!state) {
        // Never indexed = stale
        results.push({ path: item.path, isStale: true });
        continue;
      }
      
      // Check mtime delta
      const mtimeDelta = item.currentMtime - state.file_mtime;
      const isStale = mtimeDelta > GRACE_PERIOD_SECONDS;
      
      results.push({
        path: item.path,
        isStale,
        indexState: state,
      });
    }
    
    return results;
  }

  /**
   * Convenience method: get list of stale file paths
   */
  async getStaleFiles(items: BulkStalenessCheckItem[]): Promise<string[]> {
    const results = await this.checkBulkStaleness(items);
    return results.filter(r => r.isStale).map(r => r.path);
  }

  /**
   * Ensure session_index_state table exists
   */
  private async ensureTableExists(): Promise<void> {
    const db = await this.adapter.getDatabase();
    
    await db.exec(`
      CREATE TABLE IF NOT EXISTS session_index_state (
        source_path TEXT PRIMARY KEY,
        last_indexed_at INTEGER NOT NULL,
        file_mtime INTEGER NOT NULL,
        message_count INTEGER NOT NULL
      )
    `);
  }
}
