# Architecture Decision Record: Post-Hoc Analysis - Traces, Analytics & Pattern Extraction

**Date:** 2025-12-22  
**Epic:** opencode-swarm-monorepo-lf2p4u-mjhji3rrl06  
**Status:** Research Complete  
**Authors:** RedOcean (swarm worker agent)

---

## Executive Summary

**Question:** What post-hoc analysis capabilities should we build for swarm tools? How do we turn the event log into actionable insights?

**Answer:** **BUILD LAYERED ANALYTICS** starting with SQL queries, graduating to structured exports, then visualization.

| Aspect | Assessment |
|--------|------------|
| **Current State** | ✅ Rich event log exists, but no query tools beyond raw SQL |
| **Technical Feasibility** | ✅ High - libSQL gives us full SQL power, events are well-structured |
| **Effort Estimate** | Phase 1 (SQL CLI): 1 week, Phase 2 (Analytics): 2 weeks, Phase 3 (Viz): 3-4 weeks |
| **Risk Level** | Low - libSQL is proven, export formats are standardized |
| **Recommendation** | **Phase 1: SQL query CLI**, then structured exports, defer viz to Phase 3 |

---

## 1. Problem Statement

### Current State

We capture **17+ event types** in an append-only log (libSQL):

```
┌─────────────────────────────────────────────────────────┐
│                  EVENT CATEGORIES                       │
├─────────────────────────────────────────────────────────┤
│  Agent Events (2)                                       │
│    - agent_registered, agent_active                     │
│                                                         │
│  Message Events (3)                                     │
│    - message_sent, message_read, message_acked          │
│                                                         │
│  File Coordination (2)                                  │
│    - file_reserved, file_released                       │
│                                                         │
│  Task Lifecycle (4)                                     │
│    - task_started, task_progress, task_completed,       │
│      task_blocked                                       │
│                                                         │
│  Learning Events (3)                                    │
│    - decomposition_generated, subtask_outcome,          │
│      human_feedback                                     │
│                                                         │
│  Recovery Events (2)                                    │
│    - swarm_checkpointed, swarm_recovered                │
└─────────────────────────────────────────────────────────┘
```

**What we have:**
- Full audit trail of every agent action
- Outcome tracking (duration, errors, retries, success)
- Learning signals (strategy, criteria, feedback)
- Structured projections (agents, messages, reservations)

**What we're missing:**
- **Query interface** - No way to ask "show me all failed decompositions"
- **Analytics** - Can't aggregate patterns across epics
- **Correlation** - Hard to trace event chains across agents
- **Export** - Locked in libSQL, can't feed to external tools
- **Visualization** - No timeline view, no dependency graphs

### Desired State

Ideal post-hoc analysis enables:

1. **Debugging** - "Why did epic X fail? Show me the event trace."
2. **Pattern Mining** - "Which strategies have highest success rate?"
3. **Performance Analysis** - "Where are agents spending time?"
4. **Learning Validation** - "Are deprecated criteria still being used?"
5. **Compliance** - "Prove that no files were modified without reservation"

### Why This Matters

Learning systems are only as good as their feedback loops. We capture signals (outcome tracking, strike detection, confidence decay) but we can't easily:

- Verify that learning is working (did deprecated strategies stop being used?)
- Identify systemic issues (why do 80% of file-based decomps fail?)
- Debug swarm coordination (why did agent Blue wait 20min for Red?)
- Extract reusable patterns (which coordinator notes correlate with success?)

**The event log is gold. We need a pickaxe.**

---

## 2. Current Capabilities

### 2.1 What Events We Already Capture

From `packages/swarm-mail/src/streams/events.ts`:

| Event Type | Data Captured | Use Cases |
|------------|---------------|-----------|
| **agent_registered** | name, program, model, task | Agent inventory, model usage stats |
| **agent_active** | name, timestamp | Activity timeline, liveness |
| **message_sent** | from, to, subject, body, thread_id, importance | Communication patterns, bottlenecks |
| **message_read** | message_id, agent, timestamp | Response latency |
| **message_acked** | message_id, agent | Acknowledgment gaps |
| **file_reserved** | agent, paths, exclusive, ttl, expires_at | Lock contention, access patterns |
| **file_released** | agent, paths, reservation_ids | Lock hold duration |
| **task_started** | agent, bead_id, epic_id | Task initiation |
| **task_progress** | agent, bead_id, progress_percent, message, files | Progress tracking |
| **task_completed** | agent, bead_id, summary, files, success | Completion signals |
| **task_blocked** | agent, bead_id, reason | Blocker analysis |
| **decomposition_generated** | epic_id, task, strategy, subtasks, recovery_context | Strategy effectiveness |
| **subtask_outcome** | epic_id, bead_id, planned_files, actual_files, duration_ms, errors, retries, success, scope_violation | Contract compliance, learning signals |
| **human_feedback** | epic_id, accepted, modified, notes | Human approval patterns |
| **swarm_checkpointed** | epic_id, bead_id, strategy, files, dependencies, recovery | Checkpoint frequency |
| **swarm_recovered** | epic_id, bead_id, recovered_from_checkpoint | Recovery success rate |

