---
"opencode-swarm-plugin": patch
"swarm-mail": patch
---

Fix swarm_complete tool execution failures and remove debug logging

**opencode-swarm-plugin:**
- Fix: Made sendSwarmMessage non-fatal in swarm_complete - failures no longer cause "Tool execution failed" errors
- Fix: Added message_sent and message_error fields to swarm_complete response for better error visibility
- Chore: Removed console.log statements from index.ts, swarm-orchestrate.ts, storage.ts, rate-limiter.ts
- Test: Added integration tests for swarm_complete error handling

**swarm-mail:**
- Chore: Cleaned up debug logging and improved migration handling
