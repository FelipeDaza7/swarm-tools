/**
 * Agent Discovery Module
 * 
 * Maps file paths to agent types using pattern matching.
 * Supports cross-platform paths (Unix and Windows).
 * 
 * @module sessions/agent-discovery
 */

/**
 * Agent type identifier
 */
export type AgentType =
  | "opencode-swarm"
  | "cursor"
  | "opencode"
  | "claude"
  | "aider";

/**
 * Path pattern configuration for agent type detection
 */
interface AgentPathPattern {
  /** RegExp pattern to match against file path */
  pattern: RegExp;
  /** Agent type to return when pattern matches */
  agentType: AgentType;
}

/**
 * Default path patterns for agent type detection
 * Order matters - first match wins
 * 
 * Can be overridden via loadAgentPatterns()
 */
let AGENT_PATH_PATTERNS: AgentPathPattern[] = [
  { pattern: /\.config[\/\\]swarm-tools[\/\\]sessions[\/\\]/, agentType: "opencode-swarm" },
  { pattern: /Cursor[\/\\]User[\/\\]History[\/\\]/, agentType: "cursor" },
  { pattern: /\.opencode[\/\\]/, agentType: "opencode" },
  { pattern: /\.local[\/\\]share[\/\\]Claude[\/\\]/, agentType: "claude" },
  { pattern: /\.aider/, agentType: "aider" },
];

/**
 * Configuration for custom agent patterns
 */
interface AgentPatternConfig {
  /** Pattern string (will be converted to RegExp) */
  pattern: string;
  /** Agent type identifier */
  agentType: AgentType;
}

/**
 * Load custom agent patterns from config
 * 
 * @param patterns - Array of custom pattern configurations
 * @returns Number of patterns loaded
 * 
 * @example
 * ```typescript
 * loadAgentPatterns([
 *   { pattern: "\\.codex[/\\\\]", agentType: "codex" },
 *   { pattern: "\\.gemini[/\\\\]", agentType: "gemini" }
 * ]);
 * ```
 */
export function loadAgentPatterns(patterns: AgentPatternConfig[]): number {
  AGENT_PATH_PATTERNS = patterns.map(({ pattern, agentType }) => ({
    pattern: new RegExp(pattern),
    agentType,
  }));
  return AGENT_PATH_PATTERNS.length;
}

/**
 * Reset agent patterns to defaults
 * Useful for testing
 */
export function resetAgentPatterns(): void {
  AGENT_PATH_PATTERNS = [
    { pattern: /\.config[\/\\]swarm-tools[\/\\]sessions[\/\\]/, agentType: "opencode-swarm" },
    { pattern: /Cursor[\/\\]User[\/\\]History[\/\\]/, agentType: "cursor" },
    { pattern: /\.opencode[\/\\]/, agentType: "opencode" },
    { pattern: /\.local[\/\\]share[\/\\]Claude[\/\\]/, agentType: "claude" },
    { pattern: /\.aider/, agentType: "aider" },
  ];
}

/**
 * Detect agent type from file path
 * 
 * @param filePath - Absolute or relative file path (Unix or Windows)
 * @returns Agent type identifier, or null if unknown
 * 
 * @example
 * ```typescript
 * detectAgentType("/home/user/.config/swarm-tools/sessions/ses_123.jsonl")
 * // => "opencode-swarm"
 * 
 * detectAgentType("/tmp/random.jsonl")
 * // => null
 * ```
 */
export function detectAgentType(filePath: string): AgentType | null {
  for (const { pattern, agentType } of AGENT_PATH_PATTERNS) {
    if (pattern.test(filePath)) {
      return agentType;
    }
  }
  return null;
}