### 2.2 What Projections Exist

From `packages/swarm-mail/src/db/schema/streams.ts`:

| Table | Purpose | Query Capability |
|-------|---------|------------------|
| **events** | Append-only log | Raw event replay |
| **agents** | Registered agents | Active agent list |
| **messages** | Inter-agent msgs | Thread reconstruction |
| **message_recipients** | Read/ack status | Delivery verification |
| **reservations** | File locks | Lock contention analysis |
| **locks** | Distributed mutex | CAS operation tracking |
| **cursors** | Stream checkpoints | Replay position |
| **eval_records** | Decomposition evals | Strategy comparison |
| **swarm_contexts** | Recovery checkpoints | Crash recovery data |

**Key insight:** We have BOTH events (immutable history) AND projections (current state). Analytics can query either.

### 2.3 Correlation Mechanisms

Events can be correlated via:

1. **project_key** - All events in same repo
2. **epic_id** - All work on same decomposition
3. **bead_id** - All events for specific subtask
4. **thread_id** - Message conversation chains
5. **agent_name** - All actions by same agent
6. **timestamp** - Temporal ordering
7. **sequence** - Total ordering (auto-generated from event id)

**Critical:** We already have **distributed trace IDs** (epic_id, bead_id). We just need to expose them.

---

## 3. Options Evaluated

### 3.1 Option A: SQL Query CLI

**Approach:** Expose libSQL database with pre-built query examples.

```bash
# Direct SQL access
swarm-db query "SELECT * FROM events WHERE type = 'subtask_outcome' AND success = false"

# Pre-built analytics
swarm-db analytics failed-decompositions --since=7d
swarm-db analytics average-duration --strategy=file-based
swarm-db analytics lock-contention --project=/path/to/repo
```

**Pros:**
- ✅ Immediate value (no new infrastructure)
- ✅ Full SQL power (JOINs, aggregates, window functions)
- ✅ Familiar tooling (existing SQL knowledge)
- ✅ Fast to implement (1 week)

**Cons:**
- ❌ Requires SQL knowledge (not friendly for non-technical users)
- ❌ No visualization (text output only)
- ❌ Manual correlation (user must understand schema)

**Implementation:**

```typescript
// packages/swarm-mail/src/cli/query.ts
export async function runQuery(sql: string, projectKey?: string) {
  const db = await getSwarmMailLibSQL(projectKey);
  const result = db.select(sql);
  console.log(formatTable(result));
}

// Pre-built queries
export const ANALYTICS_QUERIES = {
  failedDecompositions: `
    SELECT e.data->>'strategy' as strategy,
           COUNT(*) as failure_count,
           AVG(e.data->>'duration_ms') as avg_duration
    FROM events e
    WHERE e.type = 'subtask_outcome' 
      AND e.data->>'success' = 'false'
    GROUP BY strategy
    ORDER BY failure_count DESC
  `,
  lockContention: `
    SELECT r.path_pattern,
           COUNT(*) as reservation_count,
           AVG(r.expires_at - r.created_at) as avg_hold_ms
    FROM reservations r
    WHERE r.released_at IS NOT NULL
    GROUP BY r.path_pattern
    ORDER BY reservation_count DESC
  `,
  // ... more pre-built queries
};
```

### 3.2 Option B: Structured Export (OpenTelemetry, JSON, CSV)

**Approach:** Export events to standard formats for external analysis.

```bash
# Export to OpenTelemetry spans
swarm-db export --format=otel --output=traces.json

# Export to CSV for Excel/BI tools
swarm-db export --format=csv --output=events.csv

# Export to JSON Lines for streaming processing
swarm-db export --format=jsonl --output=events.jsonl
```

**OpenTelemetry Mapping:**

| Swarm Event | OTEL Concept | Span Attributes |
|-------------|--------------|-----------------|
| epic | trace | trace_id=epic_id |
| bead | span | span_id=bead_id, parent_id=epic_id |
| task_started | span start | start_time |
| task_completed | span end | end_time, status, error_count |
| message_sent | event | event.name=message_sent |
| file_reserved | event | event.name=file_reserved |

