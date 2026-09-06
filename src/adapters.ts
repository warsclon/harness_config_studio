import { join } from "node:path";

export type HarnessId = "codex" | "claude" | "opencode" | "pi";

export type ArtifactCategory =
  | "instructions"
  | "settings"
  | "skills"
  | "commands"
  | "mcp"
  | "agents"
  | "hooks"
  | "extensions"
  | "prompts"
  | "themes"
  | "rules"
  | "plugins"
  | "modes"
  | "tools";

export type HarnessAdapter = {
  id: HarnessId;
  version: 1;
  globalRoots: Array<{
    path(home: string): string;
    artifacts: GlobalArtifactPattern[];
  }>;
  projectArtifacts: ProjectArtifactPattern[];
  runtimeExclusions: string[];
};

export type GlobalArtifactPattern = {
    relativePath: string;
    category: ArtifactCategory;
    recursive?: boolean;
    source: string;
};

export type ProjectArtifactPattern = {
  relativePath: string;
  category: ArtifactCategory;
  harnesses: HarnessId[];
  recursive?: boolean;
  source: string;
};

export const PROJECT_ARTIFACTS: ProjectArtifactPattern[] = [
  {
    relativePath: "AGENTS.md",
    category: "instructions",
    harnesses: ["codex", "opencode", "pi"],
    source: "https://learn.chatgpt.com/docs/agent-configuration/agents-md",
  },
  {
    relativePath: "CLAUDE.md",
    category: "instructions",
    harnesses: ["claude", "opencode", "pi"],
    source: "https://docs.anthropic.com/en/docs/claude-code/memory",
  },
  {
    relativePath: ".claude/skills",
    category: "skills",
    harnesses: ["claude", "opencode"],
    recursive: true,
    source: "https://docs.anthropic.com/en/docs/claude-code/skills",
  },
  {
    relativePath: ".codex/config.toml",
    category: "settings",
    harnesses: ["codex"],
    source: "https://learn.chatgpt.com/docs/config-file/config-basic",
  },
  {
    relativePath: ".codex/rules",
    category: "rules",
    harnesses: ["codex"],
    recursive: true,
    source: "https://learn.chatgpt.com/docs/agent-configuration/rules",
  },
  {
    relativePath: ".agents/skills",
    category: "skills",
    harnesses: ["codex", "opencode", "pi"],
    recursive: true,
    source: "https://learn.chatgpt.com/docs/build-skills",
  },
  {
    relativePath: ".claude/settings.json",
    category: "settings",
    harnesses: ["claude"],
    source: "https://code.claude.com/docs/en/settings",
  },
  {
    relativePath: ".claude/settings.local.json",
    category: "settings",
    harnesses: ["claude"],
    source: "https://code.claude.com/docs/en/settings",
  },
  ...(["agents", "commands", "hooks"] as const).map(
    (name): ProjectArtifactPattern => ({
      relativePath: `.claude/${name}`,
      category: name,
      harnesses: ["claude"],
      recursive: true,
      source: `https://code.claude.com/docs/en/${name}`,
    }),
  ),
  {
    relativePath: ".mcp.json",
    category: "mcp",
    harnesses: ["claude"],
    source: "https://code.claude.com/docs/en/mcp",
  },
  {
    relativePath: "opencode.json",
    category: "settings",
    harnesses: ["opencode"],
    source: "https://opencode.ai/docs/config/",
  },
  {
    relativePath: "opencode.jsonc",
    category: "settings",
    harnesses: ["opencode"],
    source: "https://opencode.ai/docs/config/",
  },
  {
    relativePath: "tui.json",
    category: "settings",
    harnesses: ["opencode"],
    source: "https://opencode.ai/docs/config/",
  },
  {
    relativePath: ".opencode/opencode.json",
    category: "settings",
    harnesses: ["opencode"],
    source: "https://opencode.ai/docs/config/",
  },
  {
    relativePath: ".opencode/opencode.jsonc",
    category: "settings",
    harnesses: ["opencode"],
    source: "https://opencode.ai/docs/config/",
  },
  ...(["agents", "commands", "modes", "plugins", "skills", "tools", "themes"] as const).map(
    (name): ProjectArtifactPattern => ({
      relativePath: `.opencode/${name}`,
      category: name,
      harnesses: ["opencode"],
      recursive: true,
      source: "https://opencode.ai/docs/config/",
    }),
  ),
  {
    relativePath: ".pi/settings.json",
    category: "settings",
    harnesses: ["pi"],
    source: "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/settings.md",
  },
  {
    relativePath: ".pi/keybindings.json",
    category: "settings",
    harnesses: ["pi"],
    source: "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/keybindings.md",
  },
  {
    relativePath: ".pi/SYSTEM.md",
    category: "instructions",
    harnesses: ["pi"],
    source: "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md",
  },
  {
    relativePath: ".pi/APPEND_SYSTEM.md",
    category: "instructions",
    harnesses: ["pi"],
    source: "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md",
  },
  ...(["extensions", "skills", "prompts", "themes"] as const).map(
    (name): ProjectArtifactPattern => ({
      relativePath: `.pi/${name}`,
      category: name,
      harnesses: ["pi"],
      recursive: true,
      source: `https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/${name}.md`,
    }),
  ),
];

type GlobalRootDefinition = {
  id: HarnessId;
  version: 1;
  globalRoot(home: string): string;
  globalArtifacts: GlobalArtifactPattern[];
};

