/**
 * Session Metadata Migration Tests
 * 
 * Tests for migration v11 (session metadata columns).
 */

import { describe, test, expect } from 'vitest';
import { createClient } from '@libsql/client';
import { sessionMetadataExtensionLibSQL } from './migrations.js';

describe('Session Metadata Migration (v11)', () => {
  // Helper to create a fresh database with base schema
  const createTestDb = async () => {
    const db = createClient({ url: ':memory:' });
    
    // Create base memories table (simulate migration v9)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        collection TEXT DEFAULT 'default',
        created_at TEXT DEFAULT (datetime('now')),
        confidence REAL DEFAULT 0.7,
        embedding F32_BLOB(1024)
      )
    `);
    
    return db;
  };

  // Helper to run migration (libSQL doesn't support multi-statement execute)
  const runMigration = async (db: ReturnType<typeof createClient>) => {
    // Split migration SQL into individual statements and execute with batch
    const statements = [
      `ALTER TABLE memories ADD COLUMN agent_type TEXT`,
      `ALTER TABLE memories ADD COLUMN session_id TEXT`,
      `ALTER TABLE memories ADD COLUMN message_role TEXT CHECK(message_role IN ('user', 'assistant', 'system'))`,
      `ALTER TABLE memories ADD COLUMN message_idx INTEGER`,
      `ALTER TABLE memories ADD COLUMN source_path TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id, message_idx)`,
      `CREATE INDEX IF NOT EXISTS idx_memories_agent_type ON memories(agent_type)`,
      `CREATE INDEX IF NOT EXISTS idx_memories_role ON memories(message_role)`,
    ];
    
    await db.batch(statements, 'write');
  };

  test('adds session metadata columns', async () => {
    const db = await createTestDb();
    
    // Run migration
    await runMigration(db);

    // Verify columns exist by inserting a record
    const result = await db.execute({
      sql: `INSERT INTO memories (
        id, content, agent_type, session_id, message_role, message_idx, source_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [
        'mem_test',
        'Test content',
        'opencode-swarm',
        'ses_123',
        'system',
        0,
        '/tmp/ses_123.jsonl',
      ],
    });

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0] as Record<string, unknown>;
    expect(row.agent_type).toBe('opencode-swarm');
    expect(row.session_id).toBe('ses_123');
    expect(row.message_role).toBe('system');
    expect(row.message_idx).toBe(0);
    expect(row.source_path).toBe('/tmp/ses_123.jsonl');
    
    db.close();
  });

  test('enforces message_role CHECK constraint', async () => {
    const db = await createTestDb();
    await runMigration(db);

    // Valid roles should work
    for (const role of ['user', 'assistant', 'system']) {
      const result = await db.execute({
        sql: `INSERT INTO memories (id, content, message_role) VALUES (?, ?, ?)`,
        args: [`mem_${role}`, 'Test', role],
      });
      expect(result.rowsAffected).toBe(1);
    }

    // Invalid role should fail
    await expect(
      db.execute({
        sql: `INSERT INTO memories (id, content, message_role) VALUES (?, ?, ?)`,
        args: ['mem_invalid', 'Test', 'invalid_role'],
      })
    ).rejects.toThrow();
    
    db.close();
  });

  test('creates session index', async () => {
    const db = await createTestDb();
    await runMigration(db);

    // Insert test data
    await db.execute({
      sql: `INSERT INTO memories (id, content, session_id, message_idx) VALUES (?, ?, ?, ?)`,
      args: ['mem_1', 'First', 'ses_123', 0],
    });
    await db.execute({
      sql: `INSERT INTO memories (id, content, session_id, message_idx) VALUES (?, ?, ?, ?)`,
      args: ['mem_2', 'Second', 'ses_123', 1],
    });

    // Query using session index
    const result = await db.execute({
      sql: `SELECT id FROM memories WHERE session_id = ? ORDER BY message_idx`,
      args: ['ses_123'],
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toHaveProperty('id', 'mem_1');
    expect(result.rows[1]).toHaveProperty('id', 'mem_2');
    
    db.close();
  });

  test('creates agent_type index', async () => {
    const db = await createTestDb();
    await runMigration(db);

    // Insert test data
    await db.execute({
      sql: `INSERT INTO memories (id, content, agent_type) VALUES (?, ?, ?)`,
      args: ['mem_swarm', 'Test', 'opencode-swarm'],
    });
    await db.execute({
      sql: `INSERT INTO memories (id, content, agent_type) VALUES (?, ?, ?)`,
      args: ['mem_cursor', 'Test', 'cursor'],
    });

    // Query by agent_type
    const result = await db.execute({
      sql: `SELECT id FROM memories WHERE agent_type = ?`,
      args: ['opencode-swarm'],
    });

    expect(result.rows.length).toBeGreaterThanOrEqual(1);
    
    db.close();
  });

  test('allows NULL values for optional session fields', async () => {
    const db = await createTestDb();
    await runMigration(db);

    // Insert memory without session metadata
    const result = await db.execute({
      sql: `INSERT INTO memories (id, content) VALUES (?, ?) RETURNING *`,
      args: ['mem_no_session', 'Test content'],
    });

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0] as Record<string, unknown>;
    expect(row.agent_type).toBeNull();
    expect(row.session_id).toBeNull();
    expect(row.message_role).toBeNull();
    expect(row.message_idx).toBeNull();
    expect(row.source_path).toBeNull();
    
    db.close();
  });
});
