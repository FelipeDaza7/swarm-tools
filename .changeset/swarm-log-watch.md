---
"opencode-swarm-plugin": minor
---

## 👁️ Watch Your Swarm in Real-Time

`swarm log` now has a `--watch` mode for continuous log monitoring. No more running the command repeatedly - just sit back and watch the bees work.

```bash
# Watch all logs
swarm log --watch

# Watch with filters
swarm log compaction -w --level error

# Faster polling (500ms instead of default 1s)
swarm log --watch --interval 500
```

**New flags:**
- `--watch`, `-w` - Enable continuous monitoring mode
- `--interval <ms>` - Poll interval in milliseconds (default: 1000, min: 100)

**How it works:**
- Shows initial logs (last N lines based on `--limit`)
- Polls log files for new entries at the specified interval
- Tracks file positions for efficient incremental reads
- Handles log rotation gracefully (detects file truncation)
- All existing filters work: `--level`, `--since`, module name
- Clean shutdown on Ctrl+C

*"The hive that watches itself, debugs itself."*
