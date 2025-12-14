/**
 * Swarm Decomposition Quality Eval
 *
 * Tests the quality of task decomposition for swarm coordination.
 * Uses custom scorers to evaluate:
 * - Subtask independence (no file conflicts)
 * - Complexity balance (even distribution)
 * - Coverage completeness (all required files)
 * - Instruction clarity (actionable descriptions)
 *
 * Run with: pnpm evalite evals/swarm-decomposition.eval.ts
 */
import { evalite } from "evalite";
import {
  subtaskIndependence,
  complexityBalance,
  coverageCompleteness,
  instructionClarity,
} from "./scorers/index.js";
import {
  decompositionCases,
  type DecompositionTestCase,
} from "./fixtures/decomposition-cases.js";

/**
 * Mock decomposition function for testing
 *
 * In real usage, this would call the actual swarm_plan_prompt
 * and have an LLM generate the decomposition.
 *
 * For eval purposes, we use deterministic mock responses
 * to test the scorers themselves.
 */
function mockDecompose(input: DecompositionTestCase["input"]): string {
  // Generate a mock BeadTree based on the task
  const taskLower = input.task.toLowerCase();

  // Determine subtask count based on task complexity keywords
  let subtaskCount = 3;
  if (taskLower.includes("large") || taskLower.includes("legacy")) {
    subtaskCount = 5;
  } else if (taskLower.includes("fix") || taskLower.includes("bug")) {
    subtaskCount = 2;
  } else if (taskLower.includes("dashboard") || taskLower.includes("admin")) {
    subtaskCount = 4;
  }

  // Generate mock subtasks
  const subtasks: Array<{
    title: string;
    description: string;
    files: string[];
    dependencies: number[];
    estimated_complexity: number;
  }> = [];
  for (let i = 0; i < subtaskCount; i++) {
    subtasks.push({
      title: `Subtask ${i + 1}: ${input.task.split(" ").slice(0, 3).join(" ")}`,
      description: `Implement part ${i + 1} of the ${input.task}. This involves setting up the necessary infrastructure and writing the core logic.`,
      files: [`src/feature-${i + 1}/index.ts`, `src/feature-${i + 1}/types.ts`],
      dependencies: i > 0 ? [i - 1] : [],
      estimated_complexity: Math.floor(Math.random() * 3) + 2, // 2-4
    });
  }

  const beadTree = {
    epic: {
      title: input.task,
      description: input.context || `Implementation of: ${input.task}`,
    },
    subtasks,
  };

  return JSON.stringify(beadTree, null, 2);
}

/**
 * Swarm Decomposition Quality Eval
 *
 * Tests decomposition quality across multiple dimensions.
 */
evalite("Swarm Decomposition Quality", {
  // Test data from fixtures - return pre-computed outputs for scorer testing
  data: async () =>
    decompositionCases.map((testCase) => ({
      input: testCase.input,
      expected: testCase.expected,
      // Pre-compute output for scorer testing
      output: mockDecompose(testCase.input),
    })),

  // Task: passthrough since we pre-computed outputs
  task: async (input) => {
    return mockDecompose(input);
  },

  // Scorers evaluate decomposition quality
  scorers: [
    subtaskIndependence,
    complexityBalance,
    coverageCompleteness,
    instructionClarity,
  ],
});

/**
 * Edge Case Eval: Empty and Minimal Tasks
 *
 * Tests handling of edge cases in decomposition.
 */
evalite("Decomposition Edge Cases", {
  data: async () => [
    {
      input: { task: "Fix typo in README" },
      expected: { minSubtasks: 1, maxSubtasks: 1 },
    },
    {
      input: { task: "Refactor entire codebase to use new framework" },
      expected: { minSubtasks: 5, maxSubtasks: 10 },
    },
  ],

  task: async (input) => {
    return mockDecompose(input);
  },

  scorers: [subtaskIndependence, coverageCompleteness],
});
