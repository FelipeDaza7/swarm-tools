#!/usr/bin/env bun
/**
 * OpenCode Swarm Plugin CLI
 *
 * Usage:
 *   swarm setup    - Install plugin wrapper and examples
 *   swarm doctor   - Check all dependencies
 *   swarm help     - Show help
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const blue = (s: string) => `\x1b[34m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

const CHECK = green("✓");
const CROSS = red("✗");
const WARN = yellow("⚠");

interface Dependency {
  name: string;
  command: string;
  checkArgs: string[];
  required: boolean;
  install: string;
}

const DEPENDENCIES: Dependency[] = [
  {
    name: "OpenCode",
    command: "opencode",
    checkArgs: ["--version"],
    required: true,
    install: "brew install sst/tap/opencode",
  },
  {
    name: "Beads (bd)",
    command: "bd",
    checkArgs: ["--version"],
    required: true,
    install:
      "curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash",
  },
  {
    name: "Agent Mail",
    command: "agent-mail",
    checkArgs: ["--version"],
    required: false,
    install: "go install github.com/joelhooks/agent-mail/cmd/agent-mail@latest",
  },
  {
    name: "CASS",
    command: "cass",
    checkArgs: ["health"],
    required: false,
    install: "See: https://github.com/Dicklesworthstone/cass",
  },
  {
    name: "UBS",
    command: "ubs",
    checkArgs: ["doctor"],
    required: false,
    install: "See: https://github.com/joelhooks/ubs",
  },
  {
    name: "semantic-memory",
    command: "semantic-memory",
    checkArgs: ["stats"],
    required: false,
    install: "npm install -g semantic-memory",
  },
  {
    name: "Redis",
    command: "redis-cli",
    checkArgs: ["ping"],
    required: false,
    install: "brew install redis && brew services start redis",
  },
];

async function checkCommand(cmd: string, args: string[]): Promise<boolean> {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

async function doctor() {
  console.log();
  console.log(blue("Checking dependencies...\n"));

  let allRequired = true;
  let optionalCount = 0;

  for (const dep of DEPENDENCIES) {
    const available = await checkCommand(dep.command, dep.checkArgs);
    const marker = dep.required
      ? available
        ? CHECK
        : CROSS
      : available
        ? CHECK
        : WARN;
    const suffix = dep.required ? "" : dim(" (optional)");

    console.log(`${marker} ${dep.name}${suffix}`);

    if (!available) {
      console.log(dim(`    Install: ${dep.install}`));
      if (dep.required) allRequired = false;
    } else if (!dep.required) {
      optionalCount++;
    }
  }

  console.log();

  if (!allRequired) {
    console.log(
      red("Missing required dependencies. Install them and try again."),
    );
    process.exit(1);
  }

  console.log(green(`All required dependencies installed.`));
  if (optionalCount < DEPENDENCIES.filter((d) => !d.required).length) {
    console.log(
      yellow(
        `Some optional dependencies missing - plugin will work with reduced features.`,
      ),
    );
  }
  console.log();
}

const PLUGIN_WRAPPER = `import { SwarmPlugin } from "opencode-swarm-plugin"
export default SwarmPlugin
`;

const SWARM_COMMAND = `---
description: Decompose task into parallel subtasks and coordinate agents
---

You are a swarm coordinator. Take a complex task, break it into beads, and unleash parallel agents.

## Usage

/swarm <task description or bead-id>

## Workflow

1. **Initialize**: \`agentmail_init\` with project_path and task_description
2. **Decompose**: Use \`swarm_select_strategy\` then \`swarm_plan_prompt\` to break down the task
3. **Create beads**: \`beads_create_epic\` with subtasks and file assignments
4. **Reserve files**: \`agentmail_reserve\` for each subtask's files
5. **Spawn agents**: Use Task tool with \`swarm_spawn_subtask\` prompts - spawn ALL in parallel
6. **Monitor**: Check \`agentmail_inbox\` for progress, use \`agentmail_summarize_thread\` for overview
7. **Complete**: \`swarm_complete\` when done, then \`beads_sync\` to push

## Strategy Selection

The plugin auto-selects decomposition strategy based on task keywords:

| Strategy | Best For | Keywords |
|----------|----------|----------|
| file-based | Refactoring, migrations | refactor, migrate, rename, update all |
| feature-based | New features | add, implement, build, create, feature |
| risk-based | Bug fixes, security | fix, bug, security, critical, urgent |

Begin decomposition now.
`;

const PLANNER_AGENT = `---
name: swarm-planner
description: Strategic task decomposition for swarm coordination
model: claude-sonnet-4-5
---

You are a swarm planner. Decompose tasks into optimal parallel subtasks.

## Workflow

1. Call \`swarm_select_strategy\` to analyze the task
2. Call \`swarm_plan_prompt\` to get strategy-specific guidance
3. Create a BeadTree following the guidelines
4. Return ONLY valid JSON - no markdown, no explanation

## Output Format

\`\`\`json
{
  "epic": { "title": "...", "description": "..." },
  "subtasks": [
    {
      "title": "...",
      "description": "...",
      "files": ["src/..."],
      "dependencies": [],
      "estimated_complexity": 2
    }
  ]
}
\`\`\`

## Rules

- 2-7 subtasks (too few = not parallel, too many = overhead)
- No file overlap between subtasks
- Include tests with the code they test
- Order by dependency (if B needs A, A comes first)
`;

async function setup() {
  console.log();
  console.log(blue("Setting up OpenCode Swarm Plugin...\n"));

  const configDir = join(homedir(), ".config", "opencode");
  const pluginsDir = join(configDir, "plugins");
  const commandsDir = join(configDir, "commands");
  const agentsDir = join(configDir, "agents");

  // Create directories
  for (const dir of [pluginsDir, commandsDir, agentsDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`${CHECK} Created ${dir}`);
    }
  }

  // Write plugin wrapper
  const pluginPath = join(pluginsDir, "swarm.ts");
  writeFileSync(pluginPath, PLUGIN_WRAPPER);
  console.log(`${CHECK} Created plugin wrapper: ${pluginPath}`);

  // Write command
  const commandPath = join(commandsDir, "swarm.md");
  writeFileSync(commandPath, SWARM_COMMAND);
  console.log(`${CHECK} Created /swarm command: ${commandPath}`);

  // Write agent
  const agentPath = join(agentsDir, "swarm-planner.md");
  writeFileSync(agentPath, PLANNER_AGENT);
  console.log(`${CHECK} Created @swarm-planner agent: ${agentPath}`);

  console.log();
  console.log(green("Setup complete!"));
  console.log();
  console.log("Next steps:");
  console.log(`  1. Run ${dim("swarm doctor")} to check dependencies`);
  console.log(`  2. Run ${dim("bd init")} in your project`);
  console.log(`  3. Start OpenCode and try ${dim("/swarm 'your task'")}`);
  console.log();
}

function help() {
  console.log(`
${blue("OpenCode Swarm Plugin CLI")}

Usage:
  swarm setup    Install plugin wrapper, /swarm command, and @swarm-planner agent
  swarm doctor   Check all dependencies and show install commands
  swarm help     Show this help

After setup, use in OpenCode:
  /swarm "Add user authentication with OAuth"
  @swarm-planner "Refactor components to use hooks"
`);
}

// Main
const command = process.argv[2];

switch (command) {
  case "setup":
    await setup();
    break;
  case "doctor":
    await doctor();
    break;
  case "help":
  case "--help":
  case "-h":
  case undefined:
    help();
    break;
  default:
    console.log(red(`Unknown command: ${command}`));
    help();
    process.exit(1);
}
