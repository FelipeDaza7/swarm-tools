/**
 * CASS Baseline Response Fixtures
 * 
 * These fixtures capture the ACTUAL behavior of the CASS binary tools.
 * DO NOT modify to match desired behavior - these document what the binary DOES.
 * 
 * Purpose: Characterization tests for ADR-010 (CASS inhousing).
 * These ensure our inhouse implementation matches the binary's behavior.
 */

/**
 * cass stats --json
 * Captured: 2025-12-25
 */
export const cassStatsBaseline = {
  by_agent: [
    {
      agent: "claude_code",
      count: 137,
    },
    {
      agent: "cursor",
      count: 23,
    },
    {
      agent: "codex",
      count: 2,
    },
  ],
  conversations: 162,
  date_range: {
    newest: "2025-12-08T04:20:36.526+00:00",
    oldest: "2025-07-14T01:14:44.997+00:00",
  },
  db_path:
    "/Users/joel/Library/Application Support/com.coding-agent-search.coding-agent-search/agent_search.db",
  messages: 4213,
  top_workspaces: [
    {
      count: 28,
      workspace:
        "/Users/joel/Code/vercel/academy-vectr-workflow-course-content/external/workflow-builder-starter",
    },
    {
      count: 22,
      workspace: "/Users/joel/Code/vercel/slack-agents-course",
    },
  ],
} as const;

/**
 * cass search "swarm" --limit 2 --json
 * Captured: 2025-12-25
 */
export const cassSearchBaseline = {
  count: 2,
  cursor: null,
  hits: [
    {
      agent: "claude_code",
      content:
        'Fixed. The `plugins` key is invalid - OpenCode auto-loads plugins from directories instead.\n\n**Changes:**\n1. ✅ Removed invalid `plugins` array from `opencode.jsonc`\n2. ✅ Created `~/.config/opencode/plugin/` directory\n3. ✅ Symlinked your swarm plugin → `~/.config/opencode/plugin/swarm.js`\n\nThe plugin will now auto-load on startup. Restart OpenCode to pick it up.\n\nSources:\n- [OpenCode Plugins Documentation](https://opencode.ai/docs/plugins/)\n- [OpenCode Config Documentation](https://opencode.ai/docs/config/)',
      created_at: 1765161767083,
      line_number: 9,
      match_type: "exact",
      score: 15.536974906921387,
      snippet:
        "Symlinked your swarm plugin → `~/.config/opencode/plugin/swarm.js`\n\nThe plugin will now auto-load on startup. Restart OpenCode to pick it up.\n\nSources:\n- [OpenC…",
      source_path:
        "/Users/joel/.claude/projects/-Users-joel--config-opencode/ccd64ac6-bca7-40e5-9150-cea58c3788ae.jsonl",
      title:
        "@opencode.jsonc has an invalid plugins key https://opencode.ai/docs/plugins/ https://opencode.ai/doc",
      workspace: "/Users/joel/.config/opencode",
    },
    {
      agent: "claude_code",
      content:
        "I'm ready to help you explore the codebase and design implementation plans. I'm in **READ-ONLY mode** - I can explore files, understand architecture, and create detailed plans, but I cannot and will not modify any files.\n\nI have access to the beads issue tracker (`bd` commands) and can see your current working directory is `/Users/joel/.config/opencode`.\n\n**Current git status shows:**\n- Modified: `.beads/issues.jsonl`, `AGENTS.md`, `command/swarm.md`, `opencode.jsonc`\n- Untracked: `command/swarm-collect.md`, `command/swarm-status.md`, `plugin/`\n\n**What would you like me to explore and plan?**\n\nCommon scenarios I can help with:\n- Designing new command implementations\n- Planning plugin architecture\n- Exploring existing patterns for feature additions\n- Creating implementation strategies for beads issues\n\nLet me know what you need, and I'll dive into the codebase, understand the current architecture, and provide a detailed implementation plan.",
      created_at: 1765161814722,
      line_number: 1,
      match_type: "exact",
      score: 14.522254943847656,
      snippet:
        ".md`, `command/swarm.md`, `opencode.jsonc`\n- Untracked: `command/swarm-collect.md`, `command/swarm-status.md`, `plugin/`\n\n**What would you like me to explore an…",
      source_path:
        "/Users/joel/.claude/projects/-Users-joel--config-opencode/agent-ee2a73ee.jsonl",
      title: "opencode",
      workspace: "/Users/joel/.config/opencode",
    },
  ],
  hits_clamped: false,
  limit: 2,
  max_tokens: null,
  offset: 0,
  query: "swarm",
  request_id: null,
  total_matches: 2,
} as const;

