/**
 * Swarm Structured Review Module
 *
 * Provides coordinator-driven review of worker output before completion.
 * The review is epic-aware - it checks if work serves the overall goal
 * and enables downstream tasks.
 *
 * Key features:
 * - Generate review prompts with full epic context
 * - Track review attempts (max 3 before task fails)
 * - Send structured feedback to workers
 * - Gate completion on review approval
 *
 * Credit: Review patterns inspired by https://github.com/nexxeln/opencode-config
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { sendSwarmMessage } from "swarm-mail";

// ============================================================================
// Types & Schemas
// ============================================================================

/**
 * Review issue - a specific problem found during review
 */
export interface ReviewIssue {
  file: string;
  line?: number;
  issue: string;
  suggestion?: string;
}

export const ReviewIssueSchema = z.object({
  file: z.string(),
  line: z.number().optional(),
  issue: z.string(),
  suggestion: z.string().optional(),
});

/**
 * Review result - the outcome of a review
 */
export interface ReviewResult {
  status: "approved" | "needs_changes";
  summary?: string;
  issues?: ReviewIssue[];
  remaining_attempts?: number;
}

export const ReviewResultSchema = z.object({
  status: z.enum(["approved", "needs_changes"]),
  summary: z.string().optional(),
  issues: z.array(ReviewIssueSchema).optional(),
  remaining_attempts: z.number().optional(),
}).refine(
  (data) => {
    // If status is needs_changes, issues must be provided
    if (data.status === "needs_changes") {
      return data.issues && data.issues.length > 0;
    }
    return true;
  },
  {
    message: "issues array is required when status is 'needs_changes'",
  }
);

/**
 * Dependency info for review context
 */
export interface DependencyInfo {
  id: string;
  title: string;
  summary?: string;
}

/**
 * Downstream task info
 */
export interface DownstreamTask {
  id: string;
  title: string;
}

/**
 * Review prompt context
 */
export interface ReviewPromptContext {
  epic_id: string;
  epic_title: string;
  epic_description?: string;
  task_id: string;
  task_title: string;
  task_description?: string;
  files_touched: string[];
  diff: string;
  completed_dependencies?: DependencyInfo[];
  downstream_tasks?: DownstreamTask[];
}

// ============================================================================
// Review Attempt Tracking
// ============================================================================

/**
 * In-memory tracking of review attempts per task
 * Key: task_id, Value: attempt count
 */
const reviewAttempts = new Map<string, number>();

const MAX_REVIEW_ATTEMPTS = 3;

/**
 * Get current attempt count for a task
 */
function getAttemptCount(taskId: string): number {
  return reviewAttempts.get(taskId) || 0;
}

/**
 * Increment attempt count for a task
 * @returns New attempt count
 */
function incrementAttempt(taskId: string): number {
  const current = getAttemptCount(taskId);
  const newCount = current + 1;
  reviewAttempts.set(taskId, newCount);
  return newCount;
}

/**
 * Clear attempt count (on success or task reset)
 */
function clearAttempts(taskId: string): void {
  reviewAttempts.delete(taskId);
}

/**
 * Get remaining attempts
 */
function getRemainingAttempts(taskId: string): number {
  return MAX_REVIEW_ATTEMPTS - getAttemptCount(taskId);
}

// ============================================================================
// Review Prompt Generation
// ============================================================================

/**
 * Generate a review prompt with full epic context
 *
 * The prompt includes:
 * - Epic goal (big picture)
 * - Task requirements
 * - Dependency context (what this builds on)
 * - Downstream context (what depends on this)
 * - The actual code diff
 * - Review criteria checklist
 */