**Pros:**
- ✅ Industry standard (OTEL is widely supported)
- ✅ Visualization ready (Jaeger, Grafana, Honeycomb)
- ✅ External tool integration (BI, ML pipelines)
- ✅ Streaming friendly (JSONL for log aggregators)

**Cons:**
- ❌ Lossy conversion (OTEL spans don't map perfectly to our domain)
- ❌ Requires external tooling (no built-in viz)
- ❌ Extra setup (need OTEL collector, viz tool)

**Implementation:**

```typescript
// packages/swarm-mail/src/export/otel.ts
export async function exportToOtel(projectKey: string): Promise<OtelTrace[]> {
  const db = await getSwarmMailLibSQL(projectKey);
  
  // Group events by epic_id (trace)
  const epics = await db.select(`
    SELECT DISTINCT data->>'epic_id' as epic_id
    FROM events
    WHERE data->>'epic_id' IS NOT NULL
  `);
  
  const traces: OtelTrace[] = [];
  
  for (const epic of epics) {
    const epicEvents = await db.select(`
      SELECT * FROM events 
      WHERE data->>'epic_id' = ? 
      ORDER BY timestamp
    `, [epic.epic_id]);
    
    const spans = eventsToSpans(epicEvents);
    traces.push({
      traceId: epic.epic_id,
      spans,
    });
  }
  
  return traces;
}

function eventsToSpans(events: Event[]): OtelSpan[] {
  // Convert task_started + task_completed into spans
  const spans: OtelSpan[] = [];
  const activeSpans = new Map<string, OtelSpan>();
  
  for (const event of events) {
    if (event.type === 'task_started') {
      activeSpans.set(event.data.bead_id, {
        spanId: event.data.bead_id,
        parentSpanId: event.data.epic_id,
        name: event.data.bead_id,
        startTime: event.timestamp,
        attributes: {
          'agent.name': event.data.agent_name,
        },
      });
    } else if (event.type === 'task_completed') {
      const span = activeSpans.get(event.data.bead_id);
      if (span) {
        span.endTime = event.timestamp;
        span.status = event.data.success ? 'OK' : 'ERROR';
        span.attributes['error.count'] = event.data.error_count || 0;
        span.attributes['files.touched'] = event.data.files_touched?.join(',') || '';
        spans.push(span);
        activeSpans.delete(event.data.bead_id);
      }
    }
    // TODO: Map other events to span events
  }
  
  return spans;
}
```

### 3.3 Option C: Timeline Visualization

**Approach:** Build interactive timeline view of swarm execution.

```
Timeline View:
┌────────────────────────────────────────────────────────┐
│  Agent Blue   ███████████░░░░░░░░░░░░░░░░░░░░░░░░░░░   │
│               │ Reserve │ task_started ┊ blocked      │
│                                                        │
│  Agent Red    ░░░░░░░░░░░░░░░██████████████████████   │
│                             │ task_started ┊ done     │
│                                                        │
│  Coordinator  ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░███    │
│               │spawn │                      │review    │
└────────────────────────────────────────────────────────┘
  0s          10s          20s          30s          40s
```

**Features:**
- Gantt chart of agent activity
- Dependency arrows (blocked-by relationships)
- Hover for event details
- Filter by event type, agent, success/failure
- Zoom/pan for long traces

**Pros:**
- ✅ Best UX (visual is easier than SQL)
- ✅ Pattern recognition (bottlenecks obvious)
- ✅ Debugging aid (see coordination failures)

**Cons:**
- ❌ Significant effort (3-4 weeks for MVP)
- ❌ Requires web stack (React + charting library)
- ❌ Maintenance burden (UI changes frequently)

**Implementation:**

```typescript
// packages/swarm-viz/src/timeline.tsx
export function SwarmTimeline({ epicId }: { epicId: string }) {
  const events = useSwarmEvents(epicId);
  const timeline = useMemo(() => buildTimeline(events), [events]);
  
  return (
    <VisTimeline
      items={timeline.items}
      groups={timeline.groups}
      options={{
        stack: true,
        showCurrentTime: false,
        zoomable: true,
      }}
    />
  );
}

function buildTimeline(events: Event[]): Timeline {
  const items: TimelineItem[] = [];
  const groups: TimelineGroup[] = [];
  const agentGroups = new Set<string>();
  
  // Create group per agent
  for (const event of events) {
    const agent = event.data.agent_name;
    if (agent && !agentGroups.has(agent)) {
      groups.push({ id: agent, content: agent });
      agentGroups.add(agent);
    }
  }
  
  // Convert events to timeline items
  const spanMap = new Map<string, TimelineItem>();
  
  for (const event of events) {
    if (event.type === 'task_started') {
      spanMap.set(event.data.bead_id, {
        id: event.data.bead_id,
        group: event.data.agent_name,
        content: event.data.bead_id,
        start: event.timestamp,
        type: 'range',
      });
    } else if (event.type === 'task_completed') {
      const item = spanMap.get(event.data.bead_id);
      if (item) {
        item.end = event.timestamp;
        item.className = event.data.success ? 'success' : 'failure';
        items.push(item);
      }
    } else if (event.type === 'message_sent') {
      items.push({
        id: `msg-${event.id}`,
        group: event.data.from_agent,
        content: `📧 ${event.data.subject}`,
        start: event.timestamp,
        type: 'point',
      });
    }
    // ... map other event types
  }
  
  return { items, groups };
}
```

### 3.4 Option D: Pattern Extraction (ML/Rule-Based)

**Approach:** Automatically identify patterns in event sequences.

```bash
# Extract common failure patterns
swarm-db patterns extract --min-support=3

# Output:
# Pattern 1 (5 occurrences):
#   decomposition_generated(strategy=file-based)
#   → subtask_outcome(scope_violation=true)
#   → task_blocked(reason="file conflict")
#
# Pattern 2 (3 occurrences):
#   file_reserved(exclusive=false)
#   → file_reserved(exclusive=false)  # same path
#   → message_sent(subject="BLOCKED: file conflict")
```

**Techniques:**

1. **Sequence Mining** - Find common event sequences (e.g., Apriori algorithm)
2. **Correlation Rules** - "When X happens, Y follows 80% of the time"
3. **Anomaly Detection** - Flag unusual patterns (e.g., 10min gap between reserve and start)
4. **Clustering** - Group similar epics by event signature

**Pros:**
- ✅ Discover unknown patterns (machine finds what humans miss)
- ✅ Anti-pattern detection (automate what mandate-promotion does manually)
- ✅ Predictive (warn if epic matches failure pattern)

**Cons:**
- ❌ Complex implementation (ML expertise required)
- ❌ False positives (noise in patterns)
- ❌ Maintenance (patterns drift as system evolves)

**Implementation:**

```typescript
// packages/swarm-analytics/src/patterns.ts
export async function extractPatterns(
  projectKey: string,
  minSupport: number = 3
): Promise<Pattern[]> {
  const db = await getSwarmMailLibSQL(projectKey);
  
  // Get all event sequences grouped by epic
  const sequences = await db.select(`
    SELECT data->>'epic_id' as epic_id,
           GROUP_CONCAT(type, ' → ') as event_sequence
    FROM events
    WHERE data->>'epic_id' IS NOT NULL
    GROUP BY epic_id
    ORDER BY epic_id
  `);
  
  // Find frequent subsequences (simplified Apriori)
  const patternCounts = new Map<string, number>();
  
  for (const seq of sequences) {
    const events = seq.event_sequence.split(' → ');
    
    // Generate all subsequences of length 2-5
    for (let len = 2; len <= 5; len++) {
      for (let i = 0; i <= events.length - len; i++) {
        const subseq = events.slice(i, i + len).join(' → ');
        patternCounts.set(subseq, (patternCounts.get(subseq) || 0) + 1);
      }
    }
  }
  
  // Filter by min support and sort by frequency
  const patterns = Array.from(patternCounts.entries())
    .filter(([_, count]) => count >= minSupport)
    .sort((a, b) => b[1] - a[1])
    .map(([sequence, count]) => ({
      sequence,
      occurrences: count,
      support: count / sequences.length,
    }));
  
  return patterns;
}

// Detect anti-patterns by correlating with failures
export async function detectAntiPatterns(
  projectKey: string
): Promise<AntiPattern[]> {
  const patterns = await extractPatterns(projectKey);
  const db = await getSwarmMailLibSQL(projectKey);
  
  const antiPatterns: AntiPattern[] = [];
  
  for (const pattern of patterns) {
    // Count how often this pattern leads to failure
    const failureRate = await db.select(`
      WITH pattern_epics AS (
        SELECT DISTINCT data->>'epic_id' as epic_id
        FROM events
        WHERE data->>'epic_id' IN (
          -- Epics matching this pattern
          SELECT data->>'epic_id'
          FROM events
          GROUP BY data->>'epic_id'
          HAVING GROUP_CONCAT(type, ' → ') LIKE '%${pattern.sequence}%'
        )
      )
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN success = false THEN 1 ELSE 0 END) as failures
      FROM subtask_outcome o
      JOIN pattern_epics p ON o.epic_id = p.epic_id
    `);
    
    const rate = failureRate.failures / failureRate.total;
    
    if (rate > 0.6) {
      antiPatterns.push({
        pattern: pattern.sequence,
        failureRate: rate,
        occurrences: pattern.occurrences,
        recommendation: generateRecommendation(pattern.sequence, rate),
      });
    }
  }
  
  return antiPatterns;
}
```

