/**
 * Durable Streams Adapter
 * 
 * Adapts swarm-mail event store to the Durable Streams protocol.
 * 
 * Protocol: https://github.com/durable-streams/durable-streams
 * 
 * Key features:
 * - Offset-based resumability (refresh-safe, multi-device, multi-tab)
 * - Long-poll and SSE modes for live tailing
 * - Catch-up reads from any offset
 * - CDN-friendly design for massive fan-out
 * 
 * @see .hive/analysis/hive-cell-visualizer.md for full architecture
 */

import type { SwarmMailAdapter } from "../types/adapter.js";
import { readEvents, getLatestSequence } from "./store-drizzle.js";

/**
 * StreamEvent format for Durable Streams protocol
 */
export interface StreamEvent {
  /** Event sequence number (serves as offset for resumability) */
  offset: number;
  /** JSON-encoded AgentEvent */
  data: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
}

/**
 * DurableStreamAdapter interface
 * 
 * Provides offset-based access to the swarm-mail event store.
 * Compatible with Durable Streams protocol.
 */
export interface DurableStreamAdapter {
  /**
   * Read events starting from offset
   * 
   * @param offset - Start reading AFTER this sequence number (0 = from beginning)
   * @param limit - Maximum number of events to return
   * @returns Array of StreamEvents
   */
  read(offset: number, limit: number): Promise<StreamEvent[]>;
  
  /**
   * Get the latest sequence number
   * 
   * @returns Latest sequence number (0 if no events)
   */
  head(): Promise<number>;
  
  /**
   * Subscribe to new events (polling-based)
   * 
   * Polls every 100ms for new events and calls callback.
   * Only delivers events that arrive AFTER subscription starts.
   * 
   * @param callback - Called with each new event
   * @returns Unsubscribe function
   */
  subscribe(callback: (event: StreamEvent) => void): () => void;
}

/**
 * Create a DurableStreamAdapter for a specific project
 * 
 * @param swarmMail - SwarmMailAdapter instance
 * @param projectKey - Project key to filter events by
 * @returns DurableStreamAdapter instance
 * 
 * @example
 * ```typescript
 * const swarmMail = await createInMemorySwarmMailLibSQL("test");
 * const adapter = createDurableStreamAdapter(swarmMail, "/path/to/project");
 * 
 * // Read events from beginning
 * const events = await adapter.read(0, 100);
 * 
 * // Get latest sequence
 * const head = await adapter.head();
 * 
 * // Subscribe to new events
 * const unsubscribe = adapter.subscribe((event) => {
 *   console.log("New event:", event);
 * });
 * ```
 */
export function createDurableStreamAdapter(
  swarmMail: SwarmMailAdapter,
  projectKey: string,
): DurableStreamAdapter {
  return {
    async read(offset: number, limit: number): Promise<StreamEvent[]> {
      // Use the SwarmMailAdapter's readEvents method
      // Pass undefined for projectPath since we specify projectKey in options
      const events = await swarmMail.readEvents(
        {
          projectKey,
          afterSequence: offset,
          limit,
        },
        undefined,
      );

      // Convert to StreamEvent format
      return events.map((event) => ({
        offset: event.sequence,
        data: JSON.stringify(event),
        timestamp: event.timestamp,
      }));
    },

    async head(): Promise<number> {
      // Use the SwarmMailAdapter's getLatestSequence method
      return await swarmMail.getLatestSequence(projectKey, undefined);
    },

    subscribe(callback: (event: StreamEvent) => void): () => void {
      let lastSequence = 0;
      let isActive = true;

      // Initialize lastSequence to current head to avoid replaying historical events
      (async () => {
        lastSequence = await swarmMail.getLatestSequence(projectKey);
      })();

      // Poll every 100ms for new events
      const pollInterval = setInterval(async () => {
        if (!isActive) return;

        try {
          // Read events after lastSequence
          const events = await swarmMail.readEvents({
            projectKey,
            afterSequence: lastSequence,
            limit: 100, // Batch size
          });

          // Call callback for each new event
          for (const event of events) {
            if (!isActive) break;
            
            const streamEvent: StreamEvent = {
              offset: event.sequence,
              data: JSON.stringify(event),
              timestamp: event.timestamp,
            };
            
            callback(streamEvent);
            lastSequence = event.sequence;
          }
        } catch (error) {
          console.error("[DurableStreamAdapter] Poll error:", error);
        }
      }, 100);

      // Return unsubscribe function
      return () => {
        isActive = false;
        clearInterval(pollInterval);
      };
    },
  };
}
