# ADR: Developer Debugging - Verbose Modes, Replay & State Dumps

**Date:** 2025-12-22  
**Epic:** opencode-swarm-monorepo-lf2p4u-mjhji3rrl06  
**Status:** Research Complete  
**Author:** BrightOcean

---

## Executive Summary

**Question:** How do developers debug swarms when coordination fails? What tools enable investigation of multi-agent execution without cluttering AI context?

**Answer:** Event sourcing is already 80% of the solution. We need **diagnostic views** over existing infrastructure, not new logging systems.

| Approach | Feasibility | Value | Effort |
|----------|-------------|-------|--------|
| **Event Replay** | ✅ High - already implemented | High - reproduce failures | 1 day |
| **Verbose ENV vars** | ✅ High - simple filtering | Medium - adds context noise | 2 days |
| **State Dumps** | ✅ High - query projections | High - snapshot debugging | 1 day |
| **Step-through Debug** | ⚠️ Medium - requires REPL | Low - breaks async coordination | 5+ days |
| **Error Context Enrichment** | ✅ High - structured errors | High - prevents info loss | 3 days |

**Recommendation:** Build diagnostic CLI + structured error enrichment. Ship in 1 week.

---

## 1. Problem Statement

### Current State: Blind Execution

Developers debugging swarms today:

1. **Launch swarm** → agents spawn, work in parallel
2. **Wait for completion** → no visibility into progress
3. **Check hive status** → see final state only
4. **If failed:** Read swarm mail messages, guess what went wrong

**Pain points:**
- No real-time visibility into agent coordination
- Errors buried in swarm mail threads (pagination required)
- Can't reproduce failures deterministically
- Context overflow when dumping full event log to AI
- Non-determinism (LLM responses, timing) prevents perfect replay

### Desired State: Observable Swarms

Developers should be able to:

1. **Watch swarms in real-time** - progress, messages, reservations
2. **Replay failed swarms** - reproduce issues locally (within LLM non-determinism limits)
3. **Dump state at any point** - "what was the reservation state when agent X tried to reserve file Y?"
4. **Understand failures** - rich error context without reading full event log
5. **Query history** - "show me all file conflicts in the last 10 swarms"

---

## 2. Existing Infrastructure

### Event Sourcing (Already Built)

swarm-mail provides append-only event log with **17 event types**:

**Agent Events:**
- `agent_registered` - agent joins swarm
- `agent_active` - heartbeat/activity

**Message Events:**
- `message_sent` - inter-agent communication
- `message_read` - message consumption
- `message_acked` - acknowledgment

**Reservation Events:**
- `file_reserved` - lock acquisition
- `file_released` - lock release

**Task Events:**
- `task_started` - work begins
- `task_progress` - milestone updates (25%, 50%, 75%)
- `task_completed` - work done
- `task_blocked` - dependency wait

**Learning Events:**
- `decomposition_generated` - epic → subtasks
- `subtask_outcome` - success/failure signals
- `human_feedback` - acceptance/rejection

**Recovery Events:**
- `swarm_checkpointed` - state snapshot at milestones
- `swarm_recovered` - recovery from checkpoint

### Checkpointing (Built for Recovery, Not Debugging)

`swarm_checkpoint` and `swarm_recover` capture:
- Files modified
- Strategy used
- Progress percent
- Directives (shared context, skills)
- Error context (optional)

**Limitation:** Checkpoints are **forward-facing** (recovery), not **backward-facing** (diagnosis).

### Projections (Materialized Views)

libSQL tables updated inline with events:
- `agents` - registered agents, last active
- `messages` - inbox state
- `message_recipients` - read/ack status
- `reservations` - file locks
- `eval_records` - decomposition outcomes
- `swarm_contexts` - checkpoint state

**Limitation:** Projections show **current state**, not **historical transitions**.

---

## 3. Options Evaluated

### Option 1: Verbose Logging (DEBUG=swarm:\*)

**Approach:** Environment variable controls console logging verbosity.