---

## 4. Key Questions & Answers

### 4.1 What events do we already capture vs need to add?

**Already captured (sufficient for Phase 1-2):**
- ✅ Full task lifecycle (started, progress, completed, blocked)
- ✅ Outcome signals (duration, errors, retries, success, scope violations)
- ✅ Coordination events (messages, reservations)
- ✅ Learning events (decomposition strategy, human feedback)
- ✅ Recovery events (checkpoints, recovery)

**Missing (nice-to-have for Phase 3):**
- ⚠️ Tool invocations (which tools were called, how often, latency)
- ⚠️ Context usage (tokens consumed, context switches)
- ⚠️ Review outcomes (approval/rejection details)
- ⚠️ LLM prompt/response pairs (for debugging agent behavior)

**Recommendation:** Don't add events yet. Phase 1-2 can deliver value with current events. Add tool/context events only if Phase 2 reveals demand.

### 4.2 How do we correlate events across agents?

**Already solved:**

```typescript
// Correlation keys already in events
type CorrelationKeys = {
  project_key: string;  // All events in same repo
  epic_id: string;      // All work on same decomposition (trace_id)
  bead_id: string;      // All events for specific subtask (span_id)
  thread_id: string;    // Message conversation chains
  agent_name: string;   // All actions by same agent
  timestamp: number;    // Temporal ordering
  sequence: number;     // Total ordering (auto-generated)
};
```

