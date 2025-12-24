/**
 * Durable Streams HTTP Server
 *
 * Exposes the Durable Streams protocol via Server-Sent Events (SSE).
 * Built with Bun.serve() for HTTP server.
 *
 * Port 4483 = HIVE on phone keypad
 *
 * ## Endpoints
 *
 * GET /streams/:projectKey?offset=N&live=true
 * - offset: Start reading from this sequence (default 0)
 * - live: If true, keep connection open and stream new events via SSE
 *
 * ## SSE Format
 *
 * data: {json}\n\n
 *
 * Each event is sent as a JSON-encoded StreamEvent:
 * { offset: number, data: string, timestamp: number }
 */

import type { Server } from "bun";
import type { DurableStreamAdapter, StreamEvent } from "./durable-adapter.js";

// Bun Server type without WebSocket data
type BunServer = Server<undefined>;

/**
 * Configuration for the Durable Stream HTTP server
 */
export interface DurableStreamServerConfig {
  /** Adapter for reading events */
  adapter: DurableStreamAdapter;
  /** Port to listen on (default 4483 - HIVE on phone keypad) */
  port?: number;
}

/**
 * Durable Stream HTTP server interface
 */
export interface DurableStreamServer {
  /** Start the HTTP server */
  start(): Promise<void>;
  /** Stop the HTTP server and clean up subscriptions */
  stop(): Promise<void>;
  /** Base URL of the server */
  url: string;
}

/**
 * Creates a Durable Streams HTTP server exposing events via SSE
 *
 * @example
 * ```typescript
 * const adapter = createDurableStreamAdapter(swarmMail, "/my/project");
 * const server = createDurableStreamServer({ adapter });
 * await server.start();
 * console.log(`Streaming at ${server.url}/streams/my-project`);
 * ```
 */
export function createDurableStreamServer(
  config: DurableStreamServerConfig,
): DurableStreamServer {
  const { adapter, port = 4483 } = config;

  let bunServer: BunServer | null = null;
  const subscriptions = new Map<
    number,
    { unsubscribe: () => void; controller: ReadableStreamDefaultController }
  >();
  let subscriptionCounter = 0;

  const url = `http://localhost:${port}`;

  async function start(): Promise<void> {
    if (bunServer) {
      throw new Error("Server is already running");
    }

    bunServer = Bun.serve({
      port,
      async fetch(req: Request) {
        const url = new URL(req.url);

        // Parse route: /streams/:projectKey
        const match = url.pathname.match(/^\/streams\/(.+)$/);
        if (!match) {
          return new Response("Not Found", { status: 404 });
        }

        const projectKey = decodeURIComponent(match[1]);

        // Parse query params
        const offsetParam = url.searchParams.get("offset");
        const liveParam = url.searchParams.get("live");
        const limitParam = url.searchParams.get("limit");

        const offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0;
        const live = liveParam === "true";
        const limit = limitParam ? Number.parseInt(limitParam, 10) : 100;

        // Validate offset
        if (Number.isNaN(offset) || offset < 0) {
          return new Response("Invalid offset parameter", { status: 400 });
        }

        // ONE-SHOT MODE: Return events as JSON array
        if (!live) {
          const events = await adapter.read(offset, limit);
          return new Response(JSON.stringify(events), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          });
        }

        // LIVE MODE: SSE stream
        const stream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();

            // Send existing events first
            const existingEvents = await adapter.read(offset, limit);
            for (const event of existingEvents) {
              const sse = `data: ${JSON.stringify(event)}\n\n`;
              controller.enqueue(encoder.encode(sse));
            }

            // Subscribe to new events
            const subscriptionId = subscriptionCounter++;
            const unsubscribe = adapter.subscribe((event: StreamEvent) => {
              // Only send events after our offset
              if (event.offset > offset) {
                try {
                  const sse = `data: ${JSON.stringify(event)}\n\n`;
                  controller.enqueue(encoder.encode(sse));
                } catch (error) {
                  // Client disconnected, will be cleaned up in cancel()
                  console.error("Error sending event:", error);
                }
              }
            });

            subscriptions.set(subscriptionId, { unsubscribe, controller });

            // Clean up on disconnect
            const cleanup = () => {
              const sub = subscriptions.get(subscriptionId);
              if (sub) {
                sub.unsubscribe();
                subscriptions.delete(subscriptionId);
              }
            };

            // Handle client disconnect
            req.signal.addEventListener("abort", () => {
              cleanup();
              try {
                controller.close();
              } catch {
                // Already closed
              }
            });
          },

          cancel() {
            // Client cancelled - cleanup will happen via abort signal
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
    });
  }

  async function stop(): Promise<void> {
    if (!bunServer) {
      return;
    }

    // Clean up all active subscriptions and close their streams
    for (const { unsubscribe, controller } of subscriptions.values()) {
      unsubscribe();
      try {
        controller.close();
      } catch {
        // Already closed
      }
    }
    subscriptions.clear();

    // Stop the server
    bunServer.stop();
    bunServer = null;
  }

  return {
    start,
    stop,
    url,
  };
}
