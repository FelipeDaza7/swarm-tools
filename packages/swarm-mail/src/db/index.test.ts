import { describe, expect, test } from "bun:test";
import * as dbModule from "./index.js";

describe("Database Module Exports", () => {
  test("exports client functions", () => {
    expect(typeof dbModule.getDb).toBe("function");
    expect(typeof dbModule.createInMemoryDb).toBe("function");
    expect(typeof dbModule.closeDb).toBe("function");
  });

  test("exports legacy Drizzle wrapper", () => {
    expect(typeof dbModule.createDrizzleClient).toBe("function");
  });

  test("exports schema namespace", () => {
    expect(dbModule.schema).toBeDefined();
    expect(typeof dbModule.schema).toBe("object");
  });
});