const GLOBAL_ROOT_DEFINITIONS: GlobalRootDefinition[] = [
  {
    id: "codex",
    version: 1,
    globalRoot: (home) => join(home, ".codex"),
    globalArtifacts: [
      {
        relativePath: "AGENTS.md",
        category: "instructions",
        source: "https://learn.chatgpt.com/docs/agent-configuration/agents-md",
      },
      {
        relativePath: "AGENTS.override.md",
        category: "instructions",
        source: "https://learn.chatgpt.com/docs/agent-configuration/agents-md",
      },
      {
        relativePath: "config.toml",
        category: "settings",
        source: "https://learn.chatgpt.com/docs/config-file/config-basic",
      },
      {
        relativePath: "rules",
        category: "rules",
        recursive: true,
        source: "https://learn.chatgpt.com/docs/agent-configuration/rules",
      },
      {
        relativePath: "prompts",
        category: "prompts",
        recursive: true,
        source: "https://github.com/openai/codex/blob/main/codex-rs/tui/src/custom_prompts.rs",
      },
    ],
  },
  {
    id: "codex",
    version: 1,
    globalRoot: (home) => join(home, ".agents"),
    globalArtifacts: [
      {
        relativePath: "skills",
        category: "skills",
        recursive: true,
        source: "https://learn.chatgpt.com/docs/build-skills",
      },
    ],
  },
  ...(["opencode", "pi"] as const).map(
    (id): GlobalRootDefinition => ({
      id,
      version: 1,
      globalRoot: (home) => join(home, ".agents"),
      globalArtifacts: [
        {
          relativePath: "skills",
          category: "skills",
          recursive: true,
          source: id === "opencode"
            ? "https://opencode.ai/docs/skills/"
            : "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md",
        },
      ],
    }),
  ),
  {
    id: "claude",
    version: 1,
    globalRoot: (home) => join(home, ".claude"),
    globalArtifacts: [
      {
        relativePath: "CLAUDE.md",
        category: "instructions",
        source: "https://code.claude.com/docs/en/memory",
      },
      {
        relativePath: "settings.json",
        category: "settings",
        source: "https://docs.anthropic.com/en/docs/claude-code/settings",
      },
      ...(["agents", "commands", "skills", "hooks"] as const).map((name) => ({
        relativePath: name,
        category: name,
        recursive: true,
        source: `https://code.claude.com/docs/en/${name}`,
      })),
    ],
  },
  {
    id: "opencode",
    version: 1,
    globalRoot: (home) => join(home, ".claude"),
    globalArtifacts: [
      {
        relativePath: "CLAUDE.md",
        category: "instructions",
        source: "https://opencode.ai/docs/rules/",
      },
      {
        relativePath: "skills",
        category: "skills",
        recursive: true,
        source: "https://opencode.ai/docs/skills/",
      },
    ],
  },
  {
    id: "opencode",
    version: 1,
    globalRoot: (home) => join(home, ".config", "opencode"),
    globalArtifacts: [
      {
        relativePath: "AGENTS.md",
        category: "instructions",
        source: "https://opencode.ai/docs/rules/",
      },
      {
        relativePath: "opencode.json",
        category: "settings",
        source: "https://opencode.ai/docs/config/",
      },
      {
        relativePath: "opencode.jsonc",
        category: "settings",
        source: "https://opencode.ai/docs/config/",
      },
      {
        relativePath: "tui.json",
        category: "settings",
        source: "https://opencode.ai/docs/config/",
      },
      ...(["agents", "commands", "modes", "plugins", "skills", "tools", "themes"] as const).map(
        (name) => ({
          relativePath: name,
          category: name,
          recursive: true,
          source: "https://opencode.ai/docs/config/",
        }),
      ),
    ],
  },
  {
    id: "pi",
    version: 1,
    globalRoot: (home) => join(home, ".pi", "agent"),
    globalArtifacts: [
      {
        relativePath: "AGENTS.md",
        category: "instructions",
        source: "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md",
      },
      {
        relativePath: "SYSTEM.md",
        category: "instructions",
        source: "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md",
      },
      {
        relativePath: "APPEND_SYSTEM.md",
        category: "instructions",
        source: "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md",
      },
      {
        relativePath: "settings.json",
        category: "settings",
        source: "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/settings.md",
      },
      {
        relativePath: "keybindings.json",
        category: "settings",
        source: "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/keybindings.md",
      },
      {
        relativePath: "models.json",
        category: "settings",
        source: "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md",
      },
      {
        relativePath: "extensions",
        category: "extensions",
        recursive: true,
        source: "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md",
      },
      {
        relativePath: "skills",
        category: "skills",
        recursive: true,
        source: "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md",
      },
      {
        relativePath: "prompts",
        category: "prompts",
        recursive: true,
        source: "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/prompt-templates.md",
      },
      {
        relativePath: "themes",
        category: "themes",
        recursive: true,
        source: "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/themes.md",
      },
    ],
  },
];

const RUNTIME_EXCLUSIONS: Record<HarnessId, string[]> = {
  codex: ["auth", "cache", "history", "logs", "sessions", "telemetry"],
  claude: ["cache", "credentials", "history", "logs", "projects", "sessions", "telemetry"],
  opencode: ["cache", "credentials", "logs", "sessions", "storage", "telemetry"],
  pi: ["auth", "cache", "credentials", "history", "logs", "sessions", "telemetry"],
};

export const HARNESS_ADAPTERS: HarnessAdapter[] = (["codex", "claude", "opencode", "pi"] as const)
  .map((id) => ({
    id,
    version: 1,
    globalRoots: GLOBAL_ROOT_DEFINITIONS
      .filter((definition) => definition.id === id)
      .map((definition) => ({ path: definition.globalRoot, artifacts: definition.globalArtifacts })),
    projectArtifacts: PROJECT_ARTIFACTS.filter((pattern) => pattern.harnesses.includes(id)),
    runtimeExclusions: RUNTIME_EXCLUSIONS[id],
  }));