```bash
# No logging (default)
swarm run "Add auth"

# Basic progress
DEBUG=swarm:progress swarm run "Add auth"

# All events
DEBUG=swarm:* swarm run "Add auth"

# Specific subsystem
DEBUG=swarm:reservations,swarm:messages swarm run "Add auth"
```

**Pros:**
- Simple to implement (filter events before console.log)
- Familiar pattern (Node.js debug module)
- Zero overhead when disabled

**Cons:**
- Adds context noise for AI agents (console output goes to context)
- Logs are ephemeral (lost after session ends)
- No structured query ("show me reservation conflicts")

**Recommendation:** ✅ **Implement** as a developer UX improvement, but **don't use in AI sessions**. Human debugging only.

---

### Option 2: Event Replay

**Approach:** Replay swarm execution from event log to reproduce failures.

```bash
# Replay specific swarm
swarm replay bd-abc123 --from-sequence 0

# Replay with verbosity
swarm replay bd-abc123 --verbose --show-state-changes

# Replay up to specific event
swarm replay bd-abc123 --until-sequence 42
```

**Implementation:**

```typescript
// Already exists: replayEvents(options, projectPath)
await replayEvents(
  {
    projectKey: "/path/to/project",
    fromSequence: 0,
    clearViews: true, // Start fresh
  },
  projectPath
);
```

**Pros:**
- **Already implemented** (`replayEvents`, `replayEventsBatched`)
- Deterministic for all non-LLM operations (file reservations, message sending, checkpoint creation)
- Can reproduce state at any point in time
- Enables "time travel" debugging

**Cons:**
- **LLM responses are non-deterministic** - can't replay agent decisions
- **Timing-dependent operations** (TTL expirations, race conditions) may differ
- Large event logs (100k+ events) require batched replay

**Recommendation:** ✅ **Ship it** - expose as CLI command. Accept non-determinism limits (document them).

**Use Cases:**
1. Reproduce reservation conflicts - "Why did agent X fail to reserve file Y?"
2. Investigate checkpoint corruption - "Replay up to checkpoint N, dump state"
3. Debug projection drift - "Does replay produce same projections as prod?"

---

### Option 3: State Dumps

**Approach:** Snapshot swarm state at any point (event sequence or timestamp).

```bash
# Dump current state
swarm dump bd-abc123

# Dump at specific sequence
swarm dump bd-abc123 --at-sequence 100

# Dump at timestamp
swarm dump bd-abc123 --at-time "2025-12-22T10:30:00Z"

# Dump specific subsystem
swarm dump bd-abc123 --only reservations
```

**Output (JSON):**
```json
{
  "epic_id": "bd-abc123",
  "sequence": 100,
  "timestamp": 1703241000000,
  "agents": [
    { "name": "BlueLake", "status": "active", "last_active": 1703240999000 }
  ],
  "reservations": [
    { "id": 42, "agent": "BlueLake", "path": "src/auth/**", "exclusive": true }
  ],
  "messages": {
    "total": 12,
    "unread": 3,
    "urgent": 1
  },
  "checkpoints": [
    { "bead_id": "bd-abc123.0", "progress": 50, "timestamp": 1703240500000 }
  ]
}
```

**Implementation:**

```typescript
async function dumpSwarmState(
  epicId: string,
  projectPath: string,
  options: { atSequence?: number; subsystem?: string }
): Promise<SwarmStateDump> {
  // 1. Replay events up to target sequence
  if (options.atSequence) {
    await replayEvents(
      { projectKey: projectPath, fromSequence: 0, clearViews: true },
      projectPath
    );
  }

  // 2. Query projections (current state)
  const agents = await db.query(`SELECT * FROM agents WHERE project_key = ?`, [projectPath]);
  const reservations = await db.query(`SELECT * FROM reservations WHERE project_key = ? AND released_at IS NULL`, [projectPath]);
  const messages = await db.query(`SELECT * FROM messages WHERE project_key = ?`, [projectPath]);

  // 3. Return structured dump
  return {
    epic_id: epicId,
    sequence: options.atSequence || (await getLatestSequence(projectPath)),
    agents: agents.rows,
    reservations: reservations.rows,
    messages: {
      total: messages.rows.length,
      // ... aggregate stats
    },
  };
}
```