**Query patterns:**

```sql
-- All events for epic (distributed trace)
SELECT * FROM events WHERE data->>'epic_id' = 'epic-abc123' ORDER BY sequence;

-- All messages in thread
SELECT * FROM messages WHERE thread_id = 'bd-xyz' ORDER BY created_at;

-- All file reservations for a path
SELECT * FROM reservations WHERE path_pattern = 'src/auth/**' ORDER BY created_at;

-- Agent activity timeline
SELECT type, timestamp FROM events 
WHERE data->>'agent_name' = 'BlueLake' 
ORDER BY timestamp;
```

**Critical insight:** We don't need to add trace IDs. Epic ID IS the trace ID. Bead ID IS the span ID. The schema already models distributed tracing.

### 4.3 What's the query interface?

**Phase 1: SQL CLI**

```bash
# Direct SQL
swarm-db query "SELECT ..."

# Pre-built analytics
swarm-db analytics <command> [options]
```

**Phase 2: Programmatic API**

```typescript
import { SwarmAnalytics } from 'swarm-mail/analytics';

const analytics = new SwarmAnalytics(projectKey);

// Get all failed decompositions
const failures = await analytics.failedDecompositions({ since: '7d' });

// Get average duration by strategy
const durations = await analytics.averageDuration({ groupBy: 'strategy' });

// Get lock contention report
const locks = await analytics.lockContention({ threshold: 5 });
```

**Phase 3: Web UI**

```
http://localhost:3000/swarm-viz?epic=epic-abc123
```

### 4.4 How do we feed learnings back into the system?

**Current feedback loops:**

1. **swarm_record_outcome** → `eval_records` table → pattern maturity scoring
2. **subtask_outcome** events → implicit feedback → criterion weights
3. **human_feedback** events → explicit feedback → anti-pattern detection

**Analytics-enhanced loops:**

```
Analytics Query
     ↓
Pattern Extraction (SQL aggregate or ML)
     ↓
Confidence Update (if pattern has >60% failure rate)
     ↓
Mandate Promotion (auto-deprecate failing strategy)
     ↓
Prevention (LLM prompted: "AVOID file-based for this task type")
```

**Implementation:**

```typescript
// Automatically deprecate strategies with >60% failure rate
async function autoDeprecateStrategies(projectKey: string) {
  const analytics = new SwarmAnalytics(projectKey);
  const strategies = await analytics.strategySuccessRates();
  
  for (const [strategy, rate] of Object.entries(strategies)) {
    if (rate < 0.4) {  // <40% success = >60% failure
      // Promote to anti-pattern
      await promoteAntiPattern({
        pattern: `decomposition_strategy=${strategy}`,
        failureRate: 1 - rate,
        recommendation: `AVOID: ${strategy} strategy has ${Math.round((1 - rate) * 100)}% failure rate`,
      });
      
      // Store in semantic memory
      await storeMemory({
        information: `Strategy "${strategy}" deprecated due to ${Math.round((1 - rate) * 100)}% failure rate across ${strategies[strategy].total} decompositions.`,
        metadata: `anti-pattern, ${strategy}, deprecation`,
      });
    }
  }
}
```

