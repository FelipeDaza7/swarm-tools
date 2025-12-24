---
"opencode-swarm-plugin": minor
---

## 🪵 Pino Logging Infrastructure

> "You can't improve what you can't measure." — Peter Drucker

Finally, visibility into what the swarm is actually doing.

### What's New

**Structured Logging with Pino**
- Daily log rotation via `pino-roll` (14-day retention)
- Logs to `~/.config/swarm-tools/logs/`
- Module-specific log files (e.g., `compaction.1log`, `swarm.1log`)
- Pretty mode for development: `SWARM_LOG_PRETTY=1`

**Compaction Hook Instrumented**
- 14 strategic log points across all phases
- START: session context, trigger reason
- GATHER: per-source timing (hive, swarm-mail, skills)
- DETECT/INJECT: confidence scores, context decisions
- COMPLETE: duration, success, what was injected

**New CLI: `swarm log`**
```bash
swarm log                    # Tail recent logs
swarm log compaction         # Filter by module
swarm log --level warn       # Filter by severity
swarm log --since 1h         # Last hour only
swarm log --json | jq        # Pipe to jq for analysis
```

### Why This Matters

The compaction hook does a LOT of work with zero visibility:
- Context injection decisions
- Data gathering from multiple sources
- Template rendering and size calculations

Now you can answer: "What did compaction do on the last run?"

### Technical Details

- Pino + pino-roll for async, non-blocking file writes
- Child loggers for module namespacing
- Lazy initialization pattern for test isolation
- 56 new tests (10 logger + 18 compaction + 28 CLI)

Complements existing `DEBUG=swarm:*` env var approach — Pino for structured file logs, debug for stderr filtering.