**Pros:**
- **High signal-to-noise** - concise snapshot, not full event log
- **Queryable** - filter by subsystem (reservations, messages, checkpoints)
- **Reuses existing projections** - no new storage

**Cons:**
- Point-in-time only (no transitions shown)
- Requires replay for historical dumps (slow for large logs)

**Recommendation:** ✅ **Ship it** - combine with replay for time-travel debugging.

---

### Option 4: Step-through Debugging

**Approach:** Pause swarm execution between operations, inspect state, manually advance.

```bash
# Start swarm in step mode
swarm run "Add auth" --step

# At each event:
> Event: file_reserved (agent=BlueLake, paths=["src/auth/**"])
> State: 3 agents active, 2 reservations held
> [c]ontinue, [s]kip event, [d]ump state, [q]uit?
```

**Pros:**
- Granular control over execution
- Interactive debugging (REPL-style)

**Cons:**
- **Breaks async coordination** - agents don't wait for human input
- **High friction** - requires manual interaction at every step
- **Context overhead** - adds REPL state to AI context
- **Complex implementation** - need event bus with pause/resume

**Recommendation:** ❌ **Defer** - high effort, low value. Replay + state dumps solve the same problems without blocking execution.

---

### Option 5: Error Context Enrichment

**Approach:** Errors carry full diagnostic context (event history, state snapshot, suggestions).

**Current Error (minimal context):**
```
Error: Failed to reserve file: src/auth/service.ts
```

**Enriched Error:**
```json
{
  "error": "Failed to reserve file: src/auth/service.ts",
  "context": {
    "agent": "BlueLake",
    "bead_id": "bd-abc123.1",
    "epic_id": "bd-abc123",
    "timestamp": 1703241000000,
    "sequence": 142,
    "reason": "File already reserved by RedMountain (exclusive)",
    "current_holder": {
      "agent": "RedMountain",
      "reservation_id": 38,
      "expires_at": 1703244600000,
      "reason": "bd-abc123.0: Auth schema migration"
    },
    "recent_events": [
      { "sequence": 140, "type": "file_reserved", "agent": "RedMountain", "paths": ["src/auth/**"] },
      { "sequence": 141, "type": "task_progress", "agent": "RedMountain", "progress": 50 }
    ],
    "suggestions": [
      "Wait for reservation to expire (59 minutes remaining)",
      "Request RedMountain to release via swarm_mail",
      "Use different files (check decomposition for file ownership)"
    ]
  }
}
```

**Implementation:**

```typescript
class ReservationError extends Error {
  constructor(
    message: string,
    public context: {
      agent: string;
      beadId: string;
      path: string;
      currentHolder?: { agent: string; expiresAt: number; reason: string };
      recentEvents?: AgentEvent[];
      suggestions?: string[];
    }
  ) {
    super(message);
    this.name = "ReservationError";
  }

  toJSON() {
    return {
      error: this.message,
      context: this.context,
    };
  }
}

// Usage:
throw new ReservationError("Failed to reserve file", {
  agent: agentName,
  beadId: beadId,
  path: filePath,
  currentHolder: { ... },
  recentEvents: await readEvents({ types: ["file_reserved", "file_released"], limit: 5 }),
  suggestions: [
    "Wait for reservation to expire",
    "Request release via swarm_mail"
  ]
});
```

**Pros:**
- **Actionable** - errors include recovery suggestions
- **Self-contained** - no need to query event log separately
- **Structured** - JSON format enables programmatic handling
- **AI-friendly** - context is concise, high signal

**Cons:**
- Requires updating all error throw sites
- Increases error object size (but still manageable)