---

## 5. Recommendation

**BUILD IN 3 PHASES - START WITH SQL CLI**

### Phase 1: SQL Query CLI (1 week) - START HERE

**Scope:**
- ✅ `swarm-db query <sql>` command
- ✅ 10 pre-built analytics queries
- ✅ Tab-completion for event types
- ✅ Export to CSV, JSON, JSONL

**Deliverables:**

```bash
# Direct SQL access
swarm-db query "SELECT * FROM events WHERE type = 'subtask_outcome'"

# Pre-built analytics
swarm-db analytics failed-decompositions --since=7d
swarm-db analytics strategy-success-rates
swarm-db analytics lock-contention --threshold=5
swarm-db analytics agent-activity --agent=BlueLake
swarm-db analytics message-latency --percentile=95
```

**Value:** Immediate debugging power. When swarm fails, run SQL queries to understand why. No new infrastructure, just expose what's already there.

**Test:** Can we answer the 5 core questions from "Desired State" with SQL queries?

1. ✅ Why did epic X fail? → `SELECT * FROM events WHERE data->>'epic_id' = 'X' ORDER BY sequence`
2. ✅ Which strategies succeed? → `SELECT strategy, AVG(success) FROM subtask_outcome GROUP BY strategy`
3. ✅ Where are agents spending time? → `SELECT agent_name, SUM(duration_ms) FROM task_completed GROUP BY agent_name`
4. ✅ Are deprecated criteria used? → `SELECT * FROM decomposition_generated WHERE data->>'criteria' LIKE '%deprecated%'`
5. ✅ File reservation compliance? → `SELECT * FROM reservations WHERE released_at IS NULL AND expires_at < ?`

### Phase 2: Structured Export + Programmatic API (2 weeks)

**Scope:**
- ✅ Export to OpenTelemetry format
- ✅ Export to CSV for Excel/BI tools
- ✅ TypeScript API for analytics
- ✅ Auto-deprecation of failing strategies

**Deliverables:**

```bash
# Export to OTEL (for Jaeger, Grafana, Honeycomb)
swarm-db export --format=otel --output=traces.json

# Export to CSV (for Excel, Tableau, Power BI)
swarm-db export --format=csv --output=events.csv
```

```typescript
// Programmatic API
import { SwarmAnalytics } from 'swarm-mail/analytics';

const analytics = new SwarmAnalytics('/path/to/repo');
const failures = await analytics.failedDecompositions({ since: '7d' });
```

**Value:** Integration with existing tools. Data teams can use their BI tools, SREs can use their observability stack.

### Phase 3: Visualization (3-4 weeks) - DEFER

**Scope:**
- Timeline view (Gantt chart of agent activity)
- Dependency graph (epic → beads → dependencies)
- Heatmap (lock contention, message volume)
- Pattern browser (visualize extracted patterns)

**Value:** Best UX, but significant effort. Only build if Phase 1-2 prove high demand.

**Decision point:** Ship Phase 1, gather feedback. If users ask "can I see this visually?", then build Phase 2. If they're happy with SQL, stop at Phase 1.

---

## 6. Implementation Plan

### Phase 1: SQL CLI (Week 1)

**Day 1-2: CLI scaffolding**
- [ ] Create `packages/swarm-mail/src/cli/db.ts`
- [ ] Add `swarm-db` bin script to package.json
- [ ] Implement `query` command with libSQL connection
- [ ] Add output formatting (table, JSON, CSV)

**Day 3-4: Pre-built analytics**
- [ ] Implement 10 analytics queries (see list below)
- [ ] Add tab-completion for event types
- [ ] Add `--since`, `--until` filters
- [ ] Add `--format` flag (table, json, csv)

**Day 5: Testing & documentation**
- [ ] Integration tests for each analytics query
- [ ] Example queries in README
- [ ] CLI help text
- [ ] Ship Phase 1

**Pre-built Queries:**

1. `failed-decompositions` - Strategies with failure counts
2. `strategy-success-rates` - Success rate by strategy
3. `lock-contention` - Files with most reservations
4. `agent-activity` - Time spent per agent
5. `message-latency` - p50/p95/p99 response times
6. `scope-violations` - Files touched outside owned scope
7. `task-duration` - p50/p95/p99 task durations
8. `checkpoint-frequency` - How often agents checkpoint
9. `recovery-success` - Recovery success rate
10. `human-feedback` - Approval/rejection breakdown

### Phase 2: Export + API (Week 2-3)

