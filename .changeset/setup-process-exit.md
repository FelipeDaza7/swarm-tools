---
"opencode-swarm-plugin": patch
---

## 🚪 Setup Now Exits Cleanly After Migration

Fixed a process hang where `swarm setup` would complete the migration but never exit.

**Root cause:** The PGLite connection created for memory migration kept the Node.js event loop alive indefinitely.

**Fix:** Close the swarmMail connection after migration completes. The connection is scoped to the migration block and not needed afterward.

```typescript
// After migration completes
await swarmMail.close();
```

**Before:** `swarm setup` hangs after "Migration complete" message
**After:** Process exits cleanly, returns to shell