**Recommendation:** ✅ **Ship it** - high ROI for debugging experience. Start with reservation conflicts, expand to other errors.

---

## 4. Key Questions Answered

### Q1: How do we enable verbose mode without bloating context?

**A:** Verbose logging is **human-only**. AI agents use structured errors + state dumps instead.

- Humans: `DEBUG=swarm:* swarm run "task"` → console output
- AI agents: Errors throw enriched objects, use `swarm dump` for state inspection

### Q2: Can we replay a failed swarm to reproduce issues?

**A:** Yes, within LLM non-determinism limits.

**Deterministic:**
- File reservations (DurableLock CAS operations)
- Message sending/routing
- Checkpoint creation
- Event sequence ordering

**Non-deterministic:**
- Agent decisions (LLM responses)
- Timing-dependent operations (TTL expirations if wall-clock time is used)
- Race conditions (multiple agents reserving concurrently)

**Solution:** Replay infrastructure guarantees **event log consistency**, not **outcome consistency**. Document this limitation clearly.

### Q3: What state needs to be captured for useful dumps?

**A:** Projections + recent events.

**Minimal dump:**
- Active agents (name, last active, task)
- File reservations (holder, path, expiry)
- Message counts (total, unread, urgent)
- Checkpoint state (progress, files modified)

**Extended dump (opt-in):**
- Last N events (default 20)
- Full message bodies (inbox)
- Eval records (decomposition outcomes)

### Q4: How do we handle non-determinism in replay?

**A:** Accept it and document.

**Strategy:**
1. **Log LLM responses as events** (optional event type: `llm_response_received`)
2. **Replay with mock responses** - coordinator can inject canned LLM responses for testing
3. **Warn on non-deterministic replay** - CLI displays warning when replaying with real LLMs

**Example:**
```bash
swarm replay bd-abc123 --mock-llm
# Warning: Replaying with mock LLM responses. Outcomes may differ from original.
```

### Q5: What about context overhead?

**A:** Structured outputs prevent dump-everything anti-pattern.

- `swarm dump` returns JSON (max 500 lines, configurable)
- `swarm replay --verbose` streams to stderr (AI ignores stderr)
- Errors are enriched but truncated (recent events limited to 5)

---

## 5. Recommendation

**BUILD IT: Diagnostic CLI + Error Enrichment**

Ship in 1 week:

### Phase 1: Replay CLI (2 days)

```bash
swarm replay <epic-id> [options]
  --from-sequence N      Start from sequence N (default 0)
  --until-sequence N     Stop at sequence N
  --verbose              Show all events as they replay
  --mock-llm             Use canned LLM responses (deterministic)
```

**Implementation:** Wrap existing `replayEvents` with CLI args + progress reporting.

### Phase 2: State Dump CLI (1 day)

```bash
swarm dump <epic-id> [options]
  --at-sequence N        Dump state at sequence N
  --at-time ISO8601      Dump state at timestamp
  --only SUBSYSTEM       Filter (agents|reservations|messages|checkpoints)
  --format json|yaml     Output format (default json)
```

**Implementation:** Query projections + format output.

### Phase 3: Error Enrichment (3 days)

1. Define error classes: `ReservationError`, `CheckpointError`, `ValidationError`
2. Update throw sites: `swarm-orchestrate.ts`, `swarm-mail.ts`, `agent-mail.ts`
3. Add `suggestions` field to all errors (recovery hints)
4. Test error output in AI context (ensure concise)

### Phase 4: Verbose Logging (1 day)

```typescript
// packages/swarm-mail/src/debug.ts
import debug from "debug";

export const log = {
  events: debug("swarm:events"),
  reservations: debug("swarm:reservations"),
  messages: debug("swarm:messages"),
  checkpoints: debug("swarm:checkpoints"),
};

// Usage:
log.reservations("Agent %s reserved %s", agentName, paths);
```

**Integration:** Add to event handlers, opt-in via `DEBUG=swarm:*`.

