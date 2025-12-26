/**
 * Session Parser - Parse JSONL session files into normalized messages
 * 
 * Based on ADR-010 Section 4.2.
 * Supports OpenCode Swarm session format initially.
 * 
 * @module sessions/session-parser
 */

import { z } from 'zod';

/**
 * Normalized message schema
 * 
 * All session formats are normalized to this structure for uniform indexing.
 */
export const NormalizedMessageSchema = z.object({
  session_id: z.string(),
  agent_type: z.string(),
  message_idx: z.number().int().nonnegative(),
  timestamp: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  source_path: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type NormalizedMessage = z.infer<typeof NormalizedMessageSchema>;

/**
 * OpenCode Swarm session event schema
 */
const OpenCodeSwarmEventSchema = z.object({
  session_id: z.string().optional(),
  event_type: z.string(),
  timestamp: z.string(),
  payload: z.record(z.unknown()),
});

type OpenCodeSwarmEvent = z.infer<typeof OpenCodeSwarmEventSchema>;

/**
 * Parse options
 */
export interface ParseOptions {
  /** Path to the source JSONL file */
  filePath?: string;
}

/**
 * Session Parser
 * 
 * Parses JSONL session files into normalized messages.
 */
export class SessionParser {
  private agentType: string;

  constructor(agentType: string) {
    this.agentType = agentType;
  }

  /**
   * Parse JSONL content into normalized messages
   * 
   * @param jsonl - JSONL content (newline-separated JSON objects)
   * @param options - Parse options (filePath for session_id extraction)
   * @returns Array of normalized messages
   */
  async parse(jsonl: string, options: ParseOptions = {}): Promise<NormalizedMessage[]> {
    const lines = jsonl.split('\n');
    const messages: NormalizedMessage[] = [];

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx].trim();
      
      // Skip empty lines
      if (!line) continue;

      try {
        const raw = JSON.parse(line);
        const normalized = this.normalizeMessage(raw, idx, options);
        if (normalized) {
          messages.push(normalized);
        }
      } catch (error) {
        // Skip malformed JSON (log in production)
        continue;
      }
    }

    return messages;
  }

  /**
   * Normalize a raw message object
   */
  private normalizeMessage(
    raw: unknown,
    lineNumber: number,
    options: ParseOptions
  ): NormalizedMessage | null {
    if (this.agentType === 'opencode-swarm') {
      return this.normalizeOpenCodeSwarm(raw, lineNumber, options);
    }
    
    return null;
  }

  /**
   * Normalize OpenCode Swarm event to message
   */
  private normalizeOpenCodeSwarm(
    raw: unknown,
    lineNumber: number,
    options: ParseOptions
  ): NormalizedMessage | null {
    const result = OpenCodeSwarmEventSchema.safeParse(raw);
    if (!result.success) return null;

    const event = result.data;

    // Extract session_id from event or filename
    const session_id = event.session_id || this.extractSessionIdFromPath(options.filePath);

    // Generate content from event
    const content = this.formatEventContent(event);

    return {
      session_id,
      agent_type: this.agentType,
      message_idx: lineNumber,
      timestamp: event.timestamp,
      role: 'system', // All swarm events are system events
      content,
      source_path: options.filePath,
      metadata: {
        event_type: event.event_type,
        payload: event.payload,
      },
    };
  }

  /**
   * Extract session_id from file path
   * 
   * Handles patterns like:
   * - /path/to/ses_abc123.jsonl -> ses_abc123
   * - /path/to/session-xyz.jsonl -> session-xyz
   */
  private extractSessionIdFromPath(filePath?: string): string {
    if (!filePath) return 'unknown';

    const filename = filePath.split('/').pop() || '';
    const withoutExt = filename.replace(/\.jsonl$/, '');
    
    return withoutExt || 'unknown';
  }

  /**
   * Format event content for display
   */
  private formatEventContent(event: OpenCodeSwarmEvent): string {
    const parts: string[] = [`${event.event_type}`];

    // Add key payload fields to content
    if (event.payload) {
      const payloadKeys = Object.keys(event.payload);
      if (payloadKeys.length > 0) {
        const summary = payloadKeys
          .slice(0, 3)
          .map(key => `${key}=${JSON.stringify(event.payload[key])}`)
          .join(', ');
        parts.push(summary);
      }
    }

    return parts.join(': ');
  }
}