**Week 2: Export formats**
- [ ] Implement OTEL exporter (`export/otel.ts`)
- [ ] Implement CSV exporter (`export/csv.ts`)
- [ ] Implement JSONL exporter (`export/jsonl.ts`)
- [ ] Add `swarm-db export` command

**Week 3: Programmatic API**
- [ ] Create `packages/swarm-mail/src/analytics/index.ts`
- [ ] Implement SwarmAnalytics class
- [ ] Add TypeScript types for all queries
- [ ] Integration tests
- [ ] Documentation

**Week 3 (end): Auto-deprecation**
- [ ] Implement `autoDeprecateStrategies()` function
- [ ] Add to `swarm_complete` post-hook
- [ ] Test with synthetic failure data

### Phase 3: Visualization (Week 4-7) - DEFERRED

Only start if Phase 1-2 feedback demands it.

---

## 7. Success Metrics

### Phase 1 Success Criteria

- [ ] Can answer all 5 "Desired State" questions with SQL queries
- [ ] Average query response time <100ms (for 10k events)
- [ ] CLI works on Mac/Linux/Windows
- [ ] Documentation includes 20+ example queries
- [ ] At least 3 users successfully debug a swarm failure using SQL CLI

### Phase 2 Success Criteria

- [ ] OTEL export can be imported into Jaeger/Grafana
- [ ] CSV export opens in Excel without errors
- [ ] Programmatic API used by at least 1 internal tool
- [ ] Auto-deprecation detects and deprecates ≥1 failing strategy

---

## 8. Alternatives Considered

### 8.1 Build Custom Observability Platform (Rejected)

**Approach:** Build Honeycomb/Datadog equivalent in-house.

**Why rejected:**
- Massive effort (6+ months)
- Maintenance burden
- Reinventing solved problems
- Better to export to existing tools (OTEL)

### 8.2 Just Use Raw SQLite Browser (Rejected)

**Approach:** Point users to SQLite browser tools, provide no CLI.

**Why rejected:**
- Poor UX (requires installing separate tool)
- No pre-built queries (users must learn schema)
- No export support (locked in SQLite)

### 8.3 Real-Time Dashboard (Rejected for Phase 1)

**Approach:** Build live-updating dashboard like Datadog.

**Why rejected:**
- Over-engineered for post-hoc analysis
- Adds WebSocket complexity
- Phase 1 is "after the fact", not "live monitoring"

---

## 9. Open Questions

### 9.1 Where does the CLI live?

**Options:**
1. `packages/swarm-mail/src/cli/db.ts` (alongside existing swarmmail CLI)
2. `packages/swarm-analytics/` (new package)
3. `packages/opencode-swarm-plugin/src/cli/db.ts` (plugin-level)

**Recommendation:** Option 1 (swarm-mail). Analytics are tightly coupled to the event store. Keep them together.

### 9.2 How do we handle multi-project queries?

```bash
# Query all projects
swarm-db query "SELECT * FROM events" --all-projects

# Query specific projects
swarm-db query "SELECT * FROM events" --project=/path/to/repo1,/path/to/repo2
```

**Implementation:** Each project has its own libSQL file. For `--all-projects`, open all databases and UNION results.

### 9.3 Should we expose raw SQL or only pre-built queries?

**Recommendation:** BOTH. Power users want raw SQL. Casual users want pre-built. Expose both interfaces.

### 9.4 How do we version analytics queries?

If we change event schema (add/remove fields), old queries break. Solutions:

1. **Schema versioning** - Track schema version in database, migrate queries
2. **Query compatibility layer** - Translate old queries to new schema
3. **Deprecation warnings** - Warn when using outdated query patterns

**Recommendation:** Start simple (no versioning in Phase 1). Add schema versioning in Phase 2 if it becomes a problem.

---

## 10. Next Steps

1. **Approve this ADR** - Stakeholder sign-off on phased approach
2. **Create Phase 1 epic** - Break into cells (meta!)
3. **Ship SQL CLI** - 1 week sprint
4. **Gather feedback** - Use SQL CLI for 2 weeks, collect pain points
5. **Decide on Phase 2** - If demand is high, proceed with exports
6. **Defer Phase 3** - Only build viz if users explicitly request it

---

## Appendix A: Example Queries

### Query 1: Failed Decompositions

```sql
-- Show all failed decompositions grouped by strategy
SELECT 
  json_extract(data, '$.strategy') as strategy,
  COUNT(*) as failure_count,
  AVG(CAST(json_extract(data, '$.duration_ms') AS REAL)) as avg_duration_ms,
  GROUP_CONCAT(json_extract(data, '$.bead_id'), ', ') as failed_beads
FROM events
WHERE type = 'subtask_outcome' 
  AND json_extract(data, '$.success') = 'false'
GROUP BY strategy
ORDER BY failure_count DESC;
```

