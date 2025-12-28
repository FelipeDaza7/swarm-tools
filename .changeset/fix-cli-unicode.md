---
"opencode-swarm-plugin": patch
---

## 🐝 CLI Unicode Fixed

```
  BEFORE (bundled @clack):          AFTER (externalized):
  â–¡ Something went wrong            ◇ Something went wrong  
  â–ˆ Checking dependencies           ◆ Checking dependencies
```

The CLI was showing garbled unicode instead of proper box-drawing characters. 

**Root cause:** `@clack/prompts` detects unicode support at module load using `process.env.TERM`. When bundled, this detection happened at *build time* on macOS, not at runtime in the user's terminal.

**Fix:** Externalize `@clack/prompts` and its dependencies so unicode detection runs in the actual terminal environment.
