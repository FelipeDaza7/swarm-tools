/**
 * Durable Streams Adapter Tests
 *
 * TDD tests for the Durable Streams protocol adapter.
 * This adapter exposes swarm-mail events via the Durable Streams protocol
 * for real-time visualization.
 *
 * Protocol: https://github.com/durable-streams/durable-streams
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createInMemorySwarmMailLibSQL } from "../libsql.convenience.js";
import { appendEvent } from "./store-drizzle.js";
import { createEvent } from "./events.js";
import type { SwarmMailAdapter } from "../types/adapter.js";
import {
  createDurableStreamAdapter,
  type DurableStreamAdapter,
  type StreamEvent,
} from "./durable-adapter.js";

describe("DurableStreamAdapter", () => {
  let swarmMail: SwarmMailAdapter;
  let adapter: DurableStreamAdapter;
  const projectKey = "/test/project";

  beforeAll(async () => {
    swarmMail = await createInMemorySwarmMailLibSQL("durable-adapter-test");
    adapter = createDurableStreamAdapter(swarmMail, projectKey);
  });

  afterAll(async () => {
    await swarmMail.close();
  });

  describe("head()", () => {
    test("returns 0 when no events exist", async () => {
      const head = await adapter.head();
      expect(head).toBe(0);
    });

    test("returns latest sequence after events are appended", async () => {
      // Append some events using the adapter method
      await swarmMail.appendEvent(
        createEvent("agent_registered", {
          project_key: projectKey,
          agent_name: "TestAgent",
          program: "opencode",
          model: "test",
        }),
      );

      const head = await adapter.head();
      expect(head).toBeGreaterThan(0);
    });
  });

  describe("read()", () => {
    test("reads events from offset 0", async () => {
      const events = await adapter.read(0, 10);
      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThan(0);
    });

    test("returns StreamEvent format with offset, data, timestamp", async () => {
      const events = await adapter.read(0, 1);
      expect(events.length).toBeGreaterThan(0);

      const event = events[0];
      expect(event).toHaveProperty("offset");
      expect(event).toHaveProperty("data");
      expect(event).toHaveProperty("timestamp");
      expect(typeof event.offset).toBe("number");
      expect(typeof event.data).toBe("string");
      expect(typeof event.timestamp).toBe("number");
    });

    test("data field contains valid JSON", async () => {
      const events = await adapter.read(0, 1);
      const event = events[0];

      const parsed = JSON.parse(event.data);
      expect(parsed).toHaveProperty("type");
      expect(parsed.type).toBe("agent_registered");
    });

    test("respects limit parameter", async () => {
      // Add more events
      for (let i = 0; i < 5; i++) {
        await swarmMail.appendEvent(
          createEvent("agent_active", {
            project_key: projectKey,
            agent_name: `Agent${i}`,
          }),
        );
      }

      const events = await adapter.read(0, 3);
      expect(events.length).toBe(3);
    });

    test("reads from specific offset (offset-based pagination)", async () => {
      const allEvents = await adapter.read(0, 100);
      expect(allEvents.length).toBeGreaterThan(3);

      // Read from offset 2 (should skip first 2 events)
      const fromOffset = await adapter.read(2, 100);
      expect(fromOffset.length).toBe(allEvents.length - 2);
      expect(fromOffset[0].offset).toBe(3);
    });

    test("returns empty array when offset is beyond head", async () => {
      const head = await adapter.head();
      const events = await adapter.read(head + 100, 10);
      expect(events).toEqual([]);
    });
  });

  describe("subscribe()", () => {
    test("calls callback for new events", async () => {
      const receivedEvents: StreamEvent[] = [];

      const unsubscribe = adapter.subscribe((event) => {
        receivedEvents.push(event);
      });

      // Append a new event
      await swarmMail.appendEvent(
        createEvent("task_started", {
          project_key: projectKey,
          agent_name: "SubscribeTest",
          bead_id: "test-bead-1",
        }),
      );

      // Give it a moment to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(receivedEvents.length).toBeGreaterThan(0);
      const lastEvent = receivedEvents[receivedEvents.length - 1];
      expect(lastEvent).toHaveProperty("offset");
      expect(lastEvent).toHaveProperty("data");

      unsubscribe();
    });

    test("unsubscribe stops receiving events", async () => {
      const receivedEvents: StreamEvent[] = [];

      const unsubscribe = adapter.subscribe((event) => {
        receivedEvents.push(event);
      });

      unsubscribe();

      const countBefore = receivedEvents.length;

      // Append event after unsubscribe
      await swarmMail.appendEvent(
        createEvent("task_completed", {
          project_key: projectKey,
          agent_name: "UnsubscribeTest",
          bead_id: "test-bead-2",
          summary: "Done",
          success: true,
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(receivedEvents.length).toBe(countBefore);
    });
  });

  describe("project filtering", () => {
    test("only returns events for the configured project", async () => {
      // Add event for different project
      await swarmMail.appendEvent(
        createEvent("agent_registered", {
          project_key: "/other/project",
          agent_name: "OtherAgent",
          program: "opencode",
          model: "test",
        }),
      );

      const events = await adapter.read(0, 100);

      // All events should be for our project
      for (const event of events) {
        const parsed = JSON.parse(event.data);
        expect(parsed.project_key).toBe(projectKey);
      }
    });
  });
});

describe("StreamEvent format", () => {
  test("offset is the event sequence number", async () => {
    const swarmMail = await createInMemorySwarmMailLibSQL("format-test");
    const projectKey = "/format/test";
    const adapter = createDurableStreamAdapter(swarmMail, projectKey);

    await swarmMail.appendEvent(
      createEvent("agent_registered", {
        project_key: projectKey,
        agent_name: "FormatTest",
        program: "opencode",
        model: "test",
      }),
    );

    const events = await adapter.read(0, 1);
    expect(events[0].offset).toBe(1); // First event has sequence 1

    await swarmMail.close();
  });
});
