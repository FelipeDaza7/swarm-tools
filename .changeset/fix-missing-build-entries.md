---
"opencode-swarm-plugin": patch
---

## 🔧 Build Now Ships All Entry Points

> *"A change to PATCH states that bug fixes have been made to existing functionality."*
> — Building Microservices, Sam Newman

Fixed missing `hive.js` and `swarm-prompts.js` from published package. These entry points were defined in `package.json` exports but weren't being built.

**What was broken:**
- `opencode-swarm-plugin/hive` → 404
- `opencode-swarm-plugin/swarm-prompts` → 404

**What's fixed:**
- All 6 entry points now build correctly
- Refactored build to `scripts/build.ts` with config-driven parallel builds
- Adding new entry points is now a one-liner

**If you hit "Cannot find module" errors** on hive or swarm-prompts imports, upgrade to this version.
