# ADR-010: CASS Inhousing Feasibility Study

> *"Refactoring is a controlled technique for improving the design of an existing code base. Its essence is applying a series of small behavior-preserving transformations, each of which 'too small to be worth doing'."*  
> — Martin Fowler, Refactoring: Improving the Design of Existing Code

## Status

**Proposed** (2025-12-26)

## Context

### Original Premise (INVALIDATED)
The original motivation was to "eliminate Python dependency" from CASS. **This premise was incorrect.** Research revealed that CASS is a **Rust application** (20K+ LOC), not Python.

### Actual Opportunity
After deep architectural analysis, a different—and more compelling—opportunity emerged:

**We already have 90% of CASS's infrastructure in `semantic-memory`.**

Our existing semantic memory system (swarm-mail package) has:
- ✅ libSQL with F32_BLOB(1024) vectors + vector_top_k() ANN search
- ✅ Ollama embeddings (mxbai-embed-large, 1024 dims)
- ✅ FTS5 full-text search with auto-sync triggers
- ✅ Confidence decay (90-day half-life)
- ✅ Entity extraction + knowledge graph
- ✅ Collection filtering (namespace support)
- ✅ Batch embedding with controlled concurrency
- ✅ Graceful degradation (FTS5 fallback when Ollama down)

CASS provides:
- Session file parsing for 10+ agent types (Claude, Cursor, Codex, etc.)
- Message-level chunking
- File watching + auto-indexing
- Agent type discovery
- Session metadata schema
- Staleness detection
- Robot-mode API (token budgets, pagination, forgiving syntax)

**The gap is 8 thin adapters, not core infrastructure.**

### Why Inhouse?

1. **Eliminate External Binary Dependency** - One less install, one less config file, one less version to manage
2. **Tighter Integration** - Swarm sessions auto-indexed, no export step
3. **Unified Query API** - semantic-memory + session search in one tool
4. **TDD-Friendly Architecture** - We control the test surface, can characterize behavior before refactoring
5. **Incremental Migration** - Can build session indexing alongside existing CASS usage

### Why NOT Full Rewrite?

CASS is production-quality software:
- 20K+ LOC Rust with Tantivy FTS engine
- 10 agent connectors with extensive test fixtures
- Robot-mode API with self-documenting commands
- Multi-machine sync (SSH, rsync, path mappings)
- TUI with syntax highlighting, fuzzy matching, sparklines

**Full inhousing would be a 4-week+ project.** That's not feasible.

## Decision

**RECOMMEND: Partial Inhousing (Session Indexing Layer)**

Build a **session indexing layer** on top of our existing semantic-memory infrastructure. This gives us 80% of CASS's value with 20% of the implementation effort.

### Scope

**IN SCOPE (Phase 1 - 2-3 days)**
1. Session file parsing (JSONL-based agents: OpenCode Swarm, Cursor)
2. Message-level chunking
3. Metadata schema extension (agent_type, session_id, message_role, timestamp)
4. File watching + auto-indexing (debounced, queued)
5. Agent type discovery (path → agent mapping)
6. Staleness detection (last_indexed vs file mtimes)
7. Pagination API (fields="minimal")
8. Session viewer (JSONL line reader)

**OUT OF SCOPE (Future)**
- Cloud-only agents (Claude Code, Gemini, Copilot - require API integration)
- Encrypted session formats (ChatGPT v2/v3 with macOS keychain)
- Multi-machine sync (SSH, rsync)
- TUI (robot-mode CLI only)
- Tantivy migration (FTS5 sufficient for now)

**DEPENDENCY: Existing CASS as Binary (Phase 0)**
Until session indexing is production-ready, keep current CASS usage via binary dependency. This allows incremental migration.

## Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         SESSION INDEXING LAYER                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐     ┌──────────────┐     ┌─────────────┐      │
│  │   File      │────▶│   Session    │────▶│   Chunk     │      │
│  │  Watcher    │     │   Parser     │     │  Processor  │      │
│  │             │     │  (JSONL)     │     │  (Messages) │      │
│  └─────────────┘     └──────────────┘     └─────────────┘      │
│        │                    │                     │             │
│        │                    │                     ▼             │
│        │                    │              ┌─────────────┐      │
│        │                    │              │  Embedding  │      │
│        │                    │              │  Pipeline   │      │
│        │                    │              │  (Ollama)   │      │
│        │                    │              └─────────────┘      │
│        │                    │                     │             │
│        ▼                    ▼                     ▼             │
│  ┌──────────────────────────────────────────────────────┐      │
│  │           SEMANTIC MEMORY (libSQL + FTS5)            │      │
│  │                                                      │      │
│  │  - memories table (extended with session metadata)  │      │
│  │  - memories_fts (full-text search)                  │      │
│  │  - vector_top_k() (ANN search)                      │      │
│  │  - confidence_decay() (recency scoring)             │      │
│  └──────────────────────────────────────────────────────┘      │
│                              │                                 │
│                              ▼                                 │
│                     ┌─────────────────┐                        │
│                     │  Query Interface │                        │
│                     │  (MCP Tools)     │                        │
│                     │                  │                        │
│                     │  - cass_search   │                        │
│                     │  - cass_view     │                        │
│                     │  - cass_expand   │                        │
│                     │  - cass_index    │                        │
│                     │  - cass_health   │                        │
│                     └─────────────────┘                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

