# opencode-swarm-plugin

[![npm version](https://img.shields.io/npm/v/opencode-swarm-plugin.svg)](https://www.npmjs.com/package/opencode-swarm-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Multi-agent swarm coordination for [OpenCode](https://opencode.ai) with learning capabilities, beads integration, and Agent Mail.

## What It Does

Break complex tasks into parallel subtasks, spawn agents to work on them, and coordinate via messaging. The plugin learns from outcomes to improve future decompositions.

- **Swarm coordination** - Decompose tasks, spawn parallel agents, track progress
- **Beads integration** - Git-backed issue tracking with type-safe wrappers
- **Agent Mail** - File reservations, async messaging between agents
- **Learning** - Tracks what works, avoids patterns that fail
- **Graceful degradation** - Works with whatever tools are available

## Quick Start

```bash
# 1. Install required dependencies
brew install sst/tap/opencode
curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash

# 2. Install the plugin globally
npm install -g opencode-swarm-plugin

# 3. Run setup (creates plugin wrapper, /swarm command, @swarm-planner agent)
swarm setup

# 4. Check all dependencies
swarm doctor

# 5. Initialize beads in your project
cd your-project
bd init
```

That's it! Now use `/swarm "your task"` in OpenCode.

### 2. Install Plugin

```bash
npm install -g opencode-swarm-plugin
```

### 3. Create Plugin Wrapper

Create `~/.config/opencode/plugins/swarm.ts`:

```ts
import { SwarmPlugin } from "opencode-swarm-plugin";
export default SwarmPlugin;
```

### 4. Add the /swarm Command

Create `~/.config/opencode/commands/swarm.md`:

```markdown
---
description: Decompose task into parallel subtasks and coordinate agents
---

You are a swarm coordinator. Take a complex task, break it into beads, and unleash parallel agents.

## Usage

/swarm <task description or bead-id>

## Workflow

1. **Initialize**: `agentmail_init` with project_path and task_description
2. **Decompose**: Use `swarm_select_strategy` then `swarm_plan_prompt` to break down the task
3. **Create beads**: `beads_create_epic` with subtasks and file assignments
4. **Reserve files**: `agentmail_reserve` for each subtask's files
5. **Spawn agents**: Use Task tool with `swarm_spawn_subtask` prompts - spawn ALL in parallel
6. **Monitor**: Check `agentmail_inbox` for progress, use `agentmail_summarize_thread` for overview
7. **Complete**: `swarm_complete` when done, then `beads_sync` to push

## Strategy Selection

The plugin auto-selects decomposition strategy based on task keywords:

| Strategy      | Best For                | Keywords                               |
| ------------- | ----------------------- | -------------------------------------- |
| file-based    | Refactoring, migrations | refactor, migrate, rename, update all  |
| feature-based | New features            | add, implement, build, create, feature |
| risk-based    | Bug fixes, security     | fix, bug, security, critical, urgent   |

Begin decomposition now.
```

### 5. Add the @swarm-planner Agent

Create `~/.config/opencode/agents/swarm-planner.md`:

```markdown
---
name: swarm-planner
description: Strategic task decomposition for swarm coordination
model: claude-sonnet-4-5
---

You are a swarm planner. Decompose tasks into optimal parallel subtasks.

## Workflow

1. Call `swarm_select_strategy` to analyze the task
2. Call `swarm_plan_prompt` to get strategy-specific guidance
3. Create a BeadTree following the guidelines
4. Return ONLY valid JSON - no markdown, no explanation

## Output Format

{
"epic": { "title": "...", "description": "..." },
"subtasks": [
{
"title": "...",
"description": "...",
"files": ["src/..."],
"dependencies": [],
"estimated_complexity": 2
}
]
}

## Rules

- 2-7 subtasks (too few = not parallel, too many = overhead)
- No file overlap between subtasks
- Include tests with the code they test
- Order by dependency (if B needs A, A comes first)
```

### 6. Initialize Beads in Your Project

```bash
cd your-project
bd init
```

## Usage

```bash
# In OpenCode, run:
/swarm "Add user authentication with OAuth"

# Or invoke the planner directly:
@swarm-planner "Refactor all components to use hooks"
```

## Dependencies

| Dependency                                                      | Purpose                               | Install                                                                                         | Required |
| --------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------- | -------- |
| [OpenCode](https://opencode.ai)                                 | Plugin host                           | `brew install sst/tap/opencode`                                                                 | Yes      |
| [Beads](https://github.com/steveyegge/beads)                    | Git-backed issue tracking             | `curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh \| bash` | Yes      |
| [Agent Mail](https://github.com/joelhooks/agent-mail)           | Multi-agent coordination              | `go install github.com/joelhooks/agent-mail/cmd/agent-mail@latest`                              | No\*     |
| [CASS](https://github.com/Dicklesworthstone/cass)               | Historical context from past sessions | See repo                                                                                        | No\*     |
| [UBS](https://github.com/joelhooks/ubs)                         | Pre-completion bug scanning           | See repo                                                                                        | No\*     |
| [semantic-memory](https://github.com/joelhooks/semantic-memory) | Learning persistence                  | `npm install -g semantic-memory`                                                                | No\*     |
| [Redis](https://redis.io)                                       | Rate limiting                         | `brew install redis`                                                                            | No\*     |

\*The plugin gracefully degrades without optional dependencies.

> **Tip**: Use [beads_viewer](https://github.com/Dicklesworthstone/beads_viewer) for a web UI to visualize your beads.

### Verify Installation

```bash
swarm doctor
```

This checks all dependencies and shows install commands for anything missing.

## Tools Reference

### Swarm Tools

| Tool                           | Description                                                         |
| ------------------------------ | ------------------------------------------------------------------- |
| `swarm_select_strategy`        | Analyze task and recommend decomposition strategy                   |
| `swarm_plan_prompt`            | Generate strategy-specific planning prompt with CASS integration    |
| `swarm_decompose`              | Generate decomposition prompt (lower-level than plan_prompt)        |
| `swarm_validate_decomposition` | Validate decomposition response, detect conflicts                   |
| `swarm_spawn_subtask`          | Generate prompt for worker agent with Agent Mail/beads instructions |
| `swarm_complete`               | Mark subtask complete, run UBS scan, release reservations           |
| `swarm_status`                 | Get swarm status by epic ID                                         |
| `swarm_progress`               | Report progress on a subtask                                        |
| `swarm_record_outcome`         | Record outcome for learning (duration, errors, retries)             |

### Beads Tools

| Tool                | Description                                 |
| ------------------- | ------------------------------------------- |
| `beads_create`      | Create a new bead with type-safe validation |
| `beads_create_epic` | Create epic with subtasks atomically        |
| `beads_query`       | Query beads with filters                    |
| `beads_update`      | Update bead status/description/priority     |
| `beads_close`       | Close a bead with reason                    |
| `beads_start`       | Mark bead as in-progress                    |
| `beads_ready`       | Get next unblocked bead                     |
| `beads_sync`        | Sync beads to git and push                  |

### Agent Mail Tools

| Tool                         | Description                                    |
| ---------------------------- | ---------------------------------------------- |
| `agentmail_init`             | Initialize session, register agent             |
| `agentmail_send`             | Send message to other agents                   |
| `agentmail_inbox`            | Fetch inbox (max 5, no bodies - context safe)  |
| `agentmail_read_message`     | Fetch ONE message body by ID                   |
| `agentmail_summarize_thread` | Summarize thread (preferred over fetching all) |
| `agentmail_reserve`          | Reserve file paths for exclusive editing       |
| `agentmail_release`          | Release file reservations                      |

### Structured Output Tools

| Tool                         | Description                                    |
| ---------------------------- | ---------------------------------------------- |
| `structured_extract_json`    | Extract JSON from markdown/text                |
| `structured_validate`        | Validate response against schema               |
| `structured_parse_bead_tree` | Parse and validate bead tree for epic creation |

## Decomposition Strategies

### File-Based

Best for refactoring, migrations, pattern changes.

- Group files by directory or type
- Handle shared types/utilities first
- Minimize cross-directory dependencies

### Feature-Based

Best for new features, adding functionality.

- Each subtask is a complete vertical slice
- Start with data layer, then logic, then UI
- Keep related components together

### Risk-Based

Best for bug fixes, security issues.

- Write tests FIRST
- Isolate risky changes
- Audit similar code for same issue

## Learning

The plugin learns from outcomes:

- **Confidence decay** - Criteria weights fade unless revalidated (90-day half-life)
- **Implicit feedback** - Fast + success = helpful, slow + errors = harmful
- **Pattern maturity** - candidate → established → proven (or deprecated)
- **Anti-patterns** - Patterns with >60% failure rate auto-invert

## Context Preservation

The plugin enforces context-safe defaults:

| Constraint          | Default    | Reason                         |
| ------------------- | ---------- | ------------------------------ |
| Inbox limit         | 5 messages | Prevents context exhaustion    |
| Bodies excluded     | Always     | Fetch individually when needed |
| Summarize preferred | Yes        | Key points, not raw dump       |

## Rate Limiting

Client-side rate limits (Redis primary, SQLite fallback):

| Endpoint | Per Minute | Per Hour |
| -------- | ---------- | -------- |
| send     | 20         | 200      |
| reserve  | 10         | 100      |
| inbox    | 60         | 600      |

Configure via `OPENCODE_RATE_LIMIT_{ENDPOINT}_PER_MIN` env vars.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

## License

MIT
