---
"opencode-swarm-plugin": minor
---

Add swarm-aware compaction hook to keep swarms cooking after context compression

- New `experimental.session.compacting` hook detects active swarms and injects recovery context
- `hasSwarmSign()` checks for swarm evidence: in-progress beads, subtasks, unclosed epics
- Compaction prompt instructs coordinator to immediately resume orchestration
- Fix @types/node conflicts by pinning to 22.19.3 in root overrides