#### 1. File Watcher
**Purpose:** Monitor session directories for new/modified JSONL files

**Directories to watch:**
- `~/.config/swarm-tools/sessions/` (OpenCode Swarm)
- `~/Library/Application Support/Cursor/User/History/` (Cursor)
- `~/.opencode/` (OpenCode - recursive scan)

**Implementation:**
- Use Node.js `fs.watch()` or `chokidar` for cross-platform watching
- Debounce: 500ms (batch rapid file changes)
- Queue: concurrent indexing with limit=5 (prevent Ollama overload)

**TDD Approach:**
```typescript
// RED: Write failing test
describe('FileWatcher', () => {
  test('detects new JSONL file in watched directory', async () => {
    const watcher = new FileWatcher(['/tmp/sessions']);
    const detected = vi.fn();
    watcher.on('file-added', detected);
    
    await watcher.start();
    await fs.writeFile('/tmp/sessions/new.jsonl', '{}');
    
    await vi.waitFor(() => expect(detected).toHaveBeenCalledWith({
      path: '/tmp/sessions/new.jsonl',
      event: 'added'
    }));
  });
  
  test('debounces rapid file changes', async () => {
    const watcher = new FileWatcher(['/tmp/sessions'], { debounce: 100 });
    const detected = vi.fn();
    watcher.on('file-changed', detected);
    
    await watcher.start();
    
    // Rapid writes (should batch)
    await fs.writeFile('/tmp/sessions/ses_1.jsonl', '{"id":1}');
    await fs.writeFile('/tmp/sessions/ses_1.jsonl', '{"id":2}');
    await fs.writeFile('/tmp/sessions/ses_1.jsonl', '{"id":3}');
    
    await vi.waitFor(() => expect(detected).toHaveBeenCalledTimes(1), { timeout: 200 });
  });
});

// GREEN: Implement minimal watcher
class FileWatcher extends EventEmitter {
  constructor(paths: string[], opts = { debounce: 500 }) { /* ... */ }
  start() { /* chokidar.watch() */ }
  stop() { /* watcher.close() */ }
}

// REFACTOR: Extract debouncing, add error handling
```

#### 2. Session Parser
**Purpose:** Parse JSONL session files into normalized messages

**Supported formats (Phase 1):**
- **OpenCode Swarm**: `{session_id, event_type, timestamp, payload}`
- **Cursor**: `{type, timestamp, content}` (needs investigation)

**Normalization schema:**
```typescript
interface NormalizedMessage {
  session_id: string;        // File-derived or parsed
  agent_type: string;        // 'opencode-swarm' | 'cursor' | ...
  message_idx: number;       // Line number in JSONL
  timestamp: string;         // ISO 8601
  role: 'user' | 'assistant' | 'system';
  content: string;           // Extracted text
  metadata: Record<string, unknown>; // Agent-specific fields
}
```

**TDD Approach:**
```typescript
// RED: Test OpenCode Swarm parser
describe('SessionParser', () => {
  test('parses OpenCode Swarm JSONL format', async () => {
    const jsonl = [
      '{"session_id":"ses_123","event_type":"DECISION","timestamp":"2025-12-26T10:00:00Z","payload":{"action":"spawn"}}',
      '{"session_id":"ses_123","event_type":"OUTCOME","timestamp":"2025-12-26T10:01:00Z","payload":{"status":"success"}}'
    ].join('\n');
    
    const parser = new SessionParser('opencode-swarm');
    const messages = await parser.parse(jsonl, { filePath: 'ses_123.jsonl' });
    
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      session_id: 'ses_123',
      agent_type: 'opencode-swarm',
      message_idx: 0,
      timestamp: '2025-12-26T10:00:00Z',
      role: 'system',
      content: 'DECISION: spawn'
    });
  });
  
  test('handles malformed JSONL gracefully', async () => {
    const jsonl = [
      '{"valid": "json"}',
      'INVALID JSON',
      '{"valid": "json2"}'
    ].join('\n');
    
    const parser = new SessionParser('opencode-swarm');
    const messages = await parser.parse(jsonl);
    
    expect(messages).toHaveLength(2); // Skips malformed line
  });
});

// GREEN: Implement basic parser
class SessionParser {
  constructor(private agentType: string) {}
  
  async parse(jsonl: string, opts?: { filePath?: string }): Promise<NormalizedMessage[]> {
    return jsonl.split('\n')
      .map((line, idx) => {
        try {
          const obj = JSON.parse(line);
          return this.normalize(obj, idx);
        } catch {
          return null; // Skip malformed
        }
      })
      .filter(Boolean);
  }
  
  private normalize(obj: any, idx: number): NormalizedMessage { /* ... */ }
}

// REFACTOR: Add agent-specific parsers, extract normalize()
```

#### 3. Chunk Processor
**Purpose:** Split sessions into searchable message-level chunks, embed with Ollama

**Chunking strategy:**
- 1 chunk = 1 message (no further splitting for now)
- Future: Split long messages at sentence boundaries if >2000 tokens

**Embedding:**
- Reuse existing `BatchEmbedder` from semantic-memory
- Controlled concurrency (5 concurrent requests to Ollama)
- Graceful degradation (store without embeddings if Ollama down)

