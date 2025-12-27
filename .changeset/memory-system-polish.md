---
"swarm-mail": patch
"opencode-swarm-plugin": patch
---

## 🐝 Memory System Polish: The Hive Remembers

> *"Our approach draws inspiration from the Zettelkasten method, a sophisticated
> knowledge management system that creates interconnected information networks
> through atomic notes and flexible linking."*
> — A-MEM: Agentic Memory for LLM Agents

```
                    .-.
                   (o o)  "Should I ADD, UPDATE, or NOOP?"
                   | O |
                   /   \        ___
                  /     \    .-'   '-.
        _____    /       \  /  .-=-.  \    _____
       /     \  |  ^   ^  ||  /     \  |  /     \
      | () () | |  (o o)  || | () () | | | () () |
       \_____/  |    <    ||  \_____/  |  \_____/
          |      \  ===  /  \    |    /      |
         _|_      '-----'    '--|--'       _|_
        /   \                   |         /   \
       | mem |<----related---->|mem|<--->| mem |
        \___/                   |         \___/
                            supersedes
                                |
                             ___|___
                            /       \
                           | mem-old |
                            \_______/
                                †
```

### What Changed

**swarm-mail:**
- **README overhaul** - Documented Wave 1-3 memory features with code examples
- **Test fixes** - `test.skip()` → `test.skipIf(!hasWorkingLLM)` for graceful CI/local behavior
- Replaced outdated `pgvector` references with `libSQL vec extension`

**opencode-swarm-plugin:**
- **ADR: Memory System Eval Strategy** - 3-tier approach (heuristics/integration/LLM-as-judge)
- **smart-operations.eval.ts** - Evalite test suite for ADD/UPDATE/DELETE/NOOP decisions
- Fixtures covering 8 test scenarios (exact match, refinement, contradiction, new info)
- LLM-as-judge scorer with graceful degradation

### The Philosophy

> *"As the system processes more memories over time, it develops increasingly
> sophisticated knowledge structures, discovering higher-order patterns and
> concepts across multiple memories."*
> — A-MEM

The memory system isn't just storage—it's a living knowledge graph that evolves.

### Run the Eval

```bash
bun run eval:smart-operations
```
