# Sessions Module

Session indexing and search for multi-agent conversation history.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SESSION INDEXING LAYER                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐     ┌──────────────┐     ┌─────────────┐      │
│  │   File      │────▶│   Session    │────▶│   Chunk     │      │
│  │  Watcher    │     │   Parser     │     │  Processor  │      │
│  │             │     │  (JSONL)     │     │  (Messages) │      │
│  └─────────────┘     └──────────────┘     └─────────────┘      │
│                                                   │             │
│                                                   ▼             │
│                                            ┌─────────────┐      │
│                                            │  Embedding  │      │
│                                            │  Pipeline   │      │
│                                            │  (Ollama)   │      │
│                                            └─────────────┘      │
│                                                   │             │
│                                                   ▼             │
│                              ┌──────────────────────────┐       │
│                              │  SEMANTIC MEMORY         │       │
│                              │  (libSQL + FTS5)         │       │
│                              └──────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### ChunkProcessor

**Purpose:** Split sessions into message-level chunks and embed with Ollama.

**Strategy (Phase 1):**
- 1 chunk = 1 message (no further splitting)
- Batch embedding with controlled concurrency
- Graceful degradation: null embeddings when Ollama unavailable

**Usage:**

```typescript
import { ChunkProcessor } from 'swarm-mail/sessions';
import { makeOllamaLive, getDefaultConfig } from 'swarm-mail/memory';
import { Effect } from 'effect';

const processor = new ChunkProcessor();

// 1. Chunk messages
const messages = [
  {
    session_id: 'ses_123',
    agent_type: 'opencode-swarm',
    message_idx: 0,
    timestamp: '2025-12-26T10:00:00Z',
    role: 'user',
    content: 'How do I implement auth?'
  }
];

const chunks = processor.chunk(messages);

// 2. Embed with Ollama
const ollamaConfig = getDefaultConfig();
const ollamaLayer = makeOllamaLive(ollamaConfig);

const embedded = await Effect.runPromise(
  processor.embed(chunks).pipe(Effect.provide(ollamaLayer))
);

// embedded[0].embedding => number[] (1024 dims) or null (if Ollama down)
```

**Testing:**

```bash
# Unit tests (with mocks)
bun test src/sessions/chunk-processor.test.ts

# Integration tests (requires Ollama running)
INTEGRATION=true bun test src/sessions/chunk-processor.integration.test.ts
```

### SessionParser

**Purpose:** Parse JSONL session files into normalized messages.

**Supported formats:**
- OpenCode Swarm
- Cursor (Phase 1)

### FileWatcher

**Purpose:** Monitor session directories for new/modified JSONL files.

**Features:**
- Debounced (500ms default)
- Queued indexing (concurrency limit)
- Cross-platform (chokidar)

### StalenessDetector

**Purpose:** Track index freshness (last_indexed vs file mtime).

**Staleness definition:** `file_mtime > last_indexed_at + 300s` (5min grace period)

### SessionViewer

**Purpose:** Read JSONL files, extract specific line ranges.

**API:**

```typescript
const viewer = new SessionViewer();
const result = await viewer.view({
  path: '/path/to/session.jsonl',
  line: 42,
  context: 3 // lines before/after
});
```

## TDD Workflow

All components follow strict TDD:

1. **RED** - Write failing test
2. **GREEN** - Minimal implementation
3. **REFACTOR** - Clean up while tests stay green

See `chunk-processor.test.ts` for canonical example.

## Integration with Semantic Memory

**Reuses 100%:**
- `Ollama` service (embedding generation)
- `SwarmDb` client (libSQL connection)
- `memories` table (extended with session metadata)
- Confidence decay (repurposed for message recency)

**New columns in memories table:**
- `agent_type` TEXT
- `session_id` TEXT
- `message_role` TEXT (user|assistant|system)
- `message_idx` INTEGER
- `source_path` TEXT

## Performance

**Chunking:** O(n) where n = number of messages (simple 1:1 mapping)

**Embedding:** 
- Batch processing with controlled concurrency (5 concurrent requests)
- ~200ms per text via Ollama (local model)
- Graceful degradation: FTS5 fallback when Ollama unavailable

**Storage:**
- 4KB per embedding (1024 dims * 4 bytes)
- libSQL F32_BLOB format

## References

- **ADR-010:** CASS Inhousing Architecture
- **Ollama Service:** `../memory/ollama.ts`
- **Semantic Memory:** `../memory/README.md`