**TDD Approach:**
```typescript
// RED: Test chunking
describe('ChunkProcessor', () => {
  test('creates one chunk per message', async () => {
    const messages = [
      { session_id: 's1', content: 'Hello', timestamp: '2025-12-26T10:00:00Z', role: 'user' },
      { session_id: 's1', content: 'Hi there', timestamp: '2025-12-26T10:01:00Z', role: 'assistant' }
    ];
    
    const processor = new ChunkProcessor();
    const chunks = await processor.chunk(messages);
    
    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe('Hello');
    expect(chunks[1].content).toBe('Hi there');
  });
  
  test('embeds chunks with Ollama', async () => {
    const chunks = [{ content: 'Test message' }];
    const processor = new ChunkProcessor({ embedder: mockOllamaClient });
    
    const embedded = await processor.embed(chunks);
    
    expect(embedded[0].vector).toHaveLength(1024);
    expect(mockOllamaClient.embed).toHaveBeenCalledWith('Test message');
  });
  
  test('gracefully handles Ollama failure', async () => {
    const chunks = [{ content: 'Test' }];
    const processor = new ChunkProcessor({ embedder: failingOllamaClient });
    
    const embedded = await processor.embed(chunks);
    
    expect(embedded[0].vector).toBeNull(); // Store without embedding
  });
});

// GREEN: Implement processor
class ChunkProcessor {
  constructor(private opts = { embedder: getOllamaClient() }) {}
  
  async chunk(messages: NormalizedMessage[]): Promise<Chunk[]> {
    return messages.map(msg => ({ ...msg })); // 1:1 for now
  }
  
  async embed(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
    try {
      const vectors = await this.opts.embedder.embedBatch(chunks.map(c => c.content));
      return chunks.map((chunk, i) => ({ ...chunk, vector: vectors[i] }));
    } catch (err) {
      return chunks.map(chunk => ({ ...chunk, vector: null }));
    }
  }
}

// REFACTOR: Add batch size limits, retry logic
```

#### 4. Metadata Schema Extension
**Purpose:** Extend `memories` table to support session-specific fields

**SQL Migration:**
```sql
-- Migration: Add session metadata columns
ALTER TABLE memories ADD COLUMN agent_type TEXT;
ALTER TABLE memories ADD COLUMN session_id TEXT;
ALTER TABLE memories ADD COLUMN message_role TEXT CHECK (message_role IN ('user', 'assistant', 'system'));
ALTER TABLE memories ADD COLUMN message_idx INTEGER;
ALTER TABLE memories ADD COLUMN source_path TEXT;

-- Index for fast agent filtering
CREATE INDEX idx_memories_agent_type ON memories(agent_type) WHERE agent_type IS NOT NULL;

-- Index for session lookup
CREATE INDEX idx_memories_session_id ON memories(session_id) WHERE session_id IS NOT NULL;

-- Update FTS5 to index agent_type
INSERT INTO memories_fts(memories_fts) VALUES('rebuild');
```

**TDD Approach:**
```typescript
// RED: Test schema migration
describe('Session Metadata Schema', () => {
  test('stores session-specific metadata', async () => {
    const db = await createInMemorySwarmMail();
    
    await db.storeMemory({
      information: 'Test message',
      metadata: {
        agent_type: 'opencode-swarm',
        session_id: 'ses_123',
        message_role: 'assistant',
        message_idx: 5,
        source_path: '/path/to/ses_123.jsonl'
      }
    });
    
    const results = await db.findMemories({ query: 'test', agent_type: 'opencode-swarm' });
    expect(results[0].metadata.agent_type).toBe('opencode-swarm');
    expect(results[0].metadata.session_id).toBe('ses_123');
  });
  
  test('filters by agent type', async () => {
    const db = await createInMemorySwarmMail();
    
    await db.storeMemory({ information: 'Swarm msg', metadata: { agent_type: 'opencode-swarm' } });
    await db.storeMemory({ information: 'Cursor msg', metadata: { agent_type: 'cursor' } });
    
    const results = await db.findMemories({ query: 'msg', agent_type: 'cursor' });
    
    expect(results).toHaveLength(1);
    expect(results[0].metadata.agent_type).toBe('cursor');
  });
});

// GREEN: Add migration + query support
// REFACTOR: Extract agent_type enum, add validation
```

#### 5. Agent Type Discovery
**Purpose:** Map file paths to agent types

**Mapping rules:**
```typescript
const AGENT_PATH_PATTERNS = [
  { pattern: /\.config\/swarm-tools\/sessions\//, agentType: 'opencode-swarm' },
  { pattern: /Cursor\/User\/History\//, agentType: 'cursor' },
  { pattern: /\.opencode\//, agentType: 'opencode' },
  { pattern: /\.local\/share\/Claude\//, agentType: 'claude' },
  { pattern: /\.aider/, agentType: 'aider' },
];

function detectAgentType(filePath: string): string | null {
  for (const { pattern, agentType } of AGENT_PATH_PATTERNS) {
    if (pattern.test(filePath)) return agentType;
  }
  return null;
}
```

