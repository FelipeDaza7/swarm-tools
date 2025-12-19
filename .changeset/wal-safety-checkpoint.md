---
"swarm-mail": minor
---

## 🛡️ WAL Safety: The Checkpoint That Saved the Hive

PGlite's Write-Ahead Log nearly ate our lunch. 930 WAL files. 930MB of uncommitted transactions. 
One WASM OOM crash later, pdf-brain lost 359 documents.

**Never again.**

### What Changed

**New DatabaseAdapter methods:**
```typescript
// Force WAL flush to data files
await db.checkpoint();

// Monitor WAL health (default 100MB threshold)
const { healthy, message } = await db.checkWalHealth(100);

// Get raw stats
const { walSize, walFileCount } = await db.getWalStats();
```

**Automatic checkpoints after:**
- Hive migrations complete
- Streams migrations complete
- Any batch operation that touches multiple records

**Health check integration:**
```typescript
const health = await swarmMail.healthCheck();
// { connected: true, walHealth: { healthy: true, message: "WAL healthy: 2.5MB (3 files)" } }
```

### Why It Matters

PGlite in embedded mode accumulates WAL files without explicit CHECKPOINT calls. Each unclean shutdown compounds the problem. Eventually: OOM.

The fix is simple but critical:
1. **Checkpoint after batch ops** - forces WAL to data files, allows recycling
2. **Monitor WAL size** - warn at 100MB, not 930MB
3. **Prefer daemon mode** - single long-lived process handles its own WAL

### Deployment Recommendation

**Use daemon mode in production.** Multiple short-lived PGlite instances compound WAL accumulation. A single daemon process:
- Owns the database connection
- Checkpoints naturally during operation
- Cleans up properly on shutdown

See README.md "Deployment Modes" section for details.

### The Lesson

> "The database doesn't forget. It just waits."

WAL is a feature, not a bug. But like any feature, it needs care and feeding. 
Now swarm-mail feeds it automatically.
