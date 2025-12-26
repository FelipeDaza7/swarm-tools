/**
 * Session Indexing Module
 * 
 * Provides agent session discovery and indexing capabilities.
 * Part of the CASS Inhousing initiative (ADR-010).
 * 
 * @module sessions
 */

export {
  detectAgentType,
  loadAgentPatterns,
  resetAgentPatterns,
  type AgentType,
} from "./agent-discovery";