**TDD Approach:**
```typescript
// RED: Test agent detection
describe('detectAgentType', () => {
  test('detects OpenCode Swarm sessions', () => {
    expect(detectAgentType('/home/user/.config/swarm-tools/sessions/ses_123.jsonl'))
      .toBe('opencode-swarm');
  });
  
  test('detects Cursor sessions', () => {
    expect(detectAgentType('/Users/joel/Library/Application Support/Cursor/User/History/abc/9ScS.jsonl'))
      .toBe('cursor');
  });
  
  test('returns null for unknown paths', () => {
    expect(detectAgentType('/tmp/random.jsonl')).toBeNull();
  });
});

// GREEN: Implement pattern matching
// REFACTOR: Load patterns from config file
```

#### 6. Staleness Detection
**Purpose:** Track last index time vs file mtimes, report when stale

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS session_index_state (
  source_path TEXT PRIMARY KEY,
  last_indexed_at INTEGER NOT NULL,  -- Unix timestamp
  file_mtime INTEGER NOT NULL,
  message_count INTEGER NOT NULL
);
```

**Staleness definition:** `file_mtime > last_indexed_at + 300` (5 min grace period)

**TDD Approach:**
```typescript
// RED: Test staleness detection
describe('StalenessDetector', () => {
  test('reports file as stale when mtime > last_indexed + 300s', async () => {
    const db = await createInMemorySwarmMail();
    const detector = new StalenessDetector(db);
    
    // Index file at T=0
    await detector.recordIndexed('/tmp/ses_1.jsonl', { mtime: 1000, messageCount: 10 });
    
    // File modified at T=400
    vi.setSystemTime(new Date(1400 * 1000));
    const stale = await detector.checkStaleness('/tmp/ses_1.jsonl', { currentMtime: 1400 });
    
    expect(stale).toBe(true);
  });
  
  test('reports file as fresh when mtime within grace period', async () => {
    const db = await createInMemorySwarmMail();
    const detector = new StalenessDetector(db);
    
    await detector.recordIndexed('/tmp/ses_1.jsonl', { mtime: 1000, messageCount: 10 });
    
    vi.setSystemTime(new Date(1200 * 1000));
    const stale = await detector.checkStaleness('/tmp/ses_1.jsonl', { currentMtime: 1000 });
    
    expect(stale).toBe(false);
  });
});

// GREEN: Implement detector
class StalenessDetector {
  async recordIndexed(path: string, opts: { mtime: number, messageCount: number }) { /* ... */ }
  async checkStaleness(path: string, opts: { currentMtime: number }): Promise<boolean> { /* ... */ }
}

// REFACTOR: Add bulk staleness check, configurable grace period
```

#### 7. Pagination API
**Purpose:** Support `fields="minimal"` for compact output

**Field sets:**
```typescript
const FIELD_SETS = {
  minimal: ['source_path', 'message_idx', 'agent_type'],
  summary: ['source_path', 'message_idx', 'agent_type', 'timestamp', 'role', 'preview'],
  full: '*', // All columns
};
```

**TDD Approach:**
```typescript
// RED: Test field filtering
describe('Session Query API', () => {
  test('returns minimal fields when fields="minimal"', async () => {
    const db = await createInMemorySwarmMail();
    await db.indexSession('/path/to/ses_1.jsonl');
    
    const results = await db.searchSessions({ query: 'test', fields: 'minimal' });
    
    expect(results[0]).toEqual({
      source_path: '/path/to/ses_1.jsonl',
      message_idx: 0,
      agent_type: 'opencode-swarm'
    });
    expect(results[0].content).toBeUndefined();
  });
  
  test('supports custom field list', async () => {
    const db = await createInMemorySwarmMail();
    await db.indexSession('/path/to/ses_1.jsonl');
    
    const results = await db.searchSessions({ 
      query: 'test', 
      fields: ['source_path', 'timestamp', 'content'] 
    });
    
    expect(Object.keys(results[0])).toEqual(['source_path', 'timestamp', 'content']);
  });
});

// GREEN: Implement field projection
// REFACTOR: Add TypeScript type narrowing for field sets
```

#### 8. Session Viewer
**Purpose:** Read JSONL file, extract specific line range, format for display

**API:**
```typescript
interface SessionViewerOpts {
  path: string;          // Absolute path to JSONL file
  line?: number;         // Target line (1-indexed)
  context?: number;      // Lines before/after (default: 3)
}

async function viewSession(opts: SessionViewerOpts): Promise<string>
```

**TDD Approach:**
```typescript
// RED: Test line extraction
describe('SessionViewer', () => {
  test('extracts single line from JSONL', async () => {
    const jsonl = [
      '{"id":1,"msg":"First"}',
      '{"id":2,"msg":"Second"}',
      '{"id":3,"msg":"Third"}'
    ].join('\n');
    await fs.writeFile('/tmp/ses.jsonl', jsonl);
    
    const viewer = new SessionViewer();
    const result = await viewer.view({ path: '/tmp/ses.jsonl', line: 2 });
    
    expect(result).toContain('{"id":2,"msg":"Second"}');
  });
  
  test('includes context lines', async () => {
    const jsonl = Array.from({ length: 10 }, (_, i) => `{"id":${i}}`).join('\n');
    await fs.writeFile('/tmp/ses.jsonl', jsonl);
    
    const viewer = new SessionViewer();
    const result = await viewer.view({ path: '/tmp/ses.jsonl', line: 5, context: 2 });
    
    expect(result).toContain('{"id":3}'); // line - 2
    expect(result).toContain('{"id":4}'); // line - 1
    expect(result).toContain('{"id":5}'); // target line
    expect(result).toContain('{"id":6}'); // line + 1
    expect(result).toContain('{"id":7}'); // line + 2
  });
  
  test('handles line number out of range', async () => {
    await fs.writeFile('/tmp/ses.jsonl', '{"id":1}\n{"id":2}');
    
    const viewer = new SessionViewer();
    await expect(viewer.view({ path: '/tmp/ses.jsonl', line: 100 }))
      .rejects.toThrow('Line 100 not found');
  });
});

