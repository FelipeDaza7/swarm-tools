# ADR: Memory System Eval Strategy

**Status:** Accepted  
**Date:** 2025-12-27  
**Deciders:** WildWolf  
**Context:** Memory system polish swarm - establishing eval strategy for LLM-powered memory operations

## Context

The memory system performs LLM-powered operations (semantic similarity matching, merge decisions, quality assessment) that need eval coverage. We need a strategy that:

1. **Validates LLM decision quality** - Are similarity matches accurate? Are merge decisions sound?
2. **Prevents regressions** - Detects when changes degrade LLM performance
3. **Feeds learning loop** - Gates failures into semantic-memory for prompt improvement
4. **Balances cost vs coverage** - LLM-as-judge is expensive, use strategically

### Existing Patterns (Reference)

**LLM-as-Judge Pattern** (from `swarm-evals/src/scorers/index.ts`):
- Model: `anthropic/claude-haiku-4-5` (fast, cheap, good enough for scoring)
- Structured output: `{"score": 0-100, "issues": [...], "strengths": [...]}`
- Graceful degradation: Return 0.5 neutral score on LLM call failure
- Harsh prompts: Tell LLM to be harsh - false positives waste parallel work

**Eval-to-Learning Integration** (from `src/eval-learning.ts`):
- Rolling average baseline: last 5 runs
- Regression threshold: 15% drop from baseline triggers storage
- Stored to semantic-memory with tags: `eval-failure`, `{eval-name}`, `regression`
- Future prompts query these memories for context

**Heuristic Scorers** (from `src/compaction-prompt-scorers.test.ts`):
- Fast, deterministic, no API calls
- Case-insensitive pattern matching (all regexes use `/i` flag)
- Binary scoring for exact match cases (0.0 or 1.0)

## Decision

### Eval Types & Usage

#### 1. Heuristic Scorers (Unit-Level)

**When:** Exact-match validation, fast feedback, no judgment needed  
**Cost:** Zero (pure computation)  
**Examples:**
- Exact duplicate detection (same content → NOOP)
- Placeholder detection (no `<memory-id>` in output)
- Required field presence (ID, content, tags all present)

**Pattern:**
```typescript
export const exactMatchNoop = createScorer({
  name: "Exact Match NOOP",
  description: "Existing memory with identical content should remain unchanged",
  scorer: ({ output, expected }) => {
    const result = JSON.parse(String(output));
    if (result.action === "NOOP" && result.reason?.includes("identical")) {
      return { score: 1.0, message: "Correctly identified exact match" };
    }
    return { score: 0.0, message: "Failed to detect exact match" };
  },
});
```

**Success Metric:** 95% for exact-match detection (should be deterministic)

#### 2. LLM Operation Tests (Integration-Level)

**When:** Testing actual LLM calls with controlled inputs  
**Cost:** API calls (budget accordingly)  
**Examples:**
- Semantic similarity matching with known-similar pairs
- Merge decision with minor wording changes
- Quality assessment with known-good/known-bad memories

**Pattern:**
```typescript
export const similarityDetection = createScorer({
  name: "Similarity Detection",
  description: "Detects semantically similar memories for UPDATE action",
  scorer: async ({ output, input }) => {
    const result = JSON.parse(String(output));
    const expectedSimilar = (input as { expectSimilar: boolean }).expectSimilar;
    
    if (expectedSimilar && result.action === "UPDATE") {
      return { score: 1.0, message: "Correctly detected similarity" };
    }
    if (!expectedSimilar && result.action === "CREATE") {
      return { score: 1.0, message: "Correctly rejected false match" };
    }
    return { score: 0.0, message: `Wrong action: ${result.action}` };
  },
});
```

**Success Metric:** 80% for similarity matching (LLM judgment has variance)

#### 3. LLM-as-Judge (Quality Evaluation)

