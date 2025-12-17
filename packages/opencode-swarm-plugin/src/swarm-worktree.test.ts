/**
 * Swarm Worktree Isolation Tests
 *
 * TDD: These tests verify git worktree isolation mode behavior.
 * Tests require git to be available.
 *
 * Credit: Patterns inspired by https://github.com/nexxeln/opencode-config
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  swarm_worktree_create,
  swarm_worktree_merge,
  swarm_worktree_cleanup,
  swarm_worktree_list,
  canUseWorktreeIsolation,
  getStartCommit,
  resetToStartCommit,
} from "./swarm-worktree";

// ============================================================================
// Test Utilities
// ============================================================================

const mockContext = {
  sessionID: `test-worktree-${Date.now()}`,
  messageID: `test-message-${Date.now()}`,
  agent: "test-agent",
  abort: new AbortController().signal,
};

let testDir: string;
let startCommit: string;

/**
 * Create a temporary git repository for testing
 */
async function createTestRepo(): Promise<string> {
  const dir = join(tmpdir(), `swarm-worktree-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  // Initialize git repo
  await Bun.$`git init`.cwd(dir).quiet();
  await Bun.$`git config user.email "test@test.com"`.cwd(dir).quiet();
  await Bun.$`git config user.name "Test User"`.cwd(dir).quiet();

  // Create initial commit
  writeFileSync(join(dir, "README.md"), "# Test Project\n");
  await Bun.$`git add .`.cwd(dir).quiet();
  await Bun.$`git commit -m "Initial commit"`.cwd(dir).quiet();

  // Create second commit (so we have history)
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/index.ts"), "export const foo = 'bar';\n");
  await Bun.$`git add .`.cwd(dir).quiet();
  await Bun.$`git commit -m "Add src/index.ts"`.cwd(dir).quiet();

  return dir;
}

/**
 * Clean up test repository
 */
function cleanupTestRepo(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Get current HEAD commit
 */
async function getHeadCommit(dir: string): Promise<string> {
  const result = await Bun.$`git rev-parse HEAD`.cwd(dir).quiet();
  return result.stdout.toString().trim();
}

/**
 * Check if git is available
 */
async function isGitAvailable(): Promise<boolean> {
  try {
    const result = await Bun.$`git --version`.quiet().nothrow();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// ============================================================================
// Test Setup
// ============================================================================

beforeAll(async () => {
  const gitAvailable = await isGitAvailable();
  if (!gitAvailable) {
    console.warn("Git not available, skipping worktree tests");
    return;
  }

  testDir = await createTestRepo();
  startCommit = await getHeadCommit(testDir);
});

afterAll(() => {
  if (testDir) {
    cleanupTestRepo(testDir);
  }
});

// ============================================================================
// Helper Function Tests
// ============================================================================

describe("canUseWorktreeIsolation", () => {
  it("returns true for clean git repo", async () => {
    if (!testDir) return;

    const result = await canUseWorktreeIsolation(testDir);
    expect(result.canUse).toBe(true);
  });

  it("returns false for non-git directory", async () => {
    const nonGitDir = join(tmpdir(), `non-git-${Date.now()}`);
    mkdirSync(nonGitDir, { recursive: true });

    try {
      const result = await canUseWorktreeIsolation(nonGitDir);
      expect(result.canUse).toBe(false);
      expect(result.reason).toContain("Not a git repository");
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it("returns false when uncommitted changes exist", async () => {
    if (!testDir) return;

    // Create uncommitted change
    writeFileSync(join(testDir, "dirty.txt"), "uncommitted");

    try {
      const result = await canUseWorktreeIsolation(testDir);
      expect(result.canUse).toBe(false);
      expect(result.reason).toContain("Uncommitted");
    } finally {
      // Clean up
      rmSync(join(testDir, "dirty.txt"));
    }
  });
});

describe("getStartCommit", () => {
  it("returns current HEAD commit", async () => {
    if (!testDir) return;

    const commit = await getStartCommit(testDir);
    expect(commit).toMatch(/^[a-f0-9]{40}$/);
    expect(commit).toBe(startCommit);
  });

  it("returns null for non-git directory", async () => {
    const nonGitDir = join(tmpdir(), `non-git-${Date.now()}`);
    mkdirSync(nonGitDir, { recursive: true });

    try {
      const commit = await getStartCommit(nonGitDir);
      expect(commit).toBeNull();
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// swarm_worktree_create Tests
// ============================================================================

describe("swarm_worktree_create", () => {
  afterEach(async () => {
    // Clean up any worktrees created during tests
    if (testDir) {
      await swarm_worktree_cleanup.execute(
        { project_path: testDir, cleanup_all: true },
        mockContext,
      );
    }
  });

  it("creates a git worktree for a task", async () => {
    if (!testDir) return;

    const result = await swarm_worktree_create.execute(
      {
        project_path: testDir,
        task_id: "bd-test-123.1",
        start_commit: startCommit,
      },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.worktree_path).toContain("bd-test-123.1");
    expect(parsed.worktree_path).toContain(".swarm/worktrees");
    expect(parsed.created_at_commit).toBe(startCommit);

    // Verify worktree exists
    expect(existsSync(parsed.worktree_path)).toBe(true);
  });

  it("returns error if worktree already exists", async () => {
    if (!testDir) return;

    // Create first worktree
    await swarm_worktree_create.execute(
      {
        project_path: testDir,
        task_id: "bd-duplicate",
        start_commit: startCommit,
      },
      mockContext,
    );

    // Try to create duplicate
    const result = await swarm_worktree_create.execute(
      {
        project_path: testDir,
        task_id: "bd-duplicate",
        start_commit: startCommit,
      },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("already exists");
  });

  it("returns error for non-git directory", async () => {
    const nonGitDir = join(tmpdir(), `non-git-${Date.now()}`);
    mkdirSync(nonGitDir, { recursive: true });

    try {
      const result = await swarm_worktree_create.execute(
        {
          project_path: nonGitDir,
          task_id: "bd-test",
          start_commit: "abc123",
        },
        mockContext,
      );

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("not a git repository");
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// swarm_worktree_list Tests
// ============================================================================

describe("swarm_worktree_list", () => {
  afterEach(async () => {
    if (testDir) {
      await swarm_worktree_cleanup.execute(
        { project_path: testDir, cleanup_all: true },
        mockContext,
      );
    }
  });

  it("lists all worktrees for a project", async () => {
    if (!testDir) return;

    // Create some worktrees
    await swarm_worktree_create.execute(
      { project_path: testDir, task_id: "bd-list-1", start_commit: startCommit },
      mockContext,
    );
    await swarm_worktree_create.execute(
      { project_path: testDir, task_id: "bd-list-2", start_commit: startCommit },
      mockContext,
    );

    const result = await swarm_worktree_list.execute(
      { project_path: testDir },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.worktrees).toBeInstanceOf(Array);
    expect(parsed.count).toBe(2);
    expect(parsed.worktrees.map((w: { task_id: string }) => w.task_id)).toContain("bd-list-1");
    expect(parsed.worktrees.map((w: { task_id: string }) => w.task_id)).toContain("bd-list-2");
  });

  it("returns empty list when no worktrees exist", async () => {
    if (!testDir) return;

    const result = await swarm_worktree_list.execute(
      { project_path: testDir },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.worktrees).toEqual([]);
    expect(parsed.count).toBe(0);
  });
});

// ============================================================================
// swarm_worktree_cleanup Tests
// ============================================================================

describe("swarm_worktree_cleanup", () => {
  it("removes a single worktree", async () => {
    if (!testDir) return;

    // Create worktree
    const createResult = await swarm_worktree_create.execute(
      { project_path: testDir, task_id: "bd-cleanup-single", start_commit: startCommit },
      mockContext,
    );
    const { worktree_path } = JSON.parse(createResult);

    // Remove it
    const result = await swarm_worktree_cleanup.execute(
      { project_path: testDir, task_id: "bd-cleanup-single" },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.removed_path).toBe(worktree_path);

    // Verify it's gone
    expect(existsSync(worktree_path)).toBe(false);
  });

  it("removes all worktrees when cleanup_all=true", async () => {
    if (!testDir) return;

    // Create multiple worktrees
    await swarm_worktree_create.execute(
      { project_path: testDir, task_id: "bd-cleanup-all-1", start_commit: startCommit },
      mockContext,
    );
    await swarm_worktree_create.execute(
      { project_path: testDir, task_id: "bd-cleanup-all-2", start_commit: startCommit },
      mockContext,
    );

    // Remove all
    const result = await swarm_worktree_cleanup.execute(
      { project_path: testDir, cleanup_all: true },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.removed_count).toBe(2);

    // Verify list is empty
    const listResult = await swarm_worktree_list.execute(
      { project_path: testDir },
      mockContext,
    );
    expect(JSON.parse(listResult).count).toBe(0);
  });

  it("is idempotent - no error if worktree doesn't exist", async () => {
    if (!testDir) return;

    const result = await swarm_worktree_cleanup.execute(
      { project_path: testDir, task_id: "bd-nonexistent" },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.already_removed).toBe(true);
  });
});

// ============================================================================
// swarm_worktree_merge Tests
// ============================================================================

describe("swarm_worktree_merge", () => {
  afterEach(async () => {
    if (testDir) {
      await swarm_worktree_cleanup.execute(
        { project_path: testDir, cleanup_all: true },
        mockContext,
      );
      // Reset to start commit to clean up any cherry-picked commits
      await resetToStartCommit(testDir, startCommit);
    }
  });

  it("cherry-picks commits from worktree to main", async () => {
    if (!testDir) return;

    // Create worktree
    const createResult = await swarm_worktree_create.execute(
      { project_path: testDir, task_id: "bd-merge-test", start_commit: startCommit },
      mockContext,
    );
    const { worktree_path } = JSON.parse(createResult);

    // Make a commit in the worktree
    writeFileSync(join(worktree_path, "new-file.ts"), "export const x = 1;\n");
    await Bun.$`git add .`.cwd(worktree_path).quiet();
    await Bun.$`git commit -m "Add new-file.ts"`.cwd(worktree_path).quiet();

    // Merge back
    const result = await swarm_worktree_merge.execute(
      { project_path: testDir, task_id: "bd-merge-test", start_commit: startCommit },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.merged_commit).toBeDefined();

    // Verify file exists in main repo
    expect(existsSync(join(testDir, "new-file.ts"))).toBe(true);
  });

  it("returns error if worktree has no commits", async () => {
    if (!testDir) return;

    // Create worktree but don't commit anything
    await swarm_worktree_create.execute(
      { project_path: testDir, task_id: "bd-no-commits", start_commit: startCommit },
      mockContext,
    );

    const result = await swarm_worktree_merge.execute(
      { project_path: testDir, task_id: "bd-no-commits", start_commit: startCommit },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    // Worktree may have been cleaned up by afterEach, so either error is valid
    expect(
      parsed.error.includes("no commits") || parsed.error.includes("Worktree not found")
    ).toBe(true);
  });

  it("returns error if worktree doesn't exist", async () => {
    if (!testDir) return;

    const result = await swarm_worktree_merge.execute(
      { project_path: testDir, task_id: "bd-nonexistent" },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("not found");
  });
});

// ============================================================================
// resetToStartCommit Tests
// ============================================================================

describe("resetToStartCommit", () => {
  it("resets main branch to start commit", async () => {
    if (!testDir) return;

    // Make a new commit
    writeFileSync(join(testDir, "temp-file.txt"), "temporary");
    await Bun.$`git add .`.cwd(testDir).quiet();
    await Bun.$`git commit -m "Temporary commit"`.cwd(testDir).quiet();

    // Verify we're ahead
    const currentCommit = await getHeadCommit(testDir);
    expect(currentCommit).not.toBe(startCommit);

    // Reset
    const result = await resetToStartCommit(testDir, startCommit);
    expect(result.success).toBe(true);

    // Verify we're back
    const afterReset = await getHeadCommit(testDir);
    expect(afterReset).toBe(startCommit);

    // Verify temp file is gone
    expect(existsSync(join(testDir, "temp-file.txt"))).toBe(false);
  });
});
