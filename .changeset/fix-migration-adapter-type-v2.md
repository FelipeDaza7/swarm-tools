---
"opencode-swarm-plugin": patch
---

## 🐝 Fix Migration Adapter Type (for real this time)

The previous release (0.30.3) was published before this fix landed. Now it's actually in.

**The Bug:**
```
targetDb.query is not a function
```

**Root Cause:**
`getSwarmMail()` returns `SwarmMailAdapter`, not `DatabaseAdapter`. Need to call `getDatabase()` first.

**The Fix:**
```typescript
const swarmMail = await getSwarmMail(cwd);
const targetDb = await swarmMail.getDatabase(cwd);
```