**When:** Evaluating subjective quality, semantic correctness  
**Cost:** Double API calls (operation + judge)  
**Examples:**
- Merge quality (did UPDATE preserve important context?)
- Summary quality (does compacted memory retain key facts?)
- Relevance scoring (is this memory actually relevant to query?)

**Pattern:**
```typescript
export const mergeQuality = createScorer({
  name: "Merge Quality (LLM Judge)",
  description: "LLM evaluates whether merged memory preserves key information",
  scorer: async ({ output, input }) => {
    const merged = JSON.parse(String(output));
    const original = (input as { original: string }).original;
    const incoming = (input as { incoming: string }).incoming;
    
    try {
      const { text } = await generateText({
        model: gateway("anthropic/claude-haiku-4-5"),
        prompt: `You are evaluating a memory merge operation.

ORIGINAL MEMORY:
${original}

INCOMING MEMORY:
${incoming}

MERGED RESULT:
${merged.content}

Evaluate (be harsh - bad merges lose information):

1. COMPLETENESS (50%): Are all key facts from both memories present?
2. COHERENCE (30%): Does merged text read naturally?
3. CONCISENESS (20%): No redundant information?

Return ONLY valid JSON:
{"score": <0-100>, "issues": ["..."], "strengths": ["..."]}`,
        maxOutputTokens: 512,
      });
      
      let jsonText = text.trim();
      if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/```json?\n?/g, "").replace(/```$/g, "");
      }
      
      const result = JSON.parse(jsonText) as {
        score: number;
        issues: string[];
        strengths?: string[];
      };
      
      return {
        score: result.score / 100,
        message: `Issues: ${result.issues.join("; ")} | Strengths: ${result.strengths?.join("; ") || "None"}`,
      };
    } catch (error) {
      // Graceful degradation - don't fail eval if judge fails
      return {
        score: 0.5,
        message: `LLM judge error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
```

**Success Metric:** 70% for LLM-as-judge (subjective, higher variance)

### Baseline & Regression Detection

**Rolling Average Baseline:**
- Window: Last 5 runs (from `eval-learning.ts` default)
- Stored per-eval in eval history
- Calculated via `calculateRollingAverage(history, 5)`

**Regression Threshold:**
- Default: 15% drop from baseline triggers alert
- Formula: `(baseline - current) / baseline >= 0.15`
- Sensitive evals (exact-match): 10% threshold
- Quality evals (LLM-as-judge): 20% threshold (more variance)

**Gate Integration:**
```typescript
// After eval run
const baseline = calculateRollingAverage(history, 5);
const result = await learnFromEvalFailure(
  "memory-similarity-eval",
  currentScore,
  history,
  memoryAdapter,
  {
    config: { dropThreshold: 0.15, windowSize: 5 },
    scorerContext: "similarityDetection: 12/20 correct (60%)",
  }
);

if (result.triggered) {
  console.log(`📉 Regression detected: ${(result.drop_percentage * 100).toFixed(1)}% drop`);
  console.log(`Stored to memory: ${result.memory_id}`);
}
```

### Fixture Strategy

**Known-Good Examples** (positive cases):
- Exact duplicates (content byte-for-byte identical) → NOOP
- Clear semantic similarity (paraphrases) → UPDATE
- High-quality memories (specific, actionable) → high quality score

**Known-Bad Examples** (negative cases):
- False positives (different topics, similar words) → CREATE not UPDATE
- Information loss in merge → low merge quality score
- Generic/vague memories → low quality score

**Fixture Location:** `src/__fixtures__/memory-eval-fixtures.ts`

**Fixture Format:**
```typescript
export const EXACT_MATCH_FIXTURES = [
  {
    input: {
      existing: { id: "mem_1", content: "OAuth tokens need 5min buffer" },
      incoming: { content: "OAuth tokens need 5min buffer" },
    },
    expected: { action: "NOOP", reason: "identical content" },
  },
];

export const SIMILARITY_FIXTURES = [
  {
    input: {
      existing: { id: "mem_2", content: "JWT refresh needs 5 minute buffer before expiry" },
      incoming: { content: "OAuth tokens should refresh 5min before expiration" },
      expectSimilar: true,
    },
    expected: { action: "UPDATE" },
  },
  {
    input: {
      existing: { id: "mem_3", content: "Next.js caching strategies" },
      incoming: { content: "OAuth token refresh patterns" },
      expectSimilar: false,
    },
    expected: { action: "CREATE" },
  },
];
```

### Eval-to-Learning Integration

**Trigger Condition:** Score drops >15% from rolling average

**What Gets Stored:**
```typescript
const information = `Eval "memory-similarity-eval" regression detected:
- Current score: 0.68
- Baseline (rolling avg): 0.85
- Drop: 20.0%

Scorer context:
similarityDetection: 12/20 correct matches (60%)
False positives: 5 (treated different topics as similar)
False negatives: 3 (missed paraphrases)

Action: Review LLM prompt for similarity detection.
Common pattern in failures: keyword overlap without semantic match.`;

await memoryAdapter.store({
  information,
  tags: "eval-failure,memory-similarity-eval,regression",
  metadata: JSON.stringify({
    eval_name: "memory-similarity-eval",
    baseline_score: 0.85,
    current_score: 0.68,
    drop_percentage: 0.20,
    timestamp: new Date().toISOString(),
  }),
});
```

**Future Prompt Injection:**
```typescript
// Before generating similarity detection prompt
const pastFailures = await memoryAdapter.find({
  query: "memory similarity eval failure",
  limit: 3,
});

// Inject learnings into prompt
const context = pastFailures.map(m => m.information).join("\n\n");
const enhancedPrompt = `${basePrompt}\n\nPast failure patterns:\n${context}`;
```

## Consequences

### Positive

✅ **Tiered strategy** - Use cheap heuristics where possible, expensive LLM-as-judge only for quality  
✅ **Regression detection** - 15% threshold catches degradation early  
✅ **Closed-loop learning** - Failures feed back into prompt improvement  
✅ **Known-good/known-bad fixtures** - Anchors eval quality with clear examples  
✅ **Graceful degradation** - Judge failures don't crash evals (0.5 neutral score)  

### Negative

⚠️ **API cost** - LLM-as-judge doubles API calls (operation + judge)  
⚠️ **Variance** - LLM scoring not deterministic, need higher sample size  
⚠️ **Fixture maintenance** - Known-good/bad examples need updating as LLM improves  

### Mitigations

- **Cost:** Reserve LLM-as-judge for quality evals (merge, summary), not operations (NOOP detection)
- **Variance:** Use rolling average (5 runs) instead of single-run comparison
- **Fixtures:** Store fixtures in git, review during prompt changes

## Implementation Checklist

- [ ] Create `src/__fixtures__/memory-eval-fixtures.ts` with known-good/bad examples
- [ ] Write heuristic scorers for exact-match cases (95% target)
- [ ] Write integration tests for LLM operations (80% target)
- [ ] Write LLM-as-judge scorers for merge/summary quality (70% target)
- [ ] Integrate with eval-learning.ts for regression detection
- [ ] Add eval runs to CI with baseline tracking
- [ ] Document fixture update process in eval README

## References

- **LLM-as-Judge Pattern:** `packages/swarm-evals/src/scorers/index.ts` (decompositionCoherence scorer)
- **Eval-to-Learning:** `packages/opencode-swarm-plugin/src/eval-learning.ts` (learnFromEvalFailure)
- **Heuristic Patterns:** `packages/opencode-swarm-plugin/src/compaction-prompt-scorers.test.ts`
- **Semantic Memory Learnings:** 3 memories on LLM-as-judge scorer patterns (IDs: b0ef27d5, 54ffa58e, 9b8f7c2c)

---

> "The only way to know if something works is to measure it. The only way to improve it is to measure it consistently."  
> — Engineering maxim, source lost to time but truth eternal
