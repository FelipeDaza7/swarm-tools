/**
 * Session Parser Tests - TDD RED/GREEN/REFACTOR
 * 
 * Tests for parsing JSONL session files into normalized messages.
 * Based on ADR-010 Section 4.2.
 */

import { describe, test, expect } from 'vitest';
import { SessionParser, type NormalizedMessage } from './session-parser.js';

describe('SessionParser - OpenCode Swarm Format', () => {
  test('parses OpenCode Swarm JSONL format', async () => {
    const jsonl = [
      '{"session_id":"ses_123","event_type":"DECISION","timestamp":"2025-12-26T10:00:00Z","payload":{"action":"spawn"}}',
      '{"session_id":"ses_123","event_type":"OUTCOME","timestamp":"2025-12-26T10:01:00Z","payload":{"status":"success"}}'
    ].join('\n');
    
    const parser = new SessionParser('opencode-swarm');
    const messages = await parser.parse(jsonl, { filePath: '/tmp/ses_123.jsonl' });
    
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      session_id: 'ses_123',
      agent_type: 'opencode-swarm',
      message_idx: 0,
      timestamp: '2025-12-26T10:00:00Z',
      role: 'system',
      content: expect.stringContaining('DECISION'),
      source_path: '/tmp/ses_123.jsonl',
    });
    
    expect(messages[1]).toMatchObject({
      session_id: 'ses_123',
      agent_type: 'opencode-swarm',
      message_idx: 1,
      timestamp: '2025-12-26T10:01:00Z',
      role: 'system',
    });
  });

  test('extracts session_id from filename if not in payload', async () => {
    const jsonl = '{"event_type":"DECISION","timestamp":"2025-12-26T10:00:00Z","payload":{}}';
    
    const parser = new SessionParser('opencode-swarm');
    const messages = await parser.parse(jsonl, { filePath: '/tmp/ses_abc123.jsonl' });
    
    expect(messages[0].session_id).toBe('ses_abc123');
  });

  test('handles malformed JSONL gracefully', async () => {
    const jsonl = [
      '{"session_id":"ses_1","event_type":"DECISION","timestamp":"2025-12-26T10:00:00Z","payload":{}}',
      'INVALID JSON',
      '{"session_id":"ses_1","event_type":"OUTCOME","timestamp":"2025-12-26T10:01:00Z","payload":{}}'
    ].join('\n');
    
    const parser = new SessionParser('opencode-swarm');
    const messages = await parser.parse(jsonl);
    
    expect(messages).toHaveLength(2); // Skips malformed line
    expect(messages[0].message_idx).toBe(0);
    expect(messages[1].message_idx).toBe(2); // Preserves original line number
  });

  test('handles empty lines', async () => {
    const jsonl = [
      '{"session_id":"ses_1","event_type":"DECISION","timestamp":"2025-12-26T10:00:00Z","payload":{}}',
      '',
      '   ',
      '{"session_id":"ses_1","event_type":"OUTCOME","timestamp":"2025-12-26T10:01:00Z","payload":{}}'
    ].join('\n');
    
    const parser = new SessionParser('opencode-swarm');
    const messages = await parser.parse(jsonl);
    
    expect(messages).toHaveLength(2);
  });

  test('normalizes content from event payload', async () => {
    const jsonl = '{"session_id":"ses_1","event_type":"VIOLATION","timestamp":"2025-12-26T10:00:00Z","payload":{"violation":"coordinator_edit","file":"auth.ts"}}';
    
    const parser = new SessionParser('opencode-swarm');
    const messages = await parser.parse(jsonl);
    
    expect(messages[0].content).toContain('VIOLATION');
    expect(messages[0].content).toContain('coordinator_edit');
  });

  test('preserves metadata from original event', async () => {
    const jsonl = '{"session_id":"ses_1","event_type":"DECISION","timestamp":"2025-12-26T10:00:00Z","payload":{"action":"spawn","bead_id":"bd-123"}}';
    
    const parser = new SessionParser('opencode-swarm');
    const messages = await parser.parse(jsonl);
    
    expect(messages[0].metadata).toMatchObject({
      event_type: 'DECISION',
      payload: { action: 'spawn', bead_id: 'bd-123' },
    });
  });
});

describe('SessionParser - Role Assignment', () => {
  test('assigns system role to event types', async () => {
    const events = ['DECISION', 'VIOLATION', 'OUTCOME', 'COMPACTION'];
    
    for (const event_type of events) {
      const jsonl = `{"session_id":"ses_1","event_type":"${event_type}","timestamp":"2025-12-26T10:00:00Z","payload":{}}`;
      const parser = new SessionParser('opencode-swarm');
      const messages = await parser.parse(jsonl);
      
      expect(messages[0].role).toBe('system');
    }
  });
});

describe('SessionParser - Error Handling', () => {
  test('returns empty array for empty input', async () => {
    const parser = new SessionParser('opencode-swarm');
    const messages = await parser.parse('');
    
    expect(messages).toEqual([]);
  });

  test('returns empty array for whitespace-only input', async () => {
    const parser = new SessionParser('opencode-swarm');
    const messages = await parser.parse('   \n\n   ');
    
    expect(messages).toEqual([]);
  });
});

describe('NormalizedMessage Schema', () => {
  test('enforces required fields', async () => {
    const jsonl = '{"session_id":"ses_1","event_type":"DECISION","timestamp":"2025-12-26T10:00:00Z","payload":{}}';
    
    const parser = new SessionParser('opencode-swarm');
    const messages = await parser.parse(jsonl, { filePath: '/tmp/test.jsonl' });
    
    const message = messages[0];
    
    // Required fields
    expect(message).toHaveProperty('session_id');
    expect(message).toHaveProperty('agent_type');
    expect(message).toHaveProperty('message_idx');
    expect(message).toHaveProperty('timestamp');
    expect(message).toHaveProperty('role');
    expect(message).toHaveProperty('content');
    expect(message).toHaveProperty('source_path');
    expect(message).toHaveProperty('metadata');
    
    // Type checks
    expect(typeof message.session_id).toBe('string');
    expect(typeof message.agent_type).toBe('string');
    expect(typeof message.message_idx).toBe('number');
    expect(typeof message.timestamp).toBe('string');
    expect(['user', 'assistant', 'system']).toContain(message.role);
    expect(typeof message.content).toBe('string');
    expect(typeof message.metadata).toBe('object');
  });
});
