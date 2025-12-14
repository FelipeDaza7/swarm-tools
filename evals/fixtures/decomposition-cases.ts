/**
 * Test cases for swarm task decomposition
 *
 * Each case includes:
 * - input: task description and optional context
 * - expected: validation criteria (min/max subtasks, required files)
 */

export interface DecompositionTestCase {
  input: {
    task: string;
    context?: string;
  };
  expected: {
    minSubtasks: number;
    maxSubtasks: number;
    requiredFiles?: string[];
  };
}

export const decompositionCases: DecompositionTestCase[] = [
  {
    input: {
      task: "Add user authentication with OAuth",
      context: "Next.js App Router application with existing user model",
    },
    expected: {
      minSubtasks: 3,
      maxSubtasks: 6,
      requiredFiles: [
        "src/auth/oauth.ts",
        "src/auth/middleware.ts",
        "app/api/auth/[...nextauth]/route.ts",
      ],
    },
  },
  {
    input: {
      task: "Implement rate limiting for API endpoints",
      context: "Express.js API with Redis available",
    },
    expected: {
      minSubtasks: 2,
      maxSubtasks: 4,
      requiredFiles: [
        "src/middleware/rate-limit.ts",
        "src/utils/redis-client.ts",
      ],
    },
  },
  {
    input: {
      task: "Add TypeScript strict mode to legacy JavaScript project",
      context: "Large codebase with 50+ JS files, currently untyped",
    },
    expected: {
      minSubtasks: 4,
      maxSubtasks: 8,
      requiredFiles: ["tsconfig.json"],
    },
  },
  {
    input: {
      task: "Create admin dashboard for user management",
      context: "React app with existing component library and API client",
    },
    expected: {
      minSubtasks: 4,
      maxSubtasks: 7,
      requiredFiles: [
        "src/pages/admin/Dashboard.tsx",
        "src/components/admin/UserTable.tsx",
        "src/api/admin.ts",
      ],
    },
  },
  {
    input: {
      task: "Fix memory leak in long-running background job",
      context:
        "Node.js worker that processes queue messages, memory grows over time",
    },
    expected: {
      minSubtasks: 2,
      maxSubtasks: 4,
      requiredFiles: ["src/workers/queue-processor.ts"],
    },
  },
  {
    input: {
      task: "Implement feature flag system with remote config",
      context:
        "Microservices architecture, need runtime toggles without deploys",
    },
    expected: {
      minSubtasks: 3,
      maxSubtasks: 6,
      requiredFiles: [
        "src/feature-flags/client.ts",
        "src/feature-flags/middleware.ts",
        "src/feature-flags/types.ts",
      ],
    },
  },
];