// GREEN: Implement line reader
class SessionViewer {
  async view(opts: SessionViewerOpts): Promise<string> {
    const lines = (await fs.readFile(opts.path, 'utf-8')).split('\n');
    const lineIdx = (opts.line ?? 1) - 1;
    const context = opts.context ?? 3;
    
    if (lineIdx < 0 || lineIdx >= lines.length) {
      throw new Error(`Line ${opts.line} not found in ${opts.path}`);
    }
    
    const start = Math.max(0, lineIdx - context);
    const end = Math.min(lines.length, lineIdx + context + 1);
    
    return lines.slice(start, end)
      .map((line, i) => `${start + i + 1}: ${line}`)
      .join('\n');
  }
}

// REFACTOR: Add syntax highlighting, JSON pretty-printing
```

### Integration with Existing semantic-memory

**Reuse 100%:**
- `SwarmDb` client (libSQL connection pooling)
- `BatchEmbedder` (Ollama client with retry + concurrency control)
- `memories` table schema (extend with new columns)
- `findMemories()` API (add agent_type, session_id filters)
- `storeMemory()` API (validate session metadata)
- Confidence decay mechanism (repurpose for message recency)

**New Modules:**
```
swarm-mail/src/
  sessions/
    file-watcher.ts          # Watch session directories
    session-parser.ts        # Parse JSONL formats
    chunk-processor.ts       # Chunk + embed messages
    agent-discovery.ts       # Path → agent type mapping
    staleness-detector.ts    # Track index freshness
    session-viewer.ts        # JSONL line reader
    session-indexer.ts       # Orchestrates above components
    index.ts                 # Public API exports
```

**MCP Tool Wrappers:**
```
opencode-swarm-plugin/src/
  sessions.ts              # MCP tool implementations
    - cass_search()        # Wraps SessionIndexer.search()
    - cass_view()          # Wraps SessionViewer.view()
    - cass_expand()        # Wraps SessionViewer.view(context=N)
    - cass_index()         # Triggers SessionIndexer.indexAll()
    - cass_health()        # Checks staleness, index stats
    - cass_stats()         # Session counts by agent type
```

## TDD Implementation Plan

### Phase 0: Characterization Tests (BEFORE touching code)

**Goal:** Document existing CASS behavior to prevent regression during migration.

**Tests to write:**
1. **Search behavior:**
   ```bash
   # Capture baseline search results
   cass search "authentication error" --agent opencode --days 7 --robot > baseline_search.json
   ```
   
2. **View behavior:**
   ```bash
   cass view ~/.config/swarm-tools/sessions/ses_123.jsonl -n 5 -C 3 > baseline_view.txt
   ```

3. **Health check:**
   ```bash
   cass health > baseline_health.txt
   ```

**Characterization test suite:**
```typescript
describe('CASS Baseline Behavior (Characterization)', () => {
  test('search returns expected structure', async () => {
    const result = await exec('cass search "test" --robot');
    const json = JSON.parse(result.stdout);
    
    expect(json).toMatchObject({
      results: expect.arrayContaining([
        expect.objectContaining({
          path: expect.any(String),
          line: expect.any(Number),
          agent: expect.any(String),
          score: expect.any(Number),
        })
      ]),
      total: expect.any(Number)
    });
  });
  
  test('health check reports index status', async () => {
    const result = await exec('cass health');
    expect(result.stdout).toMatch(/Index: (ready|needs indexing)/);
  });
});
```

### Phase 1: Foundation (Day 1)

**Goal:** Build core infrastructure without file watching.

#### 1.1 Session Parser (TDD)
- ✅ RED: Write test for OpenCode Swarm JSONL parsing
- ✅ GREEN: Implement minimal parser
- ✅ REFACTOR: Extract normalization logic, add error handling
- ✅ RED: Test malformed JSONL handling
- ✅ GREEN: Skip invalid lines gracefully
- ✅ REFACTOR: Add logging for skipped lines

#### 1.2 Metadata Schema (TDD)
- ✅ RED: Write test for storing session metadata
- ✅ GREEN: Add SQL migration, extend storeMemory()
- ✅ REFACTOR: Add Zod validation for session metadata
- ✅ RED: Test filtering by agent_type
- ✅ GREEN: Add WHERE clause to findMemories()
- ✅ REFACTOR: Index optimization for agent_type queries

#### 1.3 Chunk Processor (TDD)
- ✅ RED: Test message chunking (1:1 for now)
- ✅ GREEN: Implement basic chunker
- ✅ REFACTOR: Extract chunking strategy interface
- ✅ RED: Test Ollama embedding integration
- ✅ GREEN: Reuse BatchEmbedder from semantic-memory
- ✅ REFACTOR: Add graceful degradation (FTS5 fallback)

**Validation:** Manual indexing of a single JSONL file
```typescript
import { SessionIndexer } from 'swarm-mail/sessions';

