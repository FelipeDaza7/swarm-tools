# swarm-mail

```
                                _.------._
                               .'   .--.   '.        🐝
                              /   .'    '.   \    🐝
                             |   /   __   \   |      🐝
       🐝                    |  |   (  )   |  |  🐝
            🐝    _  _       |  |   |__|   |  |
                 ( \/ )       \  '.      .'  /    🐝
       🐝    ____/    \____    '.  '----'  .'
           /    \    /    \     '-._____.-'           🐝
          /  ()  \  /  ()  \
         |   /\   ||   /\   |     ███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗
         |  /__\  ||  /__\  |     ██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║
          \      /  \      /      ███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║
       🐝  '----'    '----'       ╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║
                                  ███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
             🐝                   ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝
                    🐝
       🐝                         ███╗   ███╗ █████╗ ██╗██╗
                                  ████╗ ████║██╔══██╗██║██║         🐝
            🐝                    ██╔████╔██║███████║██║██║
                                  ██║╚██╔╝██║██╔══██║██║██║    🐝
       🐝        🐝               ██║ ╚═╝ ██║██║  ██║██║███████╗
                                  ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝╚══════╝       🐝
                 🐝
                             ⚡ Event Sourcing + Actor Model Primitives ⚡
```

Event sourcing and actor-model primitives for multi-agent coordination. Built on **libSQL** (embedded SQLite) with **Drizzle ORM**. Local-first, no external servers.

