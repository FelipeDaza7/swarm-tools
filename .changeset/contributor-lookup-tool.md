---
"opencode-swarm-plugin": minor
---

## 🎯 New Tool: `contributor_lookup`

```
┌────────────────────────────────────────────────┐
│  GitHub Profile  →  Changeset Credit Line      │
│                                                │
│  @bcheung        →  Thanks to Brian Cheung     │
│  twitter: ...    →  ([@justBCheung](x.com/))   │
│                  →  for reporting #53!         │
└────────────────────────────────────────────────┘
```

Workers can now call `contributor_lookup(login, issue)` to automatically:

1. Fetch GitHub profile (name, twitter, bio)
2. Get a ready-to-paste changeset credit line
3. Store contributor info in semantic-memory

**Usage:**
```typescript
contributor_lookup({ login: "bcheung", issue: 53 })
// → "Thanks to Brian Cheung ([@justBCheung](https://x.com/justBCheung)) for reporting #53!"
```

No more forgetting to credit contributors properly. The tool handles fallbacks when twitter/name is missing.