const indexer = new SessionIndexer();
await indexer.indexFile('/path/to/ses_123.jsonl');

const results = await indexer.search({ query: 'test', agent_type: 'opencode-swarm' });
console.log(results); // Should return messages from ses_123.jsonl
```

### Phase 2: Automation (Day 2)

**Goal:** Add file watching and auto-indexing.

#### 2.1 File Watcher (TDD)
- ✅ RED: Test detection of new JSONL file
- ✅ GREEN: Implement chokidar-based watcher
- ✅ REFACTOR: Add debouncing (500ms)
- ✅ RED: Test debouncing of rapid changes
- ✅ GREEN: Batch file events
- ✅ REFACTOR: Add error recovery, restart logic

#### 2.2 Agent Discovery (TDD)
- ✅ RED: Test path → agent type mapping
- ✅ GREEN: Implement pattern matching
- ✅ REFACTOR: Load patterns from config file
- ✅ RED: Test unknown path handling
- ✅ GREEN: Return null for unknown agents
- ✅ REFACTOR: Add user-defined patterns

#### 2.3 Staleness Detection (TDD)
- ✅ RED: Test staleness detection logic
- ✅ GREEN: Implement mtime comparison
- ✅ REFACTOR: Add grace period (300s)
- ✅ RED: Test bulk staleness check
- ✅ GREEN: Optimize with batch queries
- ✅ REFACTOR: Add staleness metrics

**Validation:** Start watcher, modify JSONL file, verify auto-reindex
```typescript
const watcher = new FileWatcher(['/path/to/sessions']);
watcher.start();

// Modify file
await fs.appendFile('/path/to/ses_123.jsonl', '\n{"new":"message"}');

// Wait for auto-index
await vi.waitFor(() => {
  const results = indexer.search({ query: 'new message' });
  expect(results.length).toBeGreaterThan(0);
});
```

### Phase 3: API + Tools (Day 3)

**Goal:** Build MCP tools and validate against characterization tests.

#### 3.1 Session Viewer (TDD)
- ✅ RED: Test JSONL line extraction
- ✅ GREEN: Implement line reader
- ✅ REFACTOR: Add context parameter
- ✅ RED: Test syntax highlighting
- ✅ GREEN: Add JSON pretty-printing
- ✅ REFACTOR: Support multiple output formats

#### 3.2 Pagination API (TDD)
- ✅ RED: Test fields="minimal" output
- ✅ GREEN: Implement field projection
- ✅ REFACTOR: Add TypeScript type narrowing
- ✅ RED: Test custom field lists
- ✅ GREEN: Support array of field names
- ✅ REFACTOR: Add field validation

#### 3.3 MCP Tools (TDD)
- ✅ RED: Test cass_search tool
- ✅ GREEN: Implement search wrapper
- ✅ REFACTOR: Add token budget limits
- ✅ RED: Test cass_view tool
- ✅ GREEN: Implement viewer wrapper
- ✅ REFACTOR: Add error formatting
- ✅ RED: Test cass_health tool
- ✅ GREEN: Implement health checker
- ✅ REFACTOR: Add detailed diagnostics

**Validation:** Run characterization tests against new implementation
```typescript
describe('Session Indexing vs CASS Baseline', () => {
  test('search results match CASS structure', async () => {
    const newResults = await cass_search({ query: 'test', agent: 'opencode' });
    const baseline = JSON.parse(fs.readFileSync('baseline_search.json'));
    
    expect(newResults).toMatchObject({
      results: expect.arrayContaining([
        expect.objectContaining({
          source_path: expect.any(String),
          message_idx: expect.any(Number),
          agent_type: expect.any(String),
        })
      ])
    });
  });
});
```

### Phase 4: Migration & Observability (Day 3-4)

**Goal:** Migrate from binary CASS to inhouse, add observability.

#### 4.1 Dual-Mode Support
**Strategy:** Support both binary CASS and inhouse session indexing during transition.

```typescript
// config.ts
interface SessionIndexConfig {
  mode: 'binary' | 'inhouse' | 'hybrid';
  binaryPath?: string;        // Path to CASS binary (for binary/hybrid mode)
  watchPaths: string[];       // Directories to watch (inhouse mode)
  agentPatterns: AgentPattern[]; // Path → agent type mappings
}

// Hybrid mode: Try inhouse first, fallback to binary
async function cass_search(opts: SearchOpts) {
  if (config.mode === 'inhouse' || config.mode === 'hybrid') {
    try {
      return await sessionIndexer.search(opts);
    } catch (err) {
      if (config.mode === 'inhouse') throw err;
      // Fallback to binary in hybrid mode
    }
  }
  
  // Binary mode or hybrid fallback
  return execCassBinary(['search', opts.query, ...buildArgs(opts)]);
}
```

#### 4.2 Observability (Align with ADR-005)

**Metrics to track:**
```typescript
// Using Pino logger from ADR-005
logger.info({
  component: 'session-indexer',
  event: 'file-indexed',
  source_path: filePath,
  agent_type: agentType,
  message_count: messages.length,
  duration_ms: Date.now() - startTime,
  embedding_enabled: hasEmbeddings
});

