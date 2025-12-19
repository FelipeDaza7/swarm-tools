---
"opencode-swarm-plugin": patch
---

## 🐝 Short Hashes Now Welcome

The WorkerHandoff schema was too strict - it rejected short project names and partial hashes.

**Before:** Required 3+ hyphen-separated segments (regex nightmare)
```
/^[a-z0-9]+(-[a-z0-9]+){2,}(\.[\w-]+)?$/
```

**After:** Any non-empty string, validated at runtime via `resolvePartialId()`

Now you can use:
- Full IDs: `opencode-swarm-monorepo-lf2p4u-mjd4pjujc7e`
- Short hashes: `mjd4pjujc7e`
- Partial hashes: `mjd4pjuj`

The hive tools already had smart ID resolution - we just needed to stop blocking it at the schema level.