**[🌐 swarmtools.ai](https://swarmtools.ai)** | **[📖 Full Documentation](https://swarmtools.ai/docs)**

## What is swarm-mail?

A TypeScript library providing:

1. **Event Store** - Append-only log with automatic projection updates (agents, messages, file reservations)
2. **Actor Primitives** - DurableMailbox, DurableLock, DurableCursor, DurableDeferred (Effect-TS based)
3. **Hive** - Git-synced work item tracker (cells, epics, dependencies)
4. **Semantic Memory** - Vector embeddings for persistent agent learnings (Ollama + pgvector)

```
┌─────────────────────────────────────────────────────────────┐
│                     SWARM MAIL STACK                        │
├─────────────────────────────────────────────────────────────┤
│  COORDINATION                                               │
│  ├── HiveAdapter - Work item tracking (cells, epics)       │
│  └── ask<Req, Res>() - Request/Response (RPC-style)        │
│                                                             │
│  PATTERNS                                                   │
│  ├── DurableMailbox - Actor inbox with typed envelopes     │
│  └── DurableLock - CAS-based mutual exclusion              │
│                                                             │
│  PRIMITIVES                                                 │
│  ├── DurableCursor - Checkpointed stream reader            │
│  └── DurableDeferred - Distributed promise                 │
│                                                             │
│  MEMORY                                                     │
│  └── Semantic Memory - Vector embeddings (pgvector/Ollama) │
│                                                             │
│  STORAGE                                                    │
│  └── libSQL (Embedded SQLite via Drizzle ORM)              │
└─────────────────────────────────────────────────────────────┘
```

## Event Flow Architecture

Shows how agent actions flow from tool calls → libSQL events → CLI queries/dashboards.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         EVENT FLOW: Agent → libSQL → CLI                 │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────┐                                                 │
│  │   AGENT (Worker)    │                                                 │
│  │  ┌───────────────┐  │  Tool Calls (via OpenCode MCP):                │
│  │  │ swarmmail_*   │  │  ├─ swarmmail_init()                           │
│  │  │ hive_*        │  │  ├─ swarmmail_reserve(["src/auth.ts"])         │
│  │  │ swarm_*       │  │  ├─ swarm_progress(progress=50)                │
│  │  └───────┬───────┘  │  └─ swarm_complete(...)                        │
│  └──────────┼──────────┘                                                 │
│             │                                                            │
│             ▼                                                            │
│  ┌──────────────────────────────────────────────────────────────┐        │
│  │              SWARM-MAIL ADAPTER LAYER                        │        │
│  │  (packages/swarm-mail/src/adapter.ts)                        │        │
│  │                                                              │        │
│  │  ┌────────────────────────────────────────────────────────┐  │        │
│  │  │ appendEvent(event: SwarmMailEvent)                     │  │        │
│  │  │  ├─ Validate with Zod schemas                          │  │        │
│  │  │  ├─ Serialize to JSON (data field)                     │  │        │
│  │  │  └─ INSERT into events table                           │  │        │
│  │  └────────────────────────────────────────────────────────┘  │        │
│  │                                                              │        │
│  │  ┌────────────────────────────────────────────────────────┐  │        │
│  │  │ Query Helpers (read from projections)                  │  │        │
│  │  │  ├─ getInbox() → messages table                        │  │        │
│  │  │  ├─ getReservations() → reservations table             │  │        │
│  │  │  └─ getSwarmContext() → swarm_contexts table           │  │        │
│  │  └────────────────────────────────────────────────────────┘  │        │
│  └──────────────────────┬───────────────────────────────────────┘        │
│                         │                                                │
│                         ▼                                                │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                   libSQL DATABASE                                │    │
│  │  (SQLite embedded, no server needed)                             │    │
│  │  ~/.config/swarm-tools/libsql/<project-hash>/swarm.db            │    │
│  │                                                                  │    │
│  │  ┌────────────────────────────────────────────────────────────┐  │    │
│  │  │ events (append-only log)                                   │  │    │
│  │  │ ┌──────┬──────┬──────────┬──────────┬──────────┬─────────┐ │  │    │
│  │  │ │  id  │ type │timestamp │project_key│ sequence │  data   │ │  │    │
│  │  │ ├──────┼──────┼──────────┼──────────┼──────────┼─────────┤ │  │    │
│  │  │ │  1   │ agent│170300123 │/proj/path│    1     │ {...}   │ │  │    │
│  │  │ │  2   │ file │170300124 │/proj/path│    2     │ {...}   │ │  │    │
│  │  │ │  3   │ task │170300199 │/proj/path│    3     │ {...}   │ │  │    │
│  │  │ └──────┴──────┴──────────┴──────────┴──────────┴─────────┘ │  │    │
│  │  └────────────────────────────────────────────────────────────┘  │    │
│  │                                                                  │    │
│  │  ┌────────────────────────────────────────────────────────────┐  │    │
│  │  │ PROJECTIONS (materialized views, updated via triggers)     │  │    │
│  │  │                                                            │  │    │
│  │  │ agents          ← agent_registered, agent_active          │  │    │
│  │  │ messages        ← message_sent                            │  │    │
│  │  │ reservations    ← file_reserved, file_released            │  │    │
│  │  │ swarm_contexts  ← swarm_checkpointed                      │  │    │
│  │  │ eval_records    ← eval_captured, eval_scored              │  │    │
│  │  └────────────────────────────────────────────────────────────┘  │    │
│  └──────────────────────┬───────────────────────────────────────────┘    │
│                         │                                                │
│          ┌──────────────┼──────────────┬──────────────┬──────────────┐   │
│          ▼              ▼              ▼              ▼              ▼   │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│   │  swarm   │  │  swarm   │  │  swarm   │  │  swarm   │  │  swarm   │  │
│   │  query   │  │  stats   │  │ dashboard│  │  replay  │  │  export  │  │
│   │  (SQL)   │  │ (counts) │  │   (TUI)  │  │ (replay) │  │ (JSONL)  │  │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│       │              │              │              │              │      │
│       ▼              ▼              ▼              ▼              ▼      │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                   CLI OUTPUT                                     │    │
│  │                                                                  │    │
│  │  📊 Analytics       📈 Dashboards      🔍 Debugging              │    │
│  │  ├─ Event counts    ├─ Live progress  ├─ Event replay           │    │
│  │  ├─ Duration P95    ├─ Agent status   ├─ Agent timeline         │    │
│  │  ├─ Failure rate    ├─ File locks     ├─ Conflict detection     │    │
│  │  └─ Conflict rate   └─ Auto-refresh   └─ Checkpoint history     │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Flow Summary:**

1. **Agent Tool Call** → Agent calls `swarmmail_init()`, `swarm_progress()`, etc.
2. **Adapter Layer** → Validates with Zod, serializes to JSON, appends to `events` table
3. **libSQL Storage** → Events stored in append-only log, projections auto-updated
4. **CLI Tools** → Query events/projections for analytics, monitoring, debugging
5. **Observability** → Full audit trail, replay, real-time dashboards

## Install

```bash
bun add swarm-mail
```

## Quick Start

```typescript
import { getSwarmMailLibSQL } from "swarm-mail";

// Create swarm mail instance (libSQL + Drizzle)
const swarmMail = await getSwarmMailLibSQL("/my/project");

// Append events
await swarmMail.appendEvent({
  type: "agent_registered",
  agent_name: "WorkerA",
  task_description: "Implementing auth",
  timestamp: Date.now(),
});

// Query projections
const agents = await swarmMail.getAgents();
const messages = await swarmMail.getInbox("WorkerA", { limit: 5 });

// Clean shutdown
await swarmMail.close();
```

## Core APIs

### Event Store

Append-only event log with automatic projection updates:

```typescript
import { getSwarmMailLibSQL } from "swarm-mail";

const swarmMail = await getSwarmMailLibSQL("/my/project");

// Append events
await swarmMail.appendEvent({
  type: "message_sent",
  from: "WorkerA",
  to: ["WorkerB"],
  subject: "Task complete",
  body: "Auth flow implemented",
  timestamp: Date.now(),
});

// Query inbox
const messages = await swarmMail.getInbox("WorkerB", { 
  limit: 5,
  unreadOnly: true 
});

// Get thread
const thread = await swarmMail.getThread("epic-123");

// Check file reservations
const conflicts = await swarmMail.checkConflicts([
  "src/auth.ts"
], "WorkerA");
```

### Hive (Work Item Tracker)

Git-synced work item tracking with cells and epics:

```typescript
import { createHiveAdapter } from "swarm-mail";

const hive = await createHiveAdapter({ 
  projectPath: "/my/project" 
});

// Create cell
const cell = await hive.createCell({
  title: "Add OAuth",
  type: "feature",
  priority: 2,
});

// Query cells
const open = await hive.queryCells({ status: "open" });
const ready = await hive.queryCells({ ready: true });

// Update cell
await hive.updateCell(cell.id, { 
  status: "in_progress",
  description: "Implementing Google OAuth flow"
});

// Close cell
await hive.closeCell(cell.id, "Completed: OAuth implemented");
```

### Semantic Memory

Vector embeddings for persistent agent learnings:

```typescript
import { createSemanticMemory } from "swarm-mail";

const memory = await createSemanticMemory("/my/project");

// Store a learning
const { id } = await memory.store(
  "OAuth refresh tokens need 5min buffer before expiry to avoid race conditions",
  { tags: "auth,tokens,debugging" }
);

// Search by meaning (vector similarity)
const results = await memory.find("token refresh issues", { limit: 5 });

// Get memory by ID
const mem = await memory.get(id);

// Validate (resets decay timer)
await memory.validate(id);

// Check Ollama health
const health = await memory.checkHealth();
// { ollama: true, model: "mxbai-embed-large" }
```

> **Note:** Requires [Ollama](https://ollama.ai/) for vector embeddings. Falls back to full-text search if unavailable.
>
> ```bash
> ollama pull mxbai-embed-large
> ```

### Custom Database Setup

Bring your own libSQL database:

```typescript
import { createLibSQLAdapter } from "swarm-mail";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

// Create libSQL client
const client = createClient({
  url: "file:///my/custom/path/swarm.db"
});

const db = drizzle(client);

// Create adapter
const swarmMail = createLibSQLAdapter(db, "/my/project");

// Use as normal
await swarmMail.appendEvent({
  type: "agent_registered",
  agent_name: "CustomAgent",
  timestamp: Date.now(),
});
```

## Event Schema

All swarm coordination is recorded as immutable events in libSQL. Events are **append-only** - nothing is deleted, everything is auditable.

### Event Store Table

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                    -- Event type discriminator
  project_key TEXT NOT NULL,             -- Project path (for multi-project isolation)
  timestamp INTEGER NOT NULL,            -- Unix ms
  sequence INTEGER GENERATED ALWAYS AS (id) STORED,
  data TEXT NOT NULL,                    -- JSON payload (event-specific fields)
  created_at TEXT DEFAULT (datetime('now'))
);

-- Fast queries via composite indexes
CREATE INDEX idx_events_project_key ON events(project_key);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_timestamp ON events(timestamp);
CREATE INDEX idx_events_project_type ON events(project_key, type);
```

### Event Types

**Agent Lifecycle:**
```typescript
{ type: "agent_registered"; agent_name: string; program?: string; model?: string; task_description?: string }
{ type: "agent_active"; agent_name: string }
```

**Messages:**
```typescript
{ type: "message_sent"; message_id: number; from_agent: string; to_agents: string[]; subject: string; body: string; thread_id?: string; importance?: "low" | "normal" | "high" | "urgent" }
{ type: "message_read"; message_id: number; agent_name: string }
{ type: "message_acked"; message_id: number; agent_name: string }
```

**File Reservations:**
```typescript
{ type: "file_reserved"; reservation_id: number; agent_name: string; paths: string[]; reason?: string; exclusive: boolean; ttl_seconds: number; expires_at: number }
{ type: "file_released"; agent_name: string; paths?: string[]; reservation_ids?: number[] }
```

**Task Tracking:**
```typescript
{ type: "task_started"; agent_name: string; bead_id: string; epic_id?: string }
{ type: "task_progress"; agent_name: string; bead_id: string; progress_percent?: number; message?: string; files_touched?: string[] }
{ type: "task_completed"; agent_name: string; bead_id: string; summary: string; files_touched?: string[]; success: boolean }
{ type: "task_blocked"; agent_name: string; bead_id: string; reason: string }
```

**Swarm Coordination:**
```typescript
{ type: "swarm_checkpointed"; epic_id: string; progress: number; state: object }
{ type: "decomposition_generated"; epic_id: string; subtasks: object[]; strategy: string }
{ type: "subtask_outcome"; bead_id: string; success: boolean; duration_ms: number; error_count?: number; retry_count?: number }
```

**Eval & Learning:**
```typescript
{ type: "eval_captured"; eval_id: string; epic_id: string; prompt: string; response: string; criteria: object[] }
{ type: "eval_scored"; eval_id: string; scores: object[] }
{ type: "eval_finalized"; eval_id: string; final_score: number; passing: boolean }
```

**Session Capture:**
```typescript
{ type: "session_event"; session_id: string; event_type: "DECISION" | "VIOLATION" | "OUTCOME" | "COMPACTION"; event_data: object }
```

## libSQL Query Examples

All state is derived from events via **projections** (materialized views). Query the event store directly or use projections for common patterns.

### Agent Queries

```typescript
// Who's registered in this project?
const agents = await swarmMail.getAgents();
// SELECT * FROM agents WHERE project_key = ? ORDER BY registered_at

// Get specific agent details
const agent = await swarmMail.getAgent("WorkerBee");
// SELECT * FROM agents WHERE project_key = ? AND name = ?

// Debug agent activity
const debug = await swarmMail.debugAgent("WorkerBee");
// Returns: { agent, messages_sent, messages_received, reservations, recent_events }
```

**Raw SQL examples:**

```sql
-- All agents in project
SELECT name, program, model, task_description, registered_at
FROM agents
WHERE project_key = '/path/to/project'
ORDER BY last_active_at DESC;

-- Agents active in last hour
SELECT name, last_active_at
FROM agents
WHERE project_key = '/path/to/project'
  AND last_active_at > (strftime('%s', 'now') - 3600) * 1000;
```

### Message Queries

```typescript
// Get inbox (materialized view)
const messages = await swarmMail.getInbox("WorkerBee", { 
  limit: 5, 
  unreadOnly: true 
});
// SELECT * FROM messages WHERE ... ORDER BY sent_at DESC LIMIT 5

// Get thread (all messages with same thread_id)
const thread = await swarmMail.getThread("epic-123");
// SELECT * FROM messages WHERE thread_id = ? ORDER BY sent_at

// Mark as read
await swarmMail.appendEvent({
  type: "message_read",
  message_id: 42,
  agent_name: "WorkerBee",
  timestamp: Date.now(),
});
```

**Raw SQL examples:**

```sql
-- Unread messages for agent
SELECT m.id, m.subject, m.from_agent, m.sent_at, m.importance
FROM messages m
LEFT JOIN message_reads mr 
  ON mr.message_id = m.id AND mr.agent_name = 'WorkerBee'
WHERE m.project_key = '/path/to/project'
  AND EXISTS (
    SELECT 1 FROM message_recipients 
    WHERE message_id = m.id AND recipient_name = 'WorkerBee'
  )
  AND mr.id IS NULL
ORDER BY m.sent_at DESC;

-- Thread view with participants
SELECT m.id, m.subject, m.from_agent, m.body, m.sent_at,
       GROUP_CONCAT(mr.recipient_name) as recipients
FROM messages m
LEFT JOIN message_recipients mr ON mr.message_id = m.id
WHERE m.thread_id = 'epic-123'
GROUP BY m.id
ORDER BY m.sent_at;

-- Message traffic by importance
SELECT importance, COUNT(*) as count
FROM messages
WHERE project_key = '/path/to/project'
  AND sent_at > (strftime('%s', 'now') - 86400) * 1000  -- last 24h
GROUP BY importance;
```

### File Reservation Queries

```typescript
// Check for conflicts before reserving
const conflicts = await swarmMail.checkConflicts(
  ["src/auth.ts", "src/db.ts"], 
  "WorkerBee"
);
// Returns: [{ path, holder, expires_at, exclusive }]

// Get all active reservations
const reservations = await swarmMail.getReservations();
// SELECT * FROM reservations WHERE expires_at > ? ORDER BY created_at

// Get agent's reservations
const myReservations = await swarmMail.getReservationsForAgent("WorkerBee");
// SELECT * FROM reservations WHERE agent_name = ? AND expires_at > ?
```

**Raw SQL examples:**

```sql
-- Active file locks
SELECT agent_name, path_pattern, exclusive, 
       datetime(created_at/1000, 'unixepoch') as locked_at,
       datetime(expires_at/1000, 'unixepoch') as expires
FROM reservations
WHERE project_key = '/path/to/project'
  AND expires_at > (strftime('%s', 'now') * 1000)
ORDER BY created_at;

-- Conflict detection (who holds this path?)
SELECT agent_name, exclusive, expires_at
FROM reservations
WHERE project_key = '/path/to/project'
  AND path_pattern LIKE '%src/auth.ts%'
  AND expires_at > (strftime('%s', 'now') * 1000);

-- Expired reservations (cleanup candidates)
SELECT agent_name, path_pattern, 
       (strftime('%s', 'now') * 1000 - expires_at) / 1000 as expired_seconds_ago
FROM reservations
WHERE project_key = '/path/to/project'
  AND expires_at < (strftime('%s', 'now') * 1000)
ORDER BY expires_at;

-- Reservation timeline (who locked what when?)
SELECT 
  datetime(timestamp/1000, 'unixepoch') as time,
  json_extract(data, '$.agent_name') as agent,
  json_extract(data, '$.paths') as paths,
  json_extract(data, '$.exclusive') as exclusive,
  CASE type
    WHEN 'file_reserved' THEN '🔒 LOCK'
    WHEN 'file_released' THEN '🔓 RELEASE'
  END as action
FROM events
WHERE project_key = '/path/to/project'
  AND type IN ('file_reserved', 'file_released')
ORDER BY timestamp DESC
LIMIT 20;
```

### Task Progress Queries

```typescript
// Get swarm checkpoint for recovery
const context = await swarmMail.getSwarmContext("epic-123");
// SELECT * FROM swarm_contexts WHERE epic_id = ? ORDER BY version DESC LIMIT 1

// Query events for timeline
const events = await swarmMail.getEvents({ 
  limit: 100, 
  after: lastSequence 
});
// SELECT * FROM events WHERE sequence > ? ORDER BY sequence LIMIT 100
```

**Raw SQL examples:**

```sql
-- Task timeline (start → progress → complete)
SELECT 
  datetime(timestamp/1000, 'unixepoch') as time,
  type,
  json_extract(data, '$.agent_name') as agent,
  json_extract(data, '$.bead_id') as task,
  json_extract(data, '$.progress_percent') as progress,
  json_extract(data, '$.message') as status
FROM events
WHERE project_key = '/path/to/project'
  AND type IN ('task_started', 'task_progress', 'task_completed', 'task_blocked')
  AND json_extract(data, '$.epic_id') = 'epic-123'
ORDER BY timestamp;

-- Task outcomes (success vs failure)
SELECT 
  json_extract(data, '$.bead_id') as task,
  json_extract(data, '$.success') as success,
  json_extract(data, '$.duration_ms') as duration,
  json_extract(data, '$.error_count') as errors,
  datetime(timestamp/1000, 'unixepoch') as completed_at
FROM events
WHERE type = 'task_completed'
  AND json_extract(data, '$.epic_id') = 'epic-123'
ORDER BY timestamp;

-- Checkpoint history (resume points)
SELECT version, progress, 
       datetime(created_at/1000, 'unixepoch') as checkpoint_time,
       json_extract(state, '$.files_touched') as files
FROM swarm_contexts
WHERE epic_id = 'epic-123'
ORDER BY version DESC;
```

### Analytics Queries

**Four Golden Signals** for observability:

```sql
-- 1. LATENCY - Task duration distribution
SELECT 
  CAST(json_extract(data, '$.duration_ms') / 1000.0 AS INT) as seconds,
  COUNT(*) as tasks,
  ROUND(AVG(json_extract(data, '$.duration_ms')), 0) as avg_ms
FROM events
WHERE type = 'task_completed'
  AND json_extract(data, '$.success') = 1
GROUP BY seconds
ORDER BY seconds;

-- 2. TRAFFIC - Events per hour
SELECT 
  strftime('%Y-%m-%d %H:00', datetime(timestamp/1000, 'unixepoch')) as hour,
  type,
  COUNT(*) as count
FROM events
WHERE timestamp > (strftime('%s', 'now') - 86400) * 1000  -- last 24h
GROUP BY hour, type
ORDER BY hour DESC, count DESC;

-- 3. ERRORS - Failure analysis
SELECT 
  json_extract(data, '$.bead_id') as task,
  json_extract(data, '$.error_count') as errors,
  json_extract(data, '$.retry_count') as retries,
  json_extract(data, '$.files_touched') as files,
  datetime(timestamp/1000, 'unixepoch') as failed_at
FROM events
WHERE type = 'task_completed'
  AND json_extract(data, '$.success') = 0
ORDER BY timestamp DESC
LIMIT 10;

-- 4. SATURATION - File contention
SELECT 
  json_extract(data, '$.paths') as file_path,
  COUNT(DISTINCT json_extract(data, '$.agent_name')) as agent_count,
  COUNT(*) as reservation_attempts,
  GROUP_CONCAT(json_extract(data, '$.agent_name')) as competing_agents
FROM events
WHERE type = 'file_reserved'
  AND timestamp > (strftime('%s', 'now') - 3600) * 1000  -- last hour
GROUP BY file_path
HAVING agent_count > 1
ORDER BY reservation_attempts DESC;
```

### Debugging Queries

```sql
-- Agent activity timeline
SELECT 
  datetime(timestamp/1000, 'unixepoch') as time,
  type,
  CASE 
    WHEN type = 'agent_registered' THEN 'Registered: ' || json_extract(data, '$.task_description')
    WHEN type = 'message_sent' THEN 'Sent: ' || json_extract(data, '$.subject')
    WHEN type = 'file_reserved' THEN 'Locked: ' || json_extract(data, '$.paths')
    WHEN type = 'task_completed' THEN 'Completed: ' || json_extract(data, '$.bead_id')
    ELSE type
  END as activity
FROM events
WHERE json_extract(data, '$.agent_name') = 'WorkerBee'
ORDER BY timestamp DESC
LIMIT 50;

-- Find stuck tasks (started but not completed)
SELECT 
  started.timestamp as started_at,
  json_extract(started.data, '$.bead_id') as task,
  json_extract(started.data, '$.agent_name') as agent,
  (strftime('%s', 'now') * 1000 - started.timestamp) / 60000.0 as minutes_ago
FROM events started
WHERE started.type = 'task_started'
  AND NOT EXISTS (
    SELECT 1 FROM events completed
    WHERE completed.type IN ('task_completed', 'task_blocked')
      AND json_extract(completed.data, '$.bead_id') = json_extract(started.data, '$.bead_id')
  )
ORDER BY started.timestamp DESC;

-- Message response times
SELECT 
  sent.id,
  sent.subject,
  sent.from_agent,
  read.agent_name as reader,
  (read_evt.timestamp - sent.sent_at) / 1000.0 as response_time_seconds
FROM messages sent
JOIN message_reads read ON read.message_id = sent.id
JOIN events read_evt ON read_evt.type = 'message_read' 
  AND json_extract(read_evt.data, '$.message_id') = sent.id
WHERE sent.importance IN ('high', 'urgent')
ORDER BY response_time_seconds DESC
LIMIT 10;
```

## Projections

Materialized views automatically updated from events via triggers:

| Projection          | Description                        | Updated By |
| ------------------- | ---------------------------------- | ---------- |
| `agents`            | Active agents per project          | `agent_registered`, `agent_active` |
| `messages`          | Agent inbox/outbox with recipients | `message_sent` |
| `message_recipients`| Many-to-many message targets       | `message_sent` |
| `message_reads`     | Read receipts                      | `message_read` |
| `reservations`      | Current file locks with TTL        | `file_reserved`, `file_released` |
| `swarm_contexts`    | Checkpoint state for recovery      | `swarm_checkpointed` |
| `eval_records`      | Outcome data for learning          | `eval_captured`, `eval_scored`, `eval_finalized` |

## Testing

For tests, use in-memory instances:

```typescript
import { createInMemorySwarmMail } from "swarm-mail";

describe("my feature", () => {
  let swarmMail: SwarmMailAdapter;

  beforeAll(async () => {
    swarmMail = await createInMemorySwarmMail("test");
  });

  afterAll(async () => {
    await swarmMail.close();
  });

  test("appends events", async () => {
    const result = await swarmMail.appendEvent({
      type: "agent_registered",
      agent_name: "TestAgent",
      timestamp: Date.now(),
    });
    
    expect(result.id).toBeGreaterThan(0);
  });
});
```

## Architecture

- **Event Sourcing** - Append-only log, projections are derived
- **Local-first** - libSQL embedded SQLite, no external servers
- **Type-safe** - TypeScript with Zod validation and Drizzle ORM
- **Effect-TS** - Composable, testable actor primitives
- **Git-synced** - Hive cells stored as JSON + git for team coordination

## Migration from v0.31

If you're migrating from PGLite-based swarm-mail:

```typescript
// OLD (v0.31)
import { getSwarmMail } from "swarm-mail";
const swarmMail = await getSwarmMail("/my/project");

// NEW (v0.32+)
import { getSwarmMailLibSQL } from "swarm-mail";
const swarmMail = await getSwarmMailLibSQL("/my/project");
```

**Key changes:**
- Storage backend: PGLite → libSQL (SQLite-compatible)
- ORM: Raw SQL → Drizzle ORM
- Main export: `getSwarmMailLibSQL` (was `getSwarmMail`)
- Semantic memory: Embedded (was standalone MCP server)

See [CHANGELOG.md](./CHANGELOG.md) for full migration guide.

## API Reference

For complete API documentation, see [swarmtools.ai/docs](https://swarmtools.ai/docs).

### SwarmMailAdapter

```typescript
interface SwarmMailAdapter {
  // Events
  appendEvent(event: SwarmMailEvent): Promise<{ id: number; sequence: number }>;
  getEvents(options?: {
    limit?: number;
    after?: number;
  }): Promise<StoredEvent[]>;

  // Agents
  getAgents(): Promise<Agent[]>;
  getAgent(name: string): Promise<Agent | null>;

  // Messages
  getInbox(agent: string, options?: InboxOptions): Promise<Message[]>;
  getMessage(id: number): Promise<Message | null>;
  getThread(threadId: string): Promise<Message[]>;

  // Reservations
  getReservations(): Promise<Reservation[]>;
  getReservationsForAgent(agent: string): Promise<Reservation[]>;
  checkConflicts(paths: string[], excludeAgent?: string): Promise<Conflict[]>;

  // Swarm Context
  getSwarmContext(epicId: string): Promise<SwarmContext | null>;

  // Debug
  debugEvents(options?: DebugOptions): Promise<DebugEvent[]>;
  debugAgent(name: string): Promise<AgentDebugInfo>;
}
```

## Session Indexing

Cross-agent session search and indexing layer for multi-agent conversation history.

**Inspired by [CASS (coding_agent_session_search)](https://github.com/Dicklesworthstone/coding_agent_session_search) by Dicklesworthstone** - we've adapted the session indexing concepts for TypeScript + libSQL.

```
┌─────────────────────────────────────────────────────────────┐
│              SESSION INDEXING ARCHITECTURE                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐                                           │
│  │ Agent Logs   │  (OpenCode, Cursor, Claude, etc.)        │
│  │  ~/.config/  │                                           │
│  │  *.jsonl     │                                           │
│  └──────┬───────┘                                           │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────────────────────────────────┐               │
│  │ SessionParser (JSONL → Normalized)       │               │
│  │  ├─ Line-by-line parsing                │               │
│  │  └─ Multi-agent format detection        │               │
│  └──────────────┬───────────────────────────┘               │
│                 │                                           │
│                 ▼                                           │
│  ┌──────────────────────────────────────────┐               │
│  │ ChunkProcessor (Message-level chunks)    │               │
│  │  ├─ Sliding window (512 token chunks)    │               │
│  │  ├─ Ollama embeddings (mxbai-embed-large)│               │
│  │  └─ Store in semantic-memory             │               │
│  └──────────────┬───────────────────────────┘               │
│                 │                                           │
│                 ▼                                           │
│  ┌──────────────────────────────────────────┐               │
│  │ libSQL Storage (via semantic-memory)     │               │
│  │  ├─ memories table (vector search)       │               │
│  │  ├─ metadata (agent, session, timestamp) │               │
│  │  └─ pgvector similarity search           │               │
│  └──────────────┬───────────────────────────┘               │
│                 │                                           │
│                 ▼                                           │
│  ┌──────────────────────────────────────────┐               │
│  │ StalenessDetector (index freshness)      │               │
│  │  ├─ Track indexed sessions + mtimes      │               │
│  │  ├─ Detect new/modified files            │               │
│  │  └─ Trigger re-indexing when needed      │               │
│  └──────────────┬───────────────────────────┘               │
│                 │                                           │
│                 ▼                                           │
│  ┌──────────────────────────────────────────┐               │
│  │ Search API (cass_* plugin tools)         │               │
│  │  ├─ Semantic search (vector similarity)  │               │
│  │  ├─ Full-text search (FTS5)              │               │
│  │  ├─ Pagination + field projection        │               │
│  │  └─ Session viewer (expand context)      │               │
│  └──────────────────────────────────────────┘               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Components

| Component | Purpose | Key Methods |
|-----------|---------|-------------|
| **ChunkProcessor** | Message-level chunking + embedding | `processMessage()`, `generateEmbedding()` |
| **SessionParser** | JSONL → NormalizedMessage | `parseLine()`, `detectAgent()` |
| **SessionViewer** | Line-by-line JSONL reader | `readLines()`, `expandContext()` |
| **StalenessDetector** | Index freshness tracking | `recordIndexed()`, `checkStaleness()` |
| **Pagination** | Field projection for compact output | `projectSearchResult()`, `FIELD_SETS` |

### Usage

```typescript
import { ChunkProcessor, StalenessDetector } from "swarm-mail";
import { createSemanticMemory } from "swarm-mail";

// 1. Initialize semantic memory (vector store)
const memory = await createSemanticMemory("/my/project");

// 2. Create chunk processor
const processor = new ChunkProcessor(memory);

// 3. Process a session message
const chunks = await processor.processMessage({
  session_id: "abc123",
  agent: "opencode",
  timestamp: Date.now(),
  role: "assistant",
  content: "Message text...",
});

// 4. Search across indexed sessions
const results = await memory.find("authentication error", { limit: 5 });

// 5. Check if re-indexing needed
const detector = new StalenessDetector(memory);
await detector.recordIndexed("/path/to/session.jsonl", Date.now());
const isStale = await detector.checkStaleness("/path/to/session.jsonl");
```

### Plugin Integration

The session indexing layer powers the `cass_*` plugin tools (see AGENTS.md):

- `cass_search` - Search across all agent histories
- `cass_view` - View specific session
- `cass_expand` - Expand context around line
- `cass_index` - Build/rebuild index
- `cass_health` - Check index readiness
- `cass_stats` - Show index statistics

**Before solving problems from scratch, query the index** - another agent may have already solved it.

## Resources

- **Documentation:** [swarmtools.ai/docs](https://swarmtools.ai/docs)
- **Architecture:** [SWARM-CONTEXT.md](../../SWARM-CONTEXT.md)
- **Examples:** [examples/](../../examples/)
- **Changelog:** [CHANGELOG.md](./CHANGELOG.md)

## License

MIT