logger.warn({
  component: 'session-indexer',
  event: 'staleness-detected',
  source_path: filePath,
  last_indexed_at: lastIndexed,
  file_mtime: currentMtime,
  age_seconds: currentMtime - lastIndexed
});

logger.error({
  component: 'session-parser',
  event: 'parse-failure',
  source_path: filePath,
  line_number: lineNum,
  error: err.message
});
```

**Health metrics:**
```typescript
interface SessionIndexHealth {
  status: 'ready' | 'degraded' | 'error';
  total_sessions: number;
  indexed_sessions: number;
  stale_sessions: number;
  agent_breakdown: Record<string, number>;
  last_index_duration_ms: number;
  embedding_enabled: boolean;
}
```

#### 4.3 Migration Checklist

**Pre-migration:**
- [ ] Run characterization tests against binary CASS
- [ ] Capture baseline performance metrics (index time, search latency)
- [ ] Document current CASS usage in codebase (grep for `cass_*`)

**Migration:**
- [ ] Set `mode: 'hybrid'` in config (inhouse with binary fallback)
- [ ] Index existing sessions with inhouse indexer
- [ ] Validate search results match binary CASS
- [ ] Monitor error logs for inhouse failures
- [ ] Run comparison tests (inhouse vs binary search results)

**Post-migration:**
- [ ] Set `mode: 'inhouse'` after 1 week of stable hybrid operation
- [ ] Remove binary CASS from dependencies
- [ ] Archive characterization tests (keep for regression)
- [ ] Update documentation (remove binary CASS instructions)

## Migration Path

### Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Phase 0: Characterization | 2 hours | Baseline test suite |
| Phase 1: Foundation | 1 day | Manual session indexing working |
| Phase 2: Automation | 1 day | File watching + auto-indexing |
| Phase 3: API + Tools | 1 day | MCP tools complete |
| Phase 4: Migration | 0.5 day | Hybrid mode validated |
| **Total** | **3.5 days** | Production-ready inhouse CASS |

### Subtask Breakdown (for Epic Creation)

1. **T1: Characterization Tests** (2h)
   - Files: `evals/fixtures/cass-baseline.ts`, `bin/cass.characterization.test.ts`
   - Tests: Search, view, health baselines

2. **T2: Session Parser + Metadata Schema** (4h)
   - Files: `swarm-mail/src/sessions/session-parser.ts`, `swarm-mail/src/sessions/session-parser.test.ts`
   - SQL: Add agent_type, session_id, message_role columns

3. **T3: Chunk Processor** (3h)
   - Files: `swarm-mail/src/sessions/chunk-processor.ts`, `.test.ts`
   - Integration: Reuse BatchEmbedder

4. **T4: File Watcher + Agent Discovery** (4h)
   - Files: `swarm-mail/src/sessions/file-watcher.ts`, `agent-discovery.ts`, `.test.ts`
   - Config: Add watch paths, agent patterns

5. **T5: Staleness Detector** (2h)
   - Files: `swarm-mail/src/sessions/staleness-detector.ts`, `.test.ts`
   - SQL: Add session_index_state table

6. **T6: Session Viewer** (2h)
   - Files: `swarm-mail/src/sessions/session-viewer.ts`, `.test.ts`
   - Features: Line extraction, context, syntax highlighting

7. **T7: Pagination API** (2h)
   - Files: `swarm-mail/src/adapter.ts` (extend findMemories)
   - API: Add fields parameter, field sets

8. **T8: MCP Tools** (4h)
   - Files: `src/sessions.ts` (cass_search, cass_view, cass_expand, cass_index, cass_health)
   - Integration: Wire up SessionIndexer

9. **T9: Dual-Mode Support** (3h)
   - Files: `src/sessions.ts` (add mode switching)
   - Config: Add mode: binary | inhouse | hybrid

10. **T10: Observability + Migration** (2h)
    - Files: Add Pino logging to all components
    - Validation: Run characterization tests in hybrid mode

**Total Estimate:** 28 hours (3.5 days)

## Observability Hooks (ADR-005 Alignment)

### Structured Logging (Pino)

All session indexing components use Pino logger from ADR-005:

```typescript
// logger.ts
import pino from 'pino';

export const sessionLogger = pino({
  name: 'session-indexer',
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname'
    }
  }
});

// Usage in session-parser.ts
sessionLogger.info({
  event: 'parse-start',
  source_path: filePath,
  agent_type: agentType
});

sessionLogger.warn({
  event: 'malformed-line',
  source_path: filePath,
  line_number: lineNum,
  error: err.message
});

