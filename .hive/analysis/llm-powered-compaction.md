# Architecture Decision Record: LLM-Powered Compaction

**Date:** 2025-12-23  
**Status:** Accepted  
**Epic:** opencode-swarm-monorepo-lf2p4u-mjithnuayc9  
**Authors:** ADR-Writer (SilverMountain)

---

## Context

### The Problem

OpenCode compaction happens when a session's context window fills up. The system summarizes the conversation and creates a continuation prompt for the resumed session. For swarm coordination, this is critical - if state isn't preserved, the coordinator loses track of:

- Which epic is running
- What subtasks are active/blocked/done
- File reservations and agent assignments
- Recent blockers and messages
- What should happen next

**Current implementation** (as of v0.31.0):

```typescript
"experimental.session.compacting": async (input, output) => {
  const detection = await detectSwarm();
  
  if (detection.confidence === "high" || detection.confidence === "medium") {
    output.context.push(SWARM_COMPACTION_CONTEXT);
  }
}
```

This pushes a **static string** (`SWARM_COMPACTION_CONTEXT`) that tells the LLM *what* to preserve:

> "Extract from session context:
> 1. Epic & Subtasks - IDs, titles, status, file assignments
> 2. What's Running - Which agents are active..."

**The issue:** This is an *instruction*, not actual *data*. The resumed session still has to re-discover state by calling `swarm_status()` and `swarmmail_inbox()`. If those calls fail or the session misinterprets the summary, coordination breaks.

### OpenCode PR #5907: `output.prompt` API

OpenCode PR #5907 introduces a new capability: plugins can now **replace the entire compaction prompt** instead of just appending context.

**New API:**

```typescript
type CompactionOutput = {
  context: string[];  // Existing: append to compactor's instructions
  prompt?: string;    // NEW: completely replace the prompt
}
```

**Progressive enhancement:** If OpenCode doesn't have `output.prompt` (older versions), the plugin falls back to `output.context.push()`.

This enables **LLM-powered compaction** - using a lite model (Haiku) to pre-analyze the session and generate a structured continuation prompt with actual state data.

---

## Decision

### Use LLM Pre-Analysis for Swarm Compaction