### Query 2: Lock Contention

```sql
-- Show files with most reservations and average hold time
SELECT 
  path_pattern,
  COUNT(*) as reservation_count,
  AVG(COALESCE(released_at, strftime('%s', 'now') * 1000) - created_at) as avg_hold_ms,
  MAX(COALESCE(released_at, strftime('%s', 'now') * 1000) - created_at) as max_hold_ms
FROM reservations
GROUP BY path_pattern
HAVING reservation_count > 1
ORDER BY reservation_count DESC
LIMIT 10;
```

### Query 3: Agent Activity Timeline

```sql
-- Show all actions by a specific agent in chronological order
SELECT 
  type,
  datetime(timestamp / 1000, 'unixepoch') as time,
  json_extract(data, '$.bead_id') as bead_id,
  CASE type
    WHEN 'task_started' THEN 'Started: ' || json_extract(data, '$.bead_id')
    WHEN 'task_completed' THEN 'Completed: ' || json_extract(data, '$.summary')
    WHEN 'task_blocked' THEN 'Blocked: ' || json_extract(data, '$.reason')
    WHEN 'message_sent' THEN 'Sent: ' || json_extract(data, '$.subject')
    ELSE type
  END as description
FROM events
WHERE json_extract(data, '$.agent_name') = 'BlueLake'
ORDER BY timestamp;
```

### Query 4: Strategy Success Rates

```sql
-- Success rate by decomposition strategy
SELECT 
  json_extract(data, '$.strategy') as strategy,
  COUNT(*) as total_subtasks,
  SUM(CASE WHEN json_extract(data, '$.success') = 'true' THEN 1 ELSE 0 END) as successes,
  ROUND(
    CAST(SUM(CASE WHEN json_extract(data, '$.success') = 'true' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100,
    2
  ) as success_rate_pct
FROM events
WHERE type = 'subtask_outcome'
GROUP BY strategy
ORDER BY success_rate_pct DESC;
```

### Query 5: Scope Violations

```sql
-- Files touched outside owned scope
SELECT 
  json_extract(data, '$.bead_id') as bead_id,
  json_extract(data, '$.epic_id') as epic_id,
  json_extract(data, '$.planned_files') as planned,
  json_extract(data, '$.actual_files') as actual,
  json_extract(data, '$.violation_files') as violations
FROM events
WHERE type = 'subtask_outcome'
  AND json_extract(data, '$.scope_violation') = 'true'
ORDER BY timestamp DESC;
```

---

## Appendix B: OpenTelemetry Mapping Reference

| Swarm Concept | OTEL Concept | Mapping |
|---------------|--------------|---------|
| Epic | Trace | `trace_id` = `epic_id` |
| Bead | Span | `span_id` = `bead_id`, `parent_span_id` = `epic_id` |
| task_started | Span start | `start_time` |
| task_completed | Span end | `end_time`, `status.code` |
| task_blocked | Span event | `event.name` = "blocked", `event.attributes.reason` |
| message_sent | Span event | `event.name` = "message_sent", `event.attributes.subject` |
| file_reserved | Span event | `event.name` = "file_reserved", `event.attributes.paths` |
| subtask_outcome | Span attributes | `attributes.duration_ms`, `attributes.error_count`, `attributes.success` |

**OTEL Span Example:**

```json
{
  "traceId": "epic-abc123",
  "spanId": "bd-xyz-001",
  "parentSpanId": "epic-abc123",
  "name": "bd-xyz-001",
  "kind": "INTERNAL",
  "startTimeUnixNano": 1703001234000000000,
  "endTimeUnixNano": 1703001240000000000,
  "attributes": {
    "agent.name": "BlueLake",
    "task.bead_id": "bd-xyz-001",
    "task.strategy": "file-based",
    "task.files_touched": "src/a.ts,src/b.ts",
    "task.error_count": 0,
    "task.retry_count": 0,
    "task.success": true
  },
  "status": {
    "code": "OK"
  },
  "events": [
    {
      "timeUnixNano": 1703001235000000000,
      "name": "file_reserved",
      "attributes": {
        "paths": "src/a.ts,src/b.ts",
        "exclusive": true
      }
    },
    {
      "timeUnixNano": 1703001238000000000,
      "name": "message_sent",
      "attributes": {
        "to": "coordinator",
        "subject": "Progress: bd-xyz-001"
      }
    }
  ]
}
```

---

*This ADR was generated by RedOcean, a swarm worker agent, as part of the observability research spike.*