---

## 6. Future Enhancements (Defer)

### 6.1 Event Log Visualization

Web UI for browsing event log visually (timeline, filters, search).

**Effort:** 2-3 weeks  
**Value:** High for complex swarms (10+ agents)  
**Priority:** P2 (after CLI ships)

### 6.2 Distributed Tracing Integration

Export events to OpenTelemetry format for viewing in Jaeger/Zipkin.

**Effort:** 1 week  
**Value:** Medium (useful for production deployments)  
**Priority:** P3

### 6.3 Performance Profiling

Track event processing times, identify bottlenecks.

**Effort:** 3 days  
**Value:** Medium (optimization tool)  
**Priority:** P3

---

## 7. Alternatives Considered

### 7.1 Centralized Logging Service (Rejected)

**Approach:** Ship events to external service (Datadog, Sentry).

**Why rejected:**
- Adds external dependency
- Privacy concerns (events contain task details)
- Doesn't solve replay/debugging locally

### 7.2 REPL-based Debugger (Rejected)

**Approach:** Interactive shell for stepping through swarm execution.

**Why rejected:**
- Breaks async coordination (agents don't wait)
- High implementation complexity
- Low ROI vs. replay + dumps

### 7.3 Time-Travel Debugger (Deferred)

**Approach:** RR-style recording/replay with perfect determinism.

**Why deferred:**
- Requires recording all I/O (network, file system, random)
- LLM non-determinism is fundamental (can't replay model responses)
- High complexity, diminishing returns

---

## 8. Success Criteria

### MVP (1 week)

- ✅ `swarm replay <epic-id>` works for all event types
- ✅ `swarm dump <epic-id>` shows current state
- ✅ Errors include context + suggestions
- ✅ Verbose logging controlled by `DEBUG` env var

### Full (2 weeks)

- ✅ Replay with mock LLM responses (deterministic)
- ✅ State dumps at historical sequence numbers
- ✅ Enriched errors for all failure modes
- ✅ Documentation with examples

### Stretch

- ⏳ Web UI for event log visualization
- ⏳ OpenTelemetry integration
- ⏳ Performance profiling

---

## 9. Appendix: Event Log Query Patterns

Common debugging queries (SQL over libSQL):

```sql
-- Find all reservation conflicts
SELECT 
  e1.timestamp, 
  e1.agent_name AS requester,
  e2.agent_name AS holder,
  e1.paths
FROM events e1
JOIN reservations r ON r.path_pattern = ANY(e1.paths) AND r.released_at IS NULL
JOIN events e2 ON e2.id = r.created_by_event_id
WHERE e1.type = 'file_reserved'
  AND e1.timestamp > r.created_at
ORDER BY e1.timestamp DESC;

-- Find agents that never completed their tasks
SELECT 
  agent_name,
  COUNT(*) FILTER (WHERE type = 'task_started') AS started,
  COUNT(*) FILTER (WHERE type = 'task_completed') AS completed
FROM events
WHERE project_key = '/path/to/project'
GROUP BY agent_name
HAVING started > completed;

-- Find checkpoints that led to recovery
SELECT 
  c.bead_id,
  c.timestamp AS checkpointed_at,
  r.timestamp AS recovered_at,
  (r.timestamp - c.timestamp) / 1000 AS recovery_delay_seconds
FROM events c
JOIN events r ON r.bead_id = c.bead_id AND r.type = 'swarm_recovered'
WHERE c.type = 'swarm_checkpointed'
ORDER BY recovery_delay_seconds DESC;
```

---

## 10. Next Steps

1. **Approve this ADR** - Stakeholder sign-off
2. **Create implementation epic** - Break into 4 beads (replay, dump, errors, verbose)
3. **Ship Phase 1** - Replay CLI (2 days)
4. **Iterate based on usage** - Gather feedback from developers debugging swarms

---

**Decision:** Proceed with diagnostic CLI (replay + dump) and error enrichment. Ship in 1 week.