When a swarm session is being compacted, **shell out to a lite model** (OpenCode's configured `liteModel`, typically Haiku) to analyze the session and generate a dynamic continuation prompt.

**Flow:**

```
Session filling up
    ↓
experimental.session.compacting hook fires
    ↓
detectSwarm() checks for active swarm
    ↓
IF swarm detected (high/medium confidence):
    ↓
1. Query actual state:
   - hive_query({ status: "in_progress" })
   - swarmmail_inbox(limit=10)
   - Epic/subtask details
    ↓
2. Shell out to lite model:
   opencode run -m <liteModel> "Analyze swarm state and generate continuation prompt"
    ↓
3. LLM returns structured prompt with:
   - Epic ID, title, current status
   - Subtask states (running/blocked/done/pending) with IDs
   - File reservations and agents
   - Recent blockers and messages
   - Concrete next actions
    ↓
4. IF output.prompt exists (OpenCode ≥ #5907):
     output.prompt = <LLM-generated prompt>
   ELSE:
     output.context.push(<LLM-generated prompt>)
    ↓
Resumed session has concrete state, not just instructions
```

### Key Design Decisions

#### 1. Shell Out to `opencode run` (Not Import LLM Client)

**Decision:** Use `opencode run -m <liteModel>` subprocess, not a direct SDK import.

**Rationale:**
- Respects user's configured lite model (no hardcoded Haiku)
- Reuses OpenCode's authentication, rate limiting, error handling
- No new dependencies (no `@anthropic-ai/sdk`, no API key management)
- Consistent with swarm plugin philosophy: shell out to existing infrastructure

**Tradeoff:**
- Subprocess overhead (~1-2 seconds)
- Acceptable because compaction is already expensive (summarizing full context)
- Subprocess failure is graceful - fall back to static prompt

**Implementation:**

```typescript
const liteModel = process.env.OPENCODE_LITE_MODEL || "claude-3-5-haiku-20241022";

const result = await execCommand([
  "opencode", "run", "-m", liteModel,
  "--", 
  `Analyze this swarm state and generate a continuation prompt:\n${JSON.stringify(state)}`
]);
```

#### 2. Progressive Enhancement (API Guard)

**Decision:** Check if `output.prompt` exists before using it.

**Rationale:**
- Backward compatibility with OpenCode versions < #5907
- Feature works on old versions (via `context.push()`), better on new versions (via `prompt`)
- Users don't need to upgrade OpenCode to benefit

**Implementation:**

```typescript
const continuationPrompt = await generateCompactionPrompt(state);

if ("prompt" in output) {
  // NEW API: Replace entire prompt (preferred)
  output.prompt = continuationPrompt;
} else {
  // OLD API: Append to context
  output.context.push(continuationPrompt);
}
```

#### 3. Three-Level Fallback Chain

**Decision:** Graceful degradation through 3 fallback levels.

**Fallback chain:**

```
1. LLM-generated prompt (best)
     ↓ (LLM call fails, timeout, quota exceeded)
2. Static SWARM_COMPACTION_CONTEXT (good)
     ↓ (detectSwarm() fails, can't query state)
3. SWARM_DETECTION_FALLBACK (minimal)
     ↓ (no swarm detected)
4. No injection (safe default)
```

**Rationale:**
- LLM failures are unpredictable (quotas, network, model errors)
- Static prompts still better than nothing
- Never crash compaction - it's a critical operation

**Implementation:**

```typescript
try {
  // Level 1: Try LLM-powered generation
  const prompt = await generateCompactionPrompt(state);
  injectPrompt(output, prompt);
} catch (err) {
  console.error("LLM compaction failed, using static prompt:", err);
  
  // Level 2: Fall back to static context
  if (detection.confidence === "high" || detection.confidence === "medium") {
    output.context.push(SWARM_COMPACTION_CONTEXT);
  } else if (detection.confidence === "low") {
    // Level 3: Fallback detection prompt
    output.context.push(SWARM_DETECTION_FALLBACK);
  }
  // Level 4: No injection if confidence === "none"
}
```

#### 4. Input to LLM: Structured State Snapshot

**Decision:** Pass structured data, not raw conversation text.

**Input format:**

```typescript
interface SwarmStateSnapshot {
  sessionID: string;
  detection: {
    confidence: "high" | "medium" | "low" | "none";
    reasons: string[];
  };
  epic?: {
    id: string;
    title: string;
    status: string;
    subtasks: Array<{
      id: string;
      title: string;
      status: "open" | "in_progress" | "blocked" | "closed";
      files: string[];
      assignedTo?: string;
    }>;
  };
  messages: Array<{
    from: string;
    to: string[];
    subject: string;
    body: string;
    timestamp: number;
    importance?: string;
  }>;
  reservations: Array<{
    agent: string;
    paths: string[];
    exclusive: boolean;
    expiresAt: number;
  }>;
}
```

**Rationale:**
- Structured data is easier for LLM to parse than free-form conversation
- We have the query tools (`hive_query`, `swarmmail_inbox`) - use them
- Reduces token usage (only relevant state, not full conversation)
- Deterministic - same state produces consistent prompts

#### 5. Output from LLM: Structured Continuation Prompt

**Decision:** LLM generates a markdown prompt with specific sections.

**Expected output format:**

```markdown
# 🐝 Swarm Continuation - [Epic Title]

You are resuming coordination of an active swarm that was interrupted by context compaction.

## Epic State

**ID:** bd-abc123  
**Title:** Implement OAuth authentication  
**Status:** 3/5 subtasks complete  
**Project:** /Users/joel/Code/myapp

## Subtask Status

### ✅ Completed (3)
- bd-abc123.1: Database schema for users (RedMountain)
- bd-abc123.2: Auth service implementation (BlueLake)
- bd-abc123.3: JWT token generation (GreenValley)

### 🚧 In Progress (1)
- bd-abc123.4: Refresh token rotation (SilverMountain)
  - Files: src/auth/refresh.ts, src/auth/tokens.ts
  - Status: Last update 5min ago - implementing expiry buffer

### 🚫 Blocked (0)

### ⏳ Pending (1)
- bd-abc123.5: OAuth provider integration
  - Files: src/auth/providers/*.ts
  - Dependencies: Waiting for bd-abc123.4 (refresh tokens)

## Recent Messages

1. **SilverMountain → coordinator** (2min ago):
   Subject: "Progress: bd-abc123.4"
   Body: "Token refresh implemented with 5min buffer. Running tests."

## File Reservations

- src/auth/refresh.ts (exclusive) - SilverMountain, expires in 55min
- src/auth/tokens.ts (exclusive) - SilverMountain, expires in 55min

## Next Actions (IMMEDIATE)

1. **Check worker progress:**
   ```
   swarmmail_inbox(limit=5)
   ```

2. **Review completed work if any:**
   ```
   swarm_review(project_key="/Users/joel/Code/myapp", epic_id="bd-abc123", task_id="bd-abc123.4", files_touched=["src/auth/refresh.ts"])
   ```

3. **Spawn pending subtask when bd-abc123.4 completes:**
   ```
   swarm_spawn_subtask(bead_id="bd-abc123.5", epic_id="bd-abc123", subtask_title="OAuth provider integration", files=["src/auth/providers/*.ts"])
   ```

4. **Close epic when all subtasks done:**
   - Verify all work integrated
   - Run full test suite
   - Close epic with summary

## Coordinator Reminders

- **You are the coordinator** - Don't wait for instructions, orchestrate
- **Monitor actively** - Check messages every ~10 minutes
- **Unblock aggressively** - Resolve dependencies immediately
- **Review thoroughly** - 3-strike rule enforced (max 3 rejections per task)
- **Ship it** - When all subtasks done, close the epic and celebrate
```

**Rationale:**
- Concrete data > abstract instructions
- Resumed session can act immediately (no need to re-query state)
- Includes next actions with actual commands (copy-pasteable)
- Structured format is scannable and actionable

---

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1)