export function generateReviewPrompt(context: ReviewPromptContext): string {
  const sections: string[] = [];

  // Header
  sections.push(`# Code Review: ${context.task_title}`);
  sections.push("");

  // Epic context (big picture)
  sections.push("## Epic Goal");
  sections.push(`**${context.epic_title}**`);
  if (context.epic_description) {
    sections.push(context.epic_description);
  }
  sections.push("");

  // Task requirements
  sections.push("## Task Requirements");
  sections.push(`**${context.task_title}**`);
  if (context.task_description) {
    sections.push(context.task_description);
  }
  sections.push("");

  // Dependency context
  if (context.completed_dependencies && context.completed_dependencies.length > 0) {
    sections.push("## This Task Builds On");
    for (const dep of context.completed_dependencies) {
      sections.push(`- **${dep.title}** (${dep.id})`);
      if (dep.summary) {
        sections.push(`  ${dep.summary}`);
      }
    }
    sections.push("");
  }

  // Downstream context
  if (context.downstream_tasks && context.downstream_tasks.length > 0) {
    sections.push("## Downstream Tasks (depend on this)");
    for (const task of context.downstream_tasks) {
      sections.push(`- **${task.title}** (${task.id})`);
    }
    sections.push("");
  }

  // Files touched
  sections.push("## Files Modified");
  for (const file of context.files_touched) {
    sections.push(`- \`${file}\``);
  }
  sections.push("");

  // Code diff
  sections.push("## Code Changes");
  sections.push("```diff");
  sections.push(context.diff);
  sections.push("```");
  sections.push("");

  // Review criteria
  sections.push("## Review Criteria");
  sections.push("");
  sections.push("Please evaluate the changes against these criteria:");
  sections.push("");
  sections.push("1. **Fulfills Requirements**: Does the code implement what the task requires?");
  sections.push("2. **Serves Epic Goal**: Does this work contribute to the overall epic objective?");
  sections.push("3. **Enables Downstream**: Can downstream tasks use this work as expected?");
  sections.push("4. **Type Safety**: Are types correct and complete?");
  sections.push("5. **No Critical Bugs**: Are there any obvious bugs or issues?");
  sections.push("6. **Test Coverage**: Are there tests for the new code? (warning only)");
  sections.push("");

  // Response format
  sections.push("## Response Format");
  sections.push("");
  sections.push("Respond with a JSON object:");
  sections.push("```json");
  sections.push(`{
  "status": "approved" | "needs_changes",
  "summary": "Brief summary of your review",
  "issues": [
    {
      "file": "path/to/file.ts",
      "line": 42,
      "issue": "Description of the problem",
      "suggestion": "How to fix it"
    }
  ]
}`);
  sections.push("```");

  return sections.join("\n");
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Generate a review prompt for a completed subtask
 *
 * Fetches epic and task details, gets the git diff, and generates
 * a comprehensive review prompt.
 */
export const swarm_review = tool({
  description:
    "Generate a review prompt for a completed subtask. Includes epic context, dependencies, and diff.",
  args: {
    project_key: z.string().describe("Project path"),
    epic_id: z.string().describe("Epic bead ID"),
    task_id: z.string().describe("Subtask bead ID to review"),
    files_touched: z
      .array(z.string())
      .optional()
      .describe("Files modified (will get diff for these)"),
  },
  async execute(args): Promise<string> {
    // Get epic details from beads
    const epicResult = await Bun.$`bd show ${args.epic_id} --json`
      .cwd(args.project_key)
      .quiet()
      .nothrow();

    let epicTitle = args.epic_id;
    let epicDescription: string | undefined;

    if (epicResult.exitCode === 0) {
      try {
        const epic = JSON.parse(epicResult.stdout.toString());
        epicTitle = epic.title || epicTitle;
        epicDescription = epic.description;
      } catch {
        // Use defaults
      }
    }

    // Get task details
    const taskResult = await Bun.$`bd show ${args.task_id} --json`
      .cwd(args.project_key)
      .quiet()
      .nothrow();

    let taskTitle = args.task_id;
    let taskDescription: string | undefined;

    if (taskResult.exitCode === 0) {
      try {
        const task = JSON.parse(taskResult.stdout.toString());
        taskTitle = task.title || taskTitle;
        taskDescription = task.description;
      } catch {
        // Use defaults
      }
    }

    // Get git diff for files
    let diff = "";
    if (args.files_touched && args.files_touched.length > 0) {
      const diffResult = await Bun.$`git diff HEAD~1 -- ${args.files_touched}`
        .cwd(args.project_key)
        .quiet()
        .nothrow();

      if (diffResult.exitCode === 0) {
        diff = diffResult.stdout.toString();
      } else {
        // Try staged diff
        const stagedResult = await Bun.$`git diff --cached -- ${args.files_touched}`
          .cwd(args.project_key)
          .quiet()
          .nothrow();
        diff = stagedResult.stdout.toString();
      }
    }

    // Get subtasks to find dependencies and downstream
    const subtasksResult = await Bun.$`bd list --parent ${args.epic_id} --json`
      .cwd(args.project_key)
      .quiet()
      .nothrow();

    const completedDependencies: DependencyInfo[] = [];
    const downstreamTasks: DownstreamTask[] = [];

    if (subtasksResult.exitCode === 0) {
      try {
        const subtasks = JSON.parse(subtasksResult.stdout.toString());
        for (const subtask of subtasks) {
          if (subtask.id === args.task_id) continue;

          // Check if this task depends on the reviewed task
          if (subtask.dependencies?.includes(args.task_id)) {
            downstreamTasks.push({
              id: subtask.id,
              title: subtask.title,
            });
          }

          // Check if reviewed task depends on this (and it's complete)
          // This would require checking the task's dependencies field
          if (subtask.status === "closed") {
            // For now, include all completed tasks as potential dependencies
            // A more sophisticated implementation would check actual dependency graph
            completedDependencies.push({
              id: subtask.id,
              title: subtask.title,
              summary: subtask.close_reason,
            });
          }
        }
      } catch {
        // Continue without dependency info
      }
    }

    // Generate the review prompt
    const reviewPrompt = generateReviewPrompt({
      epic_id: args.epic_id,
      epic_title: epicTitle,
      epic_description: epicDescription,
      task_id: args.task_id,
      task_title: taskTitle,
      task_description: taskDescription,
      files_touched: args.files_touched || [],
      diff: diff || "(no diff available)",
      completed_dependencies: completedDependencies.length > 0 ? completedDependencies : undefined,
      downstream_tasks: downstreamTasks.length > 0 ? downstreamTasks : undefined,
    });

    return JSON.stringify(
      {
        review_prompt: reviewPrompt,
        context: {
          epic_id: args.epic_id,
          epic_title: epicTitle,
          task_id: args.task_id,
          task_title: taskTitle,
          files_touched: args.files_touched || [],
          completed_dependencies: completedDependencies.length,
          downstream_tasks: downstreamTasks.length,
          remaining_attempts: getRemainingAttempts(args.task_id),
        },
      },
      null,
      2,
    );
  },
});

/**
 * Send review feedback to a worker
 *
 * Tracks review attempts and fails the task after 3 rejections.
 */
export const swarm_review_feedback = tool({
  description:
    "Send review feedback to a worker. Tracks attempts (max 3). Fails task after 3 rejections.",
  args: {
    project_key: z.string().describe("Project path"),
    task_id: z.string().describe("Subtask bead ID"),
    worker_id: z.string().describe("Worker agent name"),
    status: z.enum(["approved", "needs_changes"]).describe("Review status"),
    summary: z.string().optional().describe("Review summary"),
    issues: z
      .string()
      .optional()
      .describe("JSON array of ReviewIssue objects (for needs_changes)"),
  },
  async execute(args): Promise<string> {
    // Parse issues if provided
    let parsedIssues: ReviewIssue[] = [];
    if (args.issues) {
      try {
        parsedIssues = JSON.parse(args.issues);
      } catch {
        return JSON.stringify(
          {
            success: false,
            error: "Failed to parse issues JSON",
          },
          null,
          2,
        );
      }
    }

    // Validate: needs_changes requires issues
    if (args.status === "needs_changes" && parsedIssues.length === 0) {
      return JSON.stringify(
        {
          success: false,
          error: "needs_changes status requires at least one issue",
        },
        null,
        2,
      );
    }

    // Extract epic ID for thread
    const epicId = args.task_id.includes(".")
      ? args.task_id.split(".")[0]
      : args.task_id;

    if (args.status === "approved") {
      // Clear attempts on approval
      clearAttempts(args.task_id);

      // Send approval message
      await sendSwarmMessage({
        projectPath: args.project_key,
        fromAgent: "coordinator",
        toAgents: [args.worker_id],
        subject: `APPROVED: ${args.task_id}`,
        body: `## Review Approved ✓

${args.summary || "Your work has been approved."}

You may now complete the task with \`swarm_complete\`.`,
        threadId: epicId,
        importance: "normal",
      });

      return JSON.stringify(
        {
          success: true,
          status: "approved",
          task_id: args.task_id,
          message: "Review approved. Worker can now complete the task.",
        },
        null,
        2,
      );
    }

    // Handle needs_changes
    const attemptNumber = incrementAttempt(args.task_id);
    const remaining = MAX_REVIEW_ATTEMPTS - attemptNumber;

    // Check if task should fail
    if (remaining <= 0) {
      // Mark task as failed
      await Bun.$`bd update ${args.task_id} --status blocked --json`
        .cwd(args.project_key)
        .quiet()
        .nothrow();

      // Send failure message
      await sendSwarmMessage({
        projectPath: args.project_key,
        fromAgent: "coordinator",
        toAgents: [args.worker_id],
        subject: `FAILED: ${args.task_id} - max review attempts reached`,
        body: `## Task Failed ✗

Maximum review attempts (${MAX_REVIEW_ATTEMPTS}) reached.

**Last Issues:**
${parsedIssues.map((i: ReviewIssue) => `- ${i.file}${i.line ? `:${i.line}` : ""}: ${i.issue}`).join("\n")}

The task has been marked as blocked. A human or different approach is needed.`,
        threadId: epicId,
        importance: "urgent",
      });

      return JSON.stringify(
        {
          success: true,
          status: "needs_changes",
          task_failed: true,
          task_id: args.task_id,
          attempt: attemptNumber,
          remaining_attempts: 0,
          message: `Task failed after ${MAX_REVIEW_ATTEMPTS} review attempts`,
        },
        null,
        2,
      );
    }

    // Send feedback message
    const issuesList = parsedIssues
      .map((i: ReviewIssue) => {
        let line = `- **${i.file}**`;
        if (i.line) line += `:${i.line}`;
        line += `: ${i.issue}`;
        if (i.suggestion) line += `\n  → ${i.suggestion}`;
        return line;
      })
      .join("\n");

    await sendSwarmMessage({
      projectPath: args.project_key,
      fromAgent: "coordinator",
      toAgents: [args.worker_id],
      subject: `NEEDS CHANGES: ${args.task_id} (attempt ${attemptNumber}/${MAX_REVIEW_ATTEMPTS})`,
      body: `## Review: Changes Needed

${args.summary || "Please address the following issues:"}

**Issues:**
${issuesList}

**Remaining attempts:** ${remaining}

Please fix these issues and request another review.`,
      threadId: epicId,
      importance: "high",
    });

    return JSON.stringify(
      {
        success: true,
        status: "needs_changes",
        task_id: args.task_id,
        attempt: attemptNumber,
        remaining_attempts: remaining,
        issues: parsedIssues,
        message: `Feedback sent. ${remaining} attempt(s) remaining.`,
      },
      null,
      2,
    );
  },
});

// ============================================================================
// Review Gate for swarm_complete
// ============================================================================

/**
 * Review status for a task
 */
interface TaskReviewStatus {
  reviewed: boolean;
  approved: boolean;
  attempt_count: number;
  remaining_attempts: number;
}

/**
 * In-memory tracking of review status per task
 */
const reviewStatus = new Map<string, { approved: boolean; timestamp: number }>();

/**
 * Mark a task as reviewed and approved
 */
export function markReviewApproved(taskId: string): void {
  reviewStatus.set(taskId, { approved: true, timestamp: Date.now() });
  clearAttempts(taskId);
}

/**
 * Check if a task has been approved
 */
export function isReviewApproved(taskId: string): boolean {
  const status = reviewStatus.get(taskId);
  return status?.approved ?? false;
}

/**
 * Get review status for a task
 */
export function getReviewStatus(taskId: string): TaskReviewStatus {
  const status = reviewStatus.get(taskId);
  return {
    reviewed: status !== undefined,
    approved: status?.approved ?? false,
    attempt_count: getAttemptCount(taskId),
    remaining_attempts: getRemainingAttempts(taskId),
  };
}

/**
 * Clear review status (for testing or reset)
 */
export function clearReviewStatus(taskId: string): void {
  reviewStatus.delete(taskId);
  clearAttempts(taskId);
}

// ============================================================================
// Exports
// ============================================================================

export const reviewTools = {
  swarm_review,
  swarm_review_feedback,
};
