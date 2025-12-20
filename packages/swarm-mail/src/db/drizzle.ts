import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema/index.js";

/**
 * Creates a Drizzle ORM client from a libSQL client instance.
 * 
 * @param client - libSQL client (from createClient)
 * @returns Drizzle database instance with schema
 * 
 * @example
 * ```typescript
 * import { createClient } from "@libsql/client";
 * import { createDrizzleClient } from "./drizzle.js";
 * 
 * const client = createClient({ url: ":memory:" });
 * const db = createDrizzleClient(client);
 * 
 * await db.select().from(schema.messages);
 * ```
 */
export function createDrizzleClient(client: Client) {
  return drizzle(client, { schema });
}

export type DrizzleClient = ReturnType<typeof createDrizzleClient>;