/**
 * cass health (human-readable output)
 * Captured: 2025-12-25
 */
export const cassHealthHumanBaseline = `✓ Healthy (3ms)
  Note: index stale (older than 300s)`;

/**
 * cass stats (human-readable output)
 * Captured: 2025-12-25
 */
export const cassStatsHumanBaseline = `CASS Index Statistics
=====================
Database: /Users/joel/Library/Application Support/com.coding-agent-search.coding-agent-search/agent_search.db

Totals:
  Conversations: 162
  Messages: 4213

By Agent:
  claude_code: 137
  cursor: 23
  codex: 2

Top Workspaces:
  /Users/joel/Code/vercel/academy-vectr-workflow-course-content/external/workflow-builder-starter: 28
  /Users/joel/Code/vercel/slack-agents-course: 22
  /Users/joel/Code/vercel/academy-vectr-workflow-course-content: 22
  /Users/joel/Code/vercel/academy-content: 13
  /Users/joel/Code/joelhooks/trt-buddy: 13
  /Users/joel/Code/vercel/front: 11
  /Users/joel/.config/opencode: 9
  /Users/joel: 6
  /Users/joel/Code/badass-courses/course-builder/apps/ai-hero: 5
  /Users/joel/Code/vercel/front/apps/vercel-academy: 4

Date Range: 2025-07-14 to 2025-12-08`;

/**
 * cass view <file> -n <line>
 * Captured: 2025-12-25
 * 
 * Format: File path header, line indicator with context window, separator, content with line numbers
 */
export const cassViewBaseline = `File: /Users/joel/.config/swarm-tools/sessions/ses_19yz2iaMpHxY1ddvVq2voC.jsonl
Line: 1 (context: 5)
----------------------------------------
>    1 | {"session_id":"ses_19yz2iaMpHxY1ddvVq2voC","epic_id":"cell-f2p61v-mjko4d89zdt","timestamp":"2025-12-24T23:51:52.896Z","event_type":"OUTCOME","outcome_type":"subtask_success","payload":{"bead_id":"cell-f2p61v-mjko4d89zdt","duration_ms":0,"files_touched":[],"verification_passed":false,"verification_skipped":true}}
----------------------------------------`;

/**
 * Error responses (captured from actual failures)
 */
export const cassErrorBaseline = {
  fileNotFound: {
    error: {
      code: 3,
      hint: null,
      kind: "file-not-found",
      message:
        "File not found: /Users/joel/.config/swarm-tools/sessions/ses_fRrFb7WrNr9K89JBCKd6GV.jsonl",
      retryable: false,
    },
  },
  invalidArgument: {
    error: {
      code: 2,
      hint: {
        common_mistakes: [
          {
            correct: "cass robot-docs",
            wrong: "cass --robot-docs",
          },
          {
            correct: "cass robot-docs commands",
            wrong: "cass --robot-docs=commands",
          },
          {
            correct: "cass robot-docs",
            wrong: "cass robot-docs --robot",
          },
        ],
        error:
          "error: unexpected argument '--robot' found\\n\\nUsage: cass stats [OPTIONS]\\n\\nFor more information, try '--help'.\\n",
        examples: [
          "cass robot-docs commands",
          "cass robot-docs schemas",
          "cass robot-docs examples",
          "cass --robot-help",
        ],
        flag_syntax: {
          correct: ["--limit 5", "--robot", "--json"],
          incorrect: ["-limit 5", "limit=5", "--Limit"],
        },
        hints: [
          "For get robot-mode documentation, try: cass --robot-help",
        ],
        kind: "argument_parsing",
        status: "error",
      },
      kind: "usage",
      message: "Could not parse arguments",
      retryable: false,
    },
  },
} as const;

/**
 * Schema definitions extracted from actual responses
 */
export type CassStatsResponse = typeof cassStatsBaseline;
export type CassSearchResponse = typeof cassSearchBaseline;
export type CassSearchHit = CassSearchResponse["hits"][number];
export type CassAgentStats = CassStatsResponse["by_agent"][number];
export type CassWorkspaceStats = CassStatsResponse["top_workspaces"][number];
export type CassError =
  | typeof cassErrorBaseline.fileNotFound
  | typeof cassErrorBaseline.invalidArgument;
