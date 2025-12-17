/**
 * Swarm Worktree Isolation Module
 *
 * Provides git worktree-based isolation for parallel swarm workers.
 * Each worker gets their own worktree at a shared start commit,
 * preventing file conflicts without needing reservations.
 *
 * Key features:
 * - Create worktrees at specific commits (swarm start point)
 * - Cherry-pick commits back to main branch
 * - Clean up worktrees on completion or abort
 * - List active worktrees for a project
 *
 * Credit: Patterns inspired by https://github.com/nexxeln/opencode-config
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { join } from "node:path";
import { existsSync } from "node:fs";

// ============================================================================
// Types
// ============================================================================

/**
 * Worktree info returned by git worktree list
 */
export interface WorktreeInfo {
  task_id: string;
  path: string;
  commit: string;
  branch?: string;
  created_at?: string;
}

/**
 * Result of worktree operations
 */
export interface WorktreeResult {
  success: boolean;
  worktree_path?: string;
  task_id?: string;
  error?: string;
  created_at_commit?: string;
  merged_commit?: string;
  removed_path?: string;
  removed_count?: number;
  already_removed?: boolean;
  conflicting_files?: string[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Directory where worktrees are stored
 */
const WORKTREE_DIR = ".swarm/worktrees";

/**
 * Get the worktree path for a task
 */
function getWorktreePath(projectPath: string, taskId: string): string {
  // Sanitize task ID for filesystem
  const safeTaskId = taskId.replace(/[^a-zA-Z0-9.-]/g, "_");
  return join(projectPath, WORKTREE_DIR, safeTaskId);
}

/**
 * Parse task ID from worktree path
 */
function parseTaskIdFromPath(worktreePath: string): string | null {
  const parts = worktreePath.split("/");
  const worktreesIdx = parts.indexOf("worktrees");
  if (worktreesIdx >= 0 && worktreesIdx < parts.length - 1) {
    return parts[worktreesIdx + 1];
  }
  return null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a path is a git repository
 */
async function isGitRepo(path: string): Promise<boolean> {
  const result = await Bun.$`git -C ${path} rev-parse --git-dir`
    .quiet()
    .nothrow();
  return result.exitCode === 0;
}

/**
 * Check if there are uncommitted changes
 */
async function hasUncommittedChanges(path: string): Promise<boolean> {
  const result = await Bun.$`git -C ${path} status --porcelain`.quiet().nothrow();
  if (result.exitCode !== 0) return true; // Assume dirty if can't check
  return result.stdout.toString().trim().length > 0;
}

/**
 * Get current HEAD commit
 */
async function getCurrentCommit(path: string): Promise<string | null> {
  const result = await Bun.$`git -C ${path} rev-parse HEAD`.quiet().nothrow();
  if (result.exitCode !== 0) return null;
  return result.stdout.toString().trim();
}

/**
 * Get commits in worktree since start_commit
 */
async function getWorktreeCommits(
  worktreePath: string,
  startCommit: string,
): Promise<string[]> {
  const result =
    await Bun.$`git -C ${worktreePath} log --format=%H ${startCommit}..HEAD`
      .quiet()
      .nothrow();
  if (result.exitCode !== 0) return [];
  return result.stdout
    .toString()
    .trim()
    .split("\n")
    .filter((c: string) => c.length > 0);
}

/**
 * Ensure worktree directory exists
 */
async function ensureWorktreeDir(projectPath: string): Promise<void> {
  const worktreeDir = join(projectPath, WORKTREE_DIR);
  await Bun.$`mkdir -p ${worktreeDir}`.quiet().nothrow();
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Create a git worktree for a task
 *
 * Creates an isolated worktree at the specified start commit.
 * Workers operate in their worktree without affecting main branch.
 */
export const swarm_worktree_create = tool({
  description:
    "Create a git worktree for isolated task execution. Worker operates in worktree, not main branch.",
  args: {
    project_path: z.string().describe("Absolute path to project root"),
    task_id: z.string().describe("Task/bead ID (e.g., bd-abc123.1)"),
    start_commit: z
      .string()
      .describe("Commit SHA to create worktree at (swarm start point)"),
  },
  async execute(args): Promise<string> {
    // Validate git repo
    if (!(await isGitRepo(args.project_path))) {
      const result: WorktreeResult = {
        success: false,
        error: `${args.project_path} is not a git repository`,
      };
      return JSON.stringify(result, null, 2);
    }

    // Check if worktree already exists
    const worktreePath = getWorktreePath(args.project_path, args.task_id);
    const exists = existsSync(worktreePath);
    if (exists) {
      const result: WorktreeResult = {
        success: false,
        error: `Worktree already exists for task ${args.task_id}`,
        worktree_path: worktreePath,
      };
      return JSON.stringify(result, null, 2);
    }

    // Ensure worktree directory exists
    await ensureWorktreeDir(args.project_path);

    // Create worktree at start_commit with detached HEAD
    // Using detached HEAD avoids branch conflicts between workers
    const createResult =
      await Bun.$`git -C ${args.project_path} worktree add --detach ${worktreePath} ${args.start_commit}`
        .quiet()
        .nothrow();

    if (createResult.exitCode !== 0) {
      const result: WorktreeResult = {
        success: false,
        error: `Failed to create worktree: ${createResult.stderr.toString()}`,
      };
      return JSON.stringify(result, null, 2);
    }

    const result: WorktreeResult = {
      success: true,
      worktree_path: worktreePath,
      task_id: args.task_id,
      created_at_commit: args.start_commit,
    };
    return JSON.stringify(result, null, 2);
  },
});

/**
 * Merge (cherry-pick) commits from worktree back to main
 *
 * After worker completes, cherry-pick their commits to main branch.
 * This integrates the isolated work back into the shared codebase.
 */
export const swarm_worktree_merge = tool({
  description:
    "Cherry-pick commits from worktree back to main branch. Call after worker completes.",
  args: {
    project_path: z.string().describe("Absolute path to project root"),
    task_id: z.string().describe("Task/bead ID"),
    start_commit: z
      .string()
      .optional()
      .describe("Original start commit (to find new commits)"),
  },
  async execute(args): Promise<string> {
    const worktreePath = getWorktreePath(args.project_path, args.task_id);

    // Check worktree exists
    const exists = existsSync(worktreePath);
    if (!exists) {
      const result: WorktreeResult = {
        success: false,
        error: `Worktree not found for task ${args.task_id}`,
      };
      return JSON.stringify(result, null, 2);
    }

    // Get start commit if not provided (from worktree's initial commit)
    let startCommit = args.start_commit;
    if (!startCommit) {
      // Try to get from worktree metadata or use merge-base
      const mergeBaseResult =
        await Bun.$`git -C ${args.project_path} merge-base HEAD ${worktreePath}`
          .quiet()
          .nothrow();
      if (mergeBaseResult.exitCode === 0) {
        startCommit = mergeBaseResult.stdout.toString().trim();
      }
    }

    if (!startCommit) {
      const result: WorktreeResult = {
        success: false,
        error: "Could not determine start commit for cherry-pick",
      };
      return JSON.stringify(result, null, 2);
    }

    // Get commits in worktree since start
    const commits = await getWorktreeCommits(worktreePath, startCommit);

    if (commits.length === 0) {
      const result: WorktreeResult = {
        success: false,
        error: `Worktree has no commits since ${startCommit.slice(0, 7)}`,
      };
      return JSON.stringify(result, null, 2);
    }

    // Cherry-pick commits in order (oldest first)
    const reversedCommits = commits.reverse();
    let lastMergedCommit: string | null = null;

    for (const commit of reversedCommits) {
      const cherryResult =
        await Bun.$`git -C ${args.project_path} cherry-pick ${commit}`
          .quiet()
          .nothrow();

      if (cherryResult.exitCode !== 0) {
        // Check if it's a conflict
        const stderr = cherryResult.stderr.toString();
        if (stderr.includes("conflict") || stderr.includes("CONFLICT")) {
          // Get conflicting files
          const statusResult =
            await Bun.$`git -C ${args.project_path} status --porcelain`
              .quiet()
              .nothrow();
          const conflictingFiles = statusResult.stdout
            .toString()
            .split("\n")
            .filter((line: string) => line.startsWith("UU") || line.startsWith("AA"))
            .map((line: string) => line.slice(3).trim());

          // Abort the cherry-pick
          await Bun.$`git -C ${args.project_path} cherry-pick --abort`
            .quiet()
            .nothrow();

          const result: WorktreeResult = {
            success: false,
            error: `Merge conflict during cherry-pick of ${commit.slice(0, 7)}`,
            conflicting_files: conflictingFiles,
          };
          return JSON.stringify(result, null, 2);
        }

        const result: WorktreeResult = {
          success: false,
          error: `Failed to cherry-pick ${commit.slice(0, 7)}: ${stderr}`,
        };
        return JSON.stringify(result, null, 2);
      }

      lastMergedCommit = commit;
    }

    const result: WorktreeResult = {
      success: true,
      task_id: args.task_id,
      merged_commit: lastMergedCommit || undefined,
    };
    return JSON.stringify(result, null, 2);
  },
});

/**
 * Clean up a worktree
 *
 * Removes the worktree directory and git tracking.
 * Call after merge or on abort.
 */
export const swarm_worktree_cleanup = tool({
  description:
    "Remove a worktree after completion or abort. Idempotent - safe to call multiple times.",
  args: {
    project_path: z.string().describe("Absolute path to project root"),
    task_id: z.string().optional().describe("Task/bead ID to clean up"),
    cleanup_all: z
      .boolean()
      .optional()
      .describe("Remove all worktrees for this project"),
  },
  async execute(args): Promise<string> {
    if (args.cleanup_all) {
      // List and remove all worktrees
      const listResult =
        await Bun.$`git -C ${args.project_path} worktree list --porcelain`
          .quiet()
          .nothrow();

      if (listResult.exitCode !== 0) {
        const result: WorktreeResult = {
          success: false,
          error: `Failed to list worktrees: ${listResult.stderr.toString()}`,
        };
        return JSON.stringify(result, null, 2);
      }

      // Parse worktree list
      const output = listResult.stdout.toString();
      const worktreeDir = join(args.project_path, WORKTREE_DIR);
      const worktrees = output
        .split("\n\n")
        .filter((block: string) => block.includes(worktreeDir))
        .map((block: string) => {
          const pathMatch = block.match(/^worktree (.+)$/m);
          return pathMatch ? pathMatch[1] : null;
        })
        .filter((p: string | null): p is string => p !== null);

      let removedCount = 0;
      for (const wt of worktrees) {
        const removeResult =
          await Bun.$`git -C ${args.project_path} worktree remove --force ${wt}`
            .quiet()
            .nothrow();
        if (removeResult.exitCode === 0) {
          removedCount++;
        }
      }

      const result: WorktreeResult = {
        success: true,
        removed_count: removedCount,
      };
      return JSON.stringify(result, null, 2);
    }

    if (!args.task_id) {
      const result: WorktreeResult = {
        success: false,
        error: "Either task_id or cleanup_all must be provided",
      };
      return JSON.stringify(result, null, 2);
    }

    const worktreePath = getWorktreePath(args.project_path, args.task_id);

    // Check if worktree exists (use existsSync for directories)
    const exists = existsSync(worktreePath);
    if (!exists) {
      // Idempotent - already removed
      const result: WorktreeResult = {
        success: true,
        already_removed: true,
        removed_path: worktreePath,
      };
      return JSON.stringify(result, null, 2);
    }

    // Remove worktree
    const removeResult =
      await Bun.$`git -C ${args.project_path} worktree remove --force ${worktreePath}`
        .quiet()
        .nothrow();

    if (removeResult.exitCode !== 0) {
      // Try manual cleanup if git worktree remove fails
      await Bun.$`rm -rf ${worktreePath}`.quiet().nothrow();
      await Bun.$`git -C ${args.project_path} worktree prune`
        .quiet()
        .nothrow();
    }

    const result: WorktreeResult = {
      success: true,
      removed_path: worktreePath,
      task_id: args.task_id,
    };
    return JSON.stringify(result, null, 2);
  },
});

/**
 * List all worktrees for a project
 *
 * Returns info about active worktrees including task IDs and paths.
 */
export const swarm_worktree_list = tool({
  description: "List all active worktrees for a project",
  args: {
    project_path: z.string().describe("Absolute path to project root"),
  },
  async execute(args): Promise<string> {
    const listResult =
      await Bun.$`git -C ${args.project_path} worktree list --porcelain`
        .quiet()
        .nothrow();

    if (listResult.exitCode !== 0) {
      return JSON.stringify(
        {
          worktrees: [],
          count: 0,
          error: `Failed to list worktrees: ${listResult.stderr.toString()}`,
        },
        null,
        2,
      );
    }

    // Parse worktree list
    const output = listResult.stdout.toString();
    const worktreeDir = join(args.project_path, WORKTREE_DIR);

    const worktrees: WorktreeInfo[] = [];

    // Split by double newline (each worktree block)
    const blocks = output.split("\n\n").filter((b: string) => b.trim());

    for (const block of blocks) {
      const pathMatch = block.match(/^worktree (.+)$/m);
      const commitMatch = block.match(/^HEAD ([a-f0-9]+)$/m);
      const branchMatch = block.match(/^branch (.+)$/m);

      if (pathMatch && pathMatch[1].includes(worktreeDir)) {
        const path = pathMatch[1];
        const taskId = parseTaskIdFromPath(path);

        if (taskId) {
          worktrees.push({
            task_id: taskId,
            path,
            commit: commitMatch ? commitMatch[1] : "unknown",
            branch: branchMatch ? branchMatch[1] : undefined,
          });
        }
      }
    }

    return JSON.stringify(
      {
        worktrees,
        count: worktrees.length,
      },
      null,
      2,
    );
  },
});

// ============================================================================
// Isolation Mode Helpers
// ============================================================================

/**
 * Check if worktree isolation can be used
 *
 * Worktree mode requires:
 * - Clean working directory (no uncommitted changes)
 * - Valid git repository
 */
export async function canUseWorktreeIsolation(
  projectPath: string,
): Promise<{ canUse: boolean; reason?: string }> {
  if (!(await isGitRepo(projectPath))) {
    return { canUse: false, reason: "Not a git repository" };
  }

  if (await hasUncommittedChanges(projectPath)) {
    return {
      canUse: false,
      reason: "Uncommitted changes exist - commit or stash first",
    };
  }

  return { canUse: true };
}

/**
 * Get the current commit for worktree start point
 */
export async function getStartCommit(
  projectPath: string,
): Promise<string | null> {
  return getCurrentCommit(projectPath);
}

/**
 * Hard reset main branch to start commit (for abort)
 */
export async function resetToStartCommit(
  projectPath: string,
  startCommit: string,
): Promise<{ success: boolean; error?: string }> {
  const result =
    await Bun.$`git -C ${projectPath} reset --hard ${startCommit}`
      .quiet()
      .nothrow();

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: `Failed to reset: ${result.stderr.toString()}`,
    };
  }

  return { success: true };
}

// ============================================================================
// Exports
// ============================================================================

export const worktreeTools = {
  swarm_worktree_create,
  swarm_worktree_merge,
  swarm_worktree_cleanup,
  swarm_worktree_list,
};
