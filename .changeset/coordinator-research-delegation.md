---
"opencode-swarm-plugin": minor
---

## 🐝 Coordinators Now Delegate Research to Workers

Coordinators finally know their place. They orchestrate, they don't fetch.

**The Problem:**
Coordinators were calling `repo-crawl_file`, `webfetch`, `context7_*` directly, burning expensive Sonnet context on raw file contents instead of spawning researcher workers.

**The Fix:**

### Forbidden Tools Section
COORDINATOR_PROMPT now explicitly lists tools coordinators must NEVER call:
- `repo-crawl_*`, `repo-autopsy_*` - repository fetching
- `webfetch`, `fetch_fetch` - web fetching
- `context7_*` - library documentation
- `pdf-brain_search`, `pdf-brain_read` - knowledge base

### Phase 1.5: Research Phase
New workflow phase between Initialize and Knowledge Gathering:
```
swarm_spawn_researcher(
  research_id="research-nextjs-cache",
  tech_stack=["Next.js 16 Cache Components"],
  project_path="/path/to/project"
)
```

### Strong Coordinator Identity Post-Compaction
When context compacts, the resuming agent now sees:
```
┌─────────────────────────────────────────────────────────────┐
│             🐝  YOU ARE THE COORDINATOR  🐝                 │
│             NOT A WORKER. NOT AN IMPLEMENTER.               │
│                  YOU ORCHESTRATE.                           │
└─────────────────────────────────────────────────────────────┘
```

### runResearchPhase Returns Spawn Instructions
```typescript
const result = await runResearchPhase(task, projectPath);
// result.spawn_instructions = [
//   { research_id, tech, prompt, subagent_type: "swarm/researcher" }
// ]
```

**32+ new tests, all 425 passing.**