```typescript
// File: packages/opencode-swarm-plugin/src/compaction-llm.ts

export interface SwarmStateSnapshot { /* ... */ }

export async function generateCompactionPrompt(
  snapshot: SwarmStateSnapshot,
  liteModel?: string
): Promise<string> {
  // Shell out to opencode run
  // Parse LLM response
  // Validate structure
  // Return prompt
}

export async function querySwarmState(
  projectPath: string
): Promise<SwarmStateSnapshot> {
  // Call hive_query via HiveAdapter
  // Call swarm mail API for messages
  // Format as snapshot
}
```

### Phase 2: Hook Integration (Week 1)

```typescript
// File: packages/opencode-swarm-plugin/examples/plugin-wrapper-template.ts

"experimental.session.compacting": async (input, output) => {
  const detection = await detectSwarm();
  
  if (detection.confidence === "high" || detection.confidence === "medium") {
    try {
      // Query actual state
      const snapshot = await querySwarmState(projectDirectory);
      
      // Generate prompt with LLM
      const prompt = await generateCompactionPrompt(snapshot);
      
      // Inject via new API (progressive enhancement)
      if ("prompt" in output) {
        output.prompt = prompt;  // NEW API
      } else {
        output.context.push(prompt);  // OLD API
      }
    } catch (err) {
      console.error("LLM compaction failed:", err);
      // Fallback to static prompt
      output.context.push(SWARM_COMPACTION_CONTEXT);
    }
  } else if (detection.confidence === "low") {
    output.context.push(SWARM_DETECTION_FALLBACK);
  }
}
```

### Phase 3: Testing & Validation (Week 2)

- Unit tests for `generateCompactionPrompt()`
- Integration tests for full compaction flow
- Fallback behavior tests (LLM failures, API unavailable)
- Backward compatibility tests (old OpenCode versions)
- Token usage analysis (ensure LLM calls are efficient)

### Phase 4: Documentation (Week 2)

- Update plugin README with compaction behavior
- Document environment variables (`OPENCODE_LITE_MODEL`)
- Add troubleshooting guide for compaction failures
- Create example compaction prompts in docs

---

## Consequences

### Positive

1. **Concrete State Preservation**
   - Resumed sessions have actual epic/subtask data, not just instructions
   - No need to re-query `swarm_status()` and risk failures
   - Coordinator can act immediately with specific IDs and commands

2. **Better Resume Quality**
   - LLM analyzes actual state, not just conversation text
   - Structured output is consistent and actionable
   - Next actions are concrete commands, not vague guidance

3. **Progressive Enhancement**
   - Works on old OpenCode versions (via `context.push()`)
   - Better on new versions (via `prompt` replacement)
   - Graceful fallback chain prevents catastrophic failures

4. **No New Dependencies**
   - Shells out to existing `opencode run` infrastructure
   - Respects user's lite model configuration
   - No API key management or SDK imports

5. **Learning Opportunity**
   - Compaction prompts become training data
   - Can analyze which resumption strategies work best
   - Potential to fine-tune lite model on swarm resumption

### Negative

1. **Subprocess Overhead**
   - LLM call adds 1-2 seconds to compaction
   - Acceptable because compaction is already expensive
   - Mitigated by fallback to static prompt on timeout

2. **LLM Unpredictability**
   - Lite model may generate invalid/incomplete prompts
   - Rate limits or quotas could cause failures
   - Mitigated by fallback chain and validation

3. **Complexity**
   - Adds another moving part to compaction
   - More failure modes to handle
   - Mitigated by comprehensive error handling and logging

