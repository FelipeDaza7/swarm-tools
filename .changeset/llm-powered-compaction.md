---
"opencode-swarm-plugin": minor
---

## 🐝 LLM-Powered Compaction: The Swarm Remembers

> "The best way to predict the future is to invent it." — Alan Kay

Compaction just got smarter. Instead of static "here's what to preserve" instructions, the swarm now **generates dynamic continuation prompts** with actual state data.

**What changed:**

The `experimental.session.compacting` hook now uses a three-level fallback chain:

1. **LLM-Generated Prompt** (NEW) - Queries actual swarm state (cells, epics, subtasks), shells out to `opencode run -m <liteModel>` to generate a structured continuation prompt with real IDs, real status, real next actions
2. **Static Context** - Falls back to `SWARM_COMPACTION_CONTEXT` if LLM fails
3. **Detection Fallback** - For low-confidence swarm detection, injects `SWARM_DETECTION_FALLBACK`
4. **None** - No injection if no swarm evidence

**Progressive Enhancement:**

Uses OpenCode PR #5907's new `output.prompt` API when available:
```typescript
if ("prompt" in output) {
  output.prompt = llmGeneratedPrompt;  // Replaces entire compaction prompt
} else {
  output.context.push(llmGeneratedPrompt);  // Old API fallback
}
```

**New interfaces:**
- `SwarmStateSnapshot` - Structured state for LLM input
- `querySwarmState()` - Queries cells via swarm CLI
- `generateCompactionPrompt()` - Shells out to lite model (30s timeout)

**Why it matters:**

Before: "Hey, you should preserve swarm state" (agent has to figure out what that means)
After: "Here's epic bd-xyz with 3/5 subtasks done, bd-xyz.2 is blocked on auth, spawn bd-xyz.4 next"

The coordinator wakes up from compaction with **concrete data**, not instructions to go find data.

**Backward compatible:** Falls back gracefully on older OpenCode versions or LLM failures.