sessionLogger.error({
  event: 'parse-failure',
  source_path: filePath,
  error: err,
  stack: err.stack
});
```

### Metrics

**Index Performance:**
- `session.index.duration_ms` - Time to index one session
- `session.index.message_count` - Messages indexed per session
- `session.index.embedding_duration_ms` - Time spent on embeddings

**Search Performance:**
- `session.search.duration_ms` - Search latency
- `session.search.result_count` - Results returned
- `session.search.embedding_enabled` - Whether embeddings were used

**Health Metrics:**
- `session.health.stale_count` - Number of stale sessions
- `session.health.total_sessions` - Total indexed sessions
- `session.health.agent_breakdown` - Sessions by agent type

### Tracing

Integrate with ADR-005 OpenTelemetry spans:

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('session-indexer');

async function indexSession(filePath: string) {
  return tracer.startActiveSpan('indexSession', async (span) => {
    span.setAttribute('source_path', filePath);
    span.setAttribute('agent_type', agentType);
    
    try {
      const messages = await parseSession(filePath);
      span.setAttribute('message_count', messages.length);
      
      const chunks = await chunkMessages(messages);
      span.setAttribute('chunk_count', chunks.length);
      
      await embedAndStore(chunks);
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

## Consequences

### What Becomes Easier

1. **Unified Query Interface** - One API for semantic memory + session search
2. **No External Binary** - Fewer dependencies, simpler installation
3. **Tighter Integration** - Swarm sessions auto-indexed, no export step
4. **Custom Enhancements** - Can add features without forking CASS (e.g., graph search)
5. **TDD-Friendly** - We control the test surface, can characterize behavior
6. **Observability** - Integrated with ADR-005 logging/metrics from day 1

### What Becomes Harder

1. **Maintenance Burden** - We own session parsing for 10+ agent formats
2. **Feature Parity** - Missing CASS features (TUI, multi-machine sync, encrypted formats)
3. **Performance Expectations** - Users may expect CASS-level performance (<60ms search)
4. **Agent Format Changes** - Need to track upstream session format changes
5. **Initial Migration** - 3.5 days of focused effort required

### Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Session format changes break parsing | High | Versioned parsers, graceful degradation |
| Ollama unavailable → no embeddings | Medium | FTS5 fallback, queue for retry |
| File watcher misses events | Medium | Periodic full scan (daily), staleness detection |
| Search performance slower than CASS | Medium | Index optimization, edge n-grams for prefix search |
| Users expect full CASS feature parity | Low | Clearly document Phase 1 scope, roadmap for Phase 2 |

### Future Work (Out of Scope for Phase 1)

- **TUI** - Interactive terminal UI with syntax highlighting (CASS has this)
- **Multi-machine sync** - SSH/rsync for remote session sources
- **Encrypted formats** - ChatGPT v2/v3 with macOS keychain decryption
- **Tantivy migration** - Replace FTS5 with Tantivy for <60ms search
- **Vector hybrid search** - RRF fusion of BM25 + semantic embeddings
- **Cloud agent connectors** - API integration for Claude Code, Gemini, Copilot
- **Real-time collaboration** - Multi-agent session sharing via Swarm Mail

## References

- **CASS Repository:** https://github.com/Dicklesworthstone/coding_agent_session_search
- **ADR-005:** Swarm DevTools Observability (Pino logging, OpenTelemetry)
- **Semantic Memory Docs:** `swarm-mail/README.md#semantic-memory`
- **Session Formats Survey:** semantic-memory ID `42e210ae-f69f-47f9-995c-62f9a39ff7ec`
- **Gap Analysis:** semantic-memory ID `319a7c67-9937-4f52-b3f5-31e06840b7ab`

---

## ASCII Art: The Inhousing Vision

```
     🔍 CASS Inhousing: Bridging the Gap
     
     
     BEFORE (External Binary)
     ┌────────────────────────────────────┐
     │   OpenCode Swarm Plugin            │
     │   ├─ hive (work tracking)          │
     │   ├─ swarm (coordination)          │
     │   └─ semantic-memory (learning)    │
     └────────────────────────────────────┘
                  │
                  │ shell exec
                  ▼
     ┌────────────────────────────────────┐
     │   CASS Binary (Rust)               │
     │   ├─ 20K LOC Tantivy indexer       │
     │   ├─ 10 agent connectors           │
     │   └─ TUI + Robot API               │
     └────────────────────────────────────┘
     
     
     AFTER (Partial Inhousing)
     ┌────────────────────────────────────┐
     │   OpenCode Swarm Plugin            │
     │   ├─ hive (work tracking)          │
     │   ├─ swarm (coordination)          │
     │   ├─ semantic-memory (learning)    │
     │   └─ session-indexer ⭐            │
     │       ├─ file watcher              │
     │       ├─ JSONL parsers (2 agents)  │
     │       ├─ metadata schema           │
     │       └─ MCP tools                 │
     └────────────────────────────────────┘
                  │
                  │ reuses 90%
                  ▼
     ┌────────────────────────────────────┐
     │   Semantic Memory Infrastructure   │
     │   ├─ libSQL + vector search        │
     │   ├─ Ollama embeddings             │
     │   ├─ FTS5 full-text                │
     │   └─ confidence decay              │
     └────────────────────────────────────┘
     
     
     THE GAP: 8 Thin Adapters (3.5 Days)
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     1. Session parsing (JSONL)
     2. Chunking (message-level)
     3. Metadata schema (agent_type, etc)
     4. File watching (debounced)
     5. Agent discovery (path mapping)
     6. Staleness detection (mtime)
     7. Pagination API (fields param)
     8. Session viewer (line reader)
```

**The Vision:** Bring the best of CASS (session indexing, agent awareness) into our existing semantic-memory infrastructure. Focus on JSONL formats (OpenCode Swarm, Cursor) first. Iterate based on usage.

**The Bet:** 90% of CASS's value comes from session indexing, not the TUI or multi-machine sync. We can build that 90% in 3.5 days by reusing our existing infrastructure.

**The Payoff:** Unified query API, tighter integration, one less external dependency, full TDD coverage from day 1.