4. **Token Usage**
   - Each compaction consumes lite model tokens
   - Typical cost: ~500-1000 tokens per compaction
   - Acceptable because Haiku is cheap (~$0.001 per compaction)

5. **Debugging Difficulty**
   - Generated prompts may be inconsistent
   - Hard to reproduce exact compaction behavior
   - Mitigated by logging prompts to `.hive/compaction-logs/`

---

## Alternatives Considered

### Alternative 1: Static Template with String Interpolation

**Approach:** Use a template string with placeholders, fill in state data without LLM.

```typescript
const prompt = TEMPLATE
  .replace("{epic_id}", epic.id)
  .replace("{epic_title}", epic.title)
  .replace("{subtasks}", formatSubtasks(epic.subtasks));
```

**Why rejected:**
- Brittle - requires maintaining complex templates
- Poor handling of edge cases (no subtasks, all blocked, etc.)
- Doesn't adapt to context (e.g., urgent blockers vs smooth sailing)
- LLM can summarize and prioritize better than static logic

### Alternative 2: Import Anthropic SDK Directly

**Approach:** `import Anthropic from "@anthropic-ai/sdk"` and call Haiku directly.

**Why rejected:**
- Adds dependency and increases plugin size
- Requires API key management (user configuration)
- Bypasses OpenCode's rate limiting and error handling
- Doesn't respect user's configured lite model
- Shell out is simpler and more flexible

### Alternative 3: Store State in Database, Resume from DB

**Approach:** Persist swarm state in swarm-mail database, resume from DB instead of prompt.

**Why rejected:**
- OpenCode session state is in conversation history, not external DB
- Compaction prompt is the mechanism OpenCode provides
- Database approach doesn't solve the resumption problem (still need prompt to tell agent to check DB)
- Over-engineering - prompt-based resumption is simpler

### Alternative 4: No LLM, Just Better Static Prompt

**Approach:** Keep static prompt but make it more explicit about state queries.

```typescript
const prompt = `
Check these immediately on resume:
1. swarm_status(epic_id="${epicID}", project_key="${projectPath}")
2. swarmmail_inbox(limit=10)
...
`;
```

**Why rejected:**
- Still requires re-querying state (slow, can fail)
- Doesn't embed actual data (epic still unknown if query fails)
- Misses opportunity for LLM to analyze and prioritize
- Doesn't leverage OpenCode's new `output.prompt` API

---

## Success Criteria

### MVP (2 weeks)

- [ ] `generateCompactionPrompt()` function working with Haiku
- [ ] Progressive enhancement (handles both old/new OpenCode APIs)
- [ ] Three-level fallback chain (LLM → static → detection → none)
- [ ] Unit tests for prompt generation and fallback behavior
- [ ] Integration test: compact a swarm session, verify resumption works

### Full Feature (4 weeks)

- [ ] Token usage optimized (<1000 tokens per compaction)
- [ ] Logging to `.hive/compaction-logs/` for debugging
- [ ] Documentation and examples
- [ ] Error handling for all LLM failure modes
- [ ] Backward compatibility tested with OpenCode versions < #5907

### Stretch Goals

- [ ] Compaction prompt templates for different swarm patterns
- [ ] A/B testing: LLM vs static prompts (measure resumption quality)
- [ ] Fine-tune lite model on successful compaction prompts
- [ ] Support for custom user-provided compaction strategies

---

## References

- **OpenCode PR #5907:** "feat: Add `output.prompt` to compaction hook"
- **Existing Implementation:** `packages/opencode-swarm-plugin/examples/plugin-wrapper-template.ts` (lines 1020-1226)
- **Swarm Detection:** `detectSwarm()` function (checks for in_progress cells, open subtasks, unclosed epics)
- **Static Prompts:** `SWARM_COMPACTION_CONTEXT` and `SWARM_DETECTION_FALLBACK`

---

## Glossary

| Term | Definition |
|------|------------|
| **Compaction** | OpenCode's context summarization when session fills up |
| **Continuation Prompt** | The prompt given to resumed session after compaction |
| **Lite Model** | Fast, cheap LLM (e.g., Haiku) for quick inference |
| **Progressive Enhancement** | Feature works on old systems, better on new ones |
| **Fallback Chain** | Series of increasingly degraded behaviors when primary fails |
| **Swarm Detection** | Heuristics to determine if session involves swarm coordination |

---

*This ADR documents the architectural decision for LLM-powered compaction in the opencode-swarm-plugin. Implementation tracked in epic: opencode-swarm-monorepo-lf2p4u-mjithnuayc9.*
