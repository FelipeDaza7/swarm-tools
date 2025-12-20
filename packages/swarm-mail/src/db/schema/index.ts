/**
 * Barrel export for all Drizzle schemas.
 * 
 * This will re-export:
 * - memory/* - semantic memory tables (memories, embeddings)
 * - streams/* - event sourcing tables (events, projections, cursors)
 * - hive/* - work item tracking tables (cells, dependencies)
 */

// Memory subsystem
export { memories, type Memory, type NewMemory } from "./memory.js";

// Streams subsystem
export {
  agentsTable,
  cursorsTable,
  eventsTable,
  locksTable,
  messagesTable,
  reservationsTable,
} from "./streams.js";

// Hive subsystem (work item tracking)
export {
  beads,
  beadComments,
  beadDependencies,
  beadLabels,
  blockedBeadsCache,
  cellComments,
  cellDependencies,
  cellEvents,
  cellLabels,
  cells,
  dirtyBeads,
  schemaVersion,
  type Bead,
  type BeadComment,
  type BeadDependency,
  type BeadLabel,
  type BlockedBeadCache,
  type Cell,
  type CellComment,
  type CellDependency,
  type CellEvent,
  type CellLabel,
  type DirtyBead,
  type NewBead,
  type NewBeadComment,
  type NewBeadDependency,
  type NewBeadLabel,
  type NewBlockedBeadCache,
  type NewCell,
  type NewCellComment,
  type NewCellDependency,
  type NewCellEvent,
  type NewCellLabel,
  type NewDirtyBead,
} from "./hive.js";
