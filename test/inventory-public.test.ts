import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { ArtifactCategory } from "../src/adapters.ts";
import { inventory } from "../src/index.ts";

test("one global Codex artifact produces versioned inventory JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-config-studio-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const configPath = join(home, ".codex", "config.toml");

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(configPath, 'secret = "never serialize contents"');

    const result = await inventory(
      { home, workspace },
      { now: () => "2026-08-31T10:00:00.000Z" },
    );

    assert.deepEqual(result, {
      schemaVersion: 1,
      generatedAt: "2026-08-31T10:00:00.000Z",
      home: await realpath(home),
      workspace: await realpath(workspace),
      harnesses: [
        { id: "codex", status: "found" },
        { id: "claude", status: "not-found" },
        { id: "opencode", status: "not-found" },
        { id: "pi", status: "not-found" },
      ],
      globalRoots: [{
        harnesses: ["codex"],
        path: join(await realpath(home), ".codex"),
        kind: "directory",
        isSymbolicLink: false,
        resolvedPath: null,
        brokenLink: false,
      }],
      artifacts: [
        {
          harnesses: ["codex"],
          category: "settings",
          scope: { kind: "global", root: join(await realpath(home), ".codex") },
          path: join(await realpath(home), ".codex", "config.toml"),
          kind: "file",
          isSymbolicLink: false,
          resolvedPath: null,
          brokenLink: false,
        },
      ],
      projectRoots: [],
      warnings: [],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("one shared instruction belongs to several harnesses across project scopes", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-config-project-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const projectRoot = join(workspace, "acme");
  const nestedScope = join(projectRoot, "packages", "api");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(nestedScope, { recursive: true });
    await writeFile(join(projectRoot, "AGENTS.md"), "project instructions");
    await writeFile(join(nestedScope, "AGENTS.md"), "nested instructions");

    const result = await inventory(
      { home, workspace },
      { now: () => "2026-08-31T11:00:00.000Z" },
    );
    const canonicalHome = await realpath(home);
    const canonicalWorkspace = await realpath(workspace);
    const canonicalProject = join(canonicalWorkspace, "acme");
    const canonicalScope = join(canonicalProject, "packages", "api");

    assert.deepEqual(result, {
      schemaVersion: 1,
      generatedAt: "2026-08-31T11:00:00.000Z",
      home: canonicalHome,
      workspace: canonicalWorkspace,
      harnesses: [
        { id: "codex", status: "found" },
        { id: "claude", status: "not-found" },
        { id: "opencode", status: "found" },
        { id: "pi", status: "found" },
      ],
      globalRoots: [],
      artifacts: [
        {
          harnesses: ["codex", "opencode", "pi"],
          category: "instructions",
          scope: { kind: "project", projectRoot: canonicalProject, directory: canonicalProject },
          path: join(canonicalProject, "AGENTS.md"),
          kind: "file",
          isSymbolicLink: false,
          resolvedPath: null,
          brokenLink: false,
        },
        {
          harnesses: ["codex", "opencode", "pi"],
          category: "instructions",
          scope: { kind: "project", projectRoot: canonicalProject, directory: canonicalScope },
          path: join(canonicalScope, "AGENTS.md"),
          kind: "file",
          isSymbolicLink: false,
          resolvedPath: null,
          brokenLink: false,
        },
      ],
      projectRoots: [
        {
          name: "acme",
          path: canonicalProject,
          detectedBy: [".git", "AGENTS.md"],
          scopes: [canonicalScope],
        },
      ],
      warnings: [],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovers a Project Root inside a hidden workspace directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-config-hidden-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const projectRoot = join(workspace, ".internal", "acme");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await writeFile(join(projectRoot, "AGENTS.md"), "hidden project instructions");

    const result = await inventory(
      { home, workspace },
      { now: () => "2026-08-31T12:00:00.000Z" },
    );
    const canonicalProject = join(await realpath(workspace), ".internal", "acme");

    assert.deepEqual(result.projectRoots, [
      {
        name: "acme",
        path: canonicalProject,
        detectedBy: [".git", "AGENTS.md"],
        scopes: [],
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovers a Project Root from a recognized artifact without Git", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-config-marker-root-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const projectRoot = join(workspace, "standalone");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, "AGENTS.md"), "standalone instructions");

    const result = await inventory(
      { home, workspace },
      { now: () => "2026-08-31T13:00:00.000Z" },
    );
    const canonicalProject = join(await realpath(workspace), "standalone");

    assert.deepEqual(result.projectRoots, [
      {
        name: "standalone",
        path: canonicalProject,
        detectedBy: ["AGENTS.md"],
        scopes: [],
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("any recognized project artifact can establish a Project Root without Git", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-any-marker-root-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const projectRoot = join(workspace, "standalone");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(projectRoot, ".pi"), { recursive: true });
    await writeFile(join(projectRoot, ".pi", "settings.json"), "{}");

    const result = await inventory({ home, workspace });
    const canonicalProject = join(await realpath(workspace), "standalone");

    assert.deepEqual(result.projectRoots, [{
      name: "standalone",
      path: canonicalProject,
      detectedBy: [".pi/settings.json"],
      scopes: [],
    }]);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("a nested Git repository starts a separate Project Root", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-config-nested-git-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const outerRoot = join(workspace, "monorepo");
  const nestedRoot = join(outerRoot, "vendor", "tool");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(outerRoot, ".git"), { recursive: true });
    await mkdir(join(nestedRoot, ".git"), { recursive: true });
    await writeFile(join(outerRoot, "AGENTS.md"), "outer instructions");
    await writeFile(join(nestedRoot, "AGENTS.md"), "nested repository instructions");

    const result = await inventory(
      { home, workspace },
      { now: () => "2026-08-31T14:00:00.000Z" },
    );
    const canonicalWorkspace = await realpath(workspace);
    const canonicalOuter = join(canonicalWorkspace, "monorepo");
    const canonicalNested = join(canonicalOuter, "vendor", "tool");

    assert.deepEqual(result.projectRoots, [
      {
        name: "monorepo",
        path: canonicalOuter,
        detectedBy: [".git", "AGENTS.md"],
        scopes: [],
      },
      {
        name: "tool",
        path: canonicalNested,
        detectedBy: [".git", "AGENTS.md"],
        scopes: [],
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("depth limits return partial inventory with a structured warning for each skipped directory", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-depth-warning-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const skippedDirectory = join(workspace, "group", "too-deep");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(skippedDirectory, ".git"), { recursive: true });
    await writeFile(join(skippedDirectory, "AGENTS.md"), "not reached");

    const result = await inventory({ home, workspace, maxDepth: 1 });
    const canonicalSkipped = join(await realpath(workspace), "group", "too-deep");

    assert.deepEqual(result.projectRoots, []);
    assert.deepEqual(result.warnings, [{
      code: "depth-limit",
      path: canonicalSkipped,
      message: "Skipped directory beyond max depth 1",
    }]);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("project roots remain discoverable inside directories with generated-looking names", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-named-directories-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const ignoredNames = [".next", ".turbo", ".venv", "build", "coverage", "dist", "node_modules", "target"];

  try {
    await mkdir(home, { recursive: true });
    for (const name of ignoredNames) {
      await mkdir(join(workspace, name, "nested", ".git"), { recursive: true });
      await writeFile(join(workspace, name, "nested", "AGENTS.md"), "valid nested project");
    }

    const result = await inventory({ home, workspace, maxDepth: 2 });
    const canonicalWorkspace = await realpath(workspace);

    assert.deepEqual(
      result.projectRoots.map((projectRoot) => projectRoot.path),
      ignoredNames.map((name) => join(canonicalWorkspace, name, "nested")).sort(),
    );
    assert.deepEqual(result.warnings, []);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("unreadable paths return partial inventory with a structured permission warning", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-permission-warning-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const readableProject = join(workspace, "readable");
  const unreadableDirectory = join(workspace, "blocked");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(readableProject, ".git"), { recursive: true });
    await writeFile(join(readableProject, "AGENTS.md"), "visible");
    await mkdir(unreadableDirectory, { recursive: true });
    await chmod(unreadableDirectory, 0o000);

    const result = await inventory({ home, workspace });
    const canonicalWorkspace = await realpath(workspace);

    assert.equal(result.projectRoots.length, 1);
    assert.deepEqual(result.warnings, [{
      code: "unreadable-path",
      path: join(canonicalWorkspace, "blocked"),
      message: "Unable to read directory",
    }]);
  } finally {
    await chmod(unreadableDirectory, 0o700).catch(() => undefined);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("unreadable recognized artifact trees remain in partial inventory and produce a warning", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-unreadable-artifact-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const skillsRoot = join(home, ".agents", "skills");

  try {
    await mkdir(skillsRoot, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await chmod(skillsRoot, 0o000);

    const result = await inventory({ home, workspace });
    const canonicalSkills = join(await realpath(home), ".agents", "skills");

    assert.equal(result.artifacts.some((artifact) => artifact.path === canonicalSkills), true);
    assert.deepEqual(result.warnings, [{
      code: "unreadable-path",
      path: canonicalSkills,
      message: "Unable to read directory",
    }]);
  } finally {
    await chmod(skillsRoot, 0o700).catch(() => undefined);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("an unreadable Global Root produces one partial-scan warning", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-unreadable-global-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const codexRoot = join(home, ".codex");

  try {
    await mkdir(codexRoot, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(codexRoot, "config.toml"), "model = 'test'");
    await chmod(codexRoot, 0o000);

    const result = await inventory({ home, workspace });

    assert.deepEqual(result.warnings, [{
      code: "unreadable-path",
      path: join(await realpath(home), ".codex"),
      message: "Unable to read directory",
    }]);
  } finally {
    await chmod(codexRoot, 0o700).catch(() => undefined);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("normal and broken symbolic links are reported without traversing directory targets", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-symlinks-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const projectRoot = join(workspace, "acme");
  const targets = join(fixtureRoot, "targets");
  const configTarget = join(targets, "config.toml");
  const skillTarget = join(targets, "shared-skill");
  const configLink = join(home, ".codex", "config.toml");
  const skillsRoot = join(projectRoot, ".agents", "skills");
  const skillLink = join(skillsRoot, "shared");
  const brokenLink = join(skillsRoot, "missing");

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(skillTarget, { recursive: true });
    await writeFile(configTarget, "model = 'test'");
    await writeFile(join(skillTarget, "SKILL.md"), "must not be traversed");
    await mkdir(skillsRoot, { recursive: true });
    await symlink(configTarget, configLink);
    await symlink(skillTarget, skillLink);
    await symlink(join(targets, "does-not-exist"), brokenLink);

    const result = await inventory({ home, workspace });
    const canonicalHome = await realpath(home);
    const canonicalWorkspace = await realpath(workspace);
    const canonicalProject = join(canonicalWorkspace, "acme");
    const artifacts = new Map(result.artifacts.map((artifact) => [artifact.path, artifact]));

    assert.deepEqual(artifacts.get(join(canonicalHome, ".codex", "config.toml")), {
      harnesses: ["codex"],
      category: "settings",
      scope: { kind: "global", root: join(canonicalHome, ".codex") },
      path: join(canonicalHome, ".codex", "config.toml"),
      kind: "file",
      isSymbolicLink: true,
      resolvedPath: await realpath(configTarget),
      brokenLink: false,
    });
    assert.deepEqual(
      [artifacts.get(join(canonicalProject, ".agents", "skills", "shared")), artifacts.get(join(canonicalProject, ".agents", "skills", "missing"))]
        .map((artifact) => artifact && ({
          path: artifact.path,
          kind: artifact.kind,
          isSymbolicLink: artifact.isSymbolicLink,
          resolvedPath: artifact.resolvedPath,
          brokenLink: artifact.brokenLink,
        })),
      [
        {
          path: join(canonicalProject, ".agents", "skills", "shared"),
          kind: "directory",
          isSymbolicLink: true,
          resolvedPath: await realpath(skillTarget),
          brokenLink: false,
        },
        {
          path: join(canonicalProject, ".agents", "skills", "missing"),
          kind: "other",
          isSymbolicLink: true,
          resolvedPath: null,
          brokenLink: true,
        },
      ],
    );
    assert.equal(result.artifacts.some((artifact) => artifact.path.endsWith("shared/SKILL.md")), false);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("a symbolic-link Global Root is reported without traversing its target", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-global-root-link-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const target = join(fixtureRoot, "codex-target");
  const rootLink = join(home, ".codex");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "config.toml"), "must not be traversed");
    await symlink(target, rootLink);

    const result = await inventory({ home, workspace });
    const canonicalRootLink = join(await realpath(home), ".codex");

    assert.deepEqual(result.globalRoots, [{
      harnesses: ["codex"],
      path: canonicalRootLink,
      kind: "directory",
      isSymbolicLink: true,
      resolvedPath: await realpath(target),
      brokenLink: false,
    }]);
    assert.deepEqual(result.artifacts, []);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("the Claude adapter inventories settings and excludes runtime sessions", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-claude-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const settingsPath = join(home, ".claude", "settings.json");

  try {
    await mkdir(join(home, ".claude", "sessions"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(settingsPath, '{"theme":"dark"}');
    await writeFile(join(home, ".claude", "sessions", "private.json"), "runtime state");

    const result = await inventory(
      { home, workspace },
      { now: () => "2026-08-31T15:00:00.000Z" },
    );
    const canonicalHome = await realpath(home);

    assert.deepEqual(result.artifacts, [
      {
        harnesses: ["claude"],
        category: "settings",
        scope: { kind: "global", root: join(canonicalHome, ".claude") },
        path: join(canonicalHome, ".claude", "settings.json"),
        kind: "file",
        isSymbolicLink: false,
        resolvedPath: null,
        brokenLink: false,
      },
    ]);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("the OpenCode adapter inventories settings and skill trees but excludes cache", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-opencode-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const globalRoot = join(home, ".config", "opencode");

  try {
    await mkdir(join(globalRoot, "skills", "review"), { recursive: true });
    await mkdir(join(globalRoot, "cache"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(globalRoot, "opencode.json"), "{}");
    await writeFile(join(globalRoot, "skills", "review", "SKILL.md"), "review skill");
    await writeFile(join(globalRoot, "cache", "runtime.json"), "runtime state");

    const result = await inventory(
      { home, workspace },
      { now: () => "2026-08-31T16:00:00.000Z" },
    );
    const canonicalRoot = join(await realpath(home), ".config", "opencode");

    assert.deepEqual(
      result.artifacts.map(({ harnesses, category, path, kind }) => ({ harnesses, category, path, kind })),
      [
        { harnesses: ["opencode"], category: "settings", path: join(canonicalRoot, "opencode.json"), kind: "file" },
        { harnesses: ["opencode"], category: "skills", path: join(canonicalRoot, "skills"), kind: "directory" },
        { harnesses: ["opencode"], category: "skills", path: join(canonicalRoot, "skills", "review"), kind: "directory" },
        { harnesses: ["opencode"], category: "skills", path: join(canonicalRoot, "skills", "review", "SKILL.md"), kind: "file" },
      ],
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("the Pi adapter inventories settings and prompts but excludes credentials and sessions", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-pi-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const globalRoot = join(home, ".pi", "agent");

  try {
    await mkdir(join(globalRoot, "prompts"), { recursive: true });
    await mkdir(join(globalRoot, "sessions"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(globalRoot, "settings.json"), "{}");
    await writeFile(join(globalRoot, "prompts", "review.md"), "review prompt");
    await writeFile(join(globalRoot, "auth.json"), "credential material");
    await writeFile(join(globalRoot, "sessions", "private.json"), "runtime state");

    const result = await inventory(
      { home, workspace },
      { now: () => "2026-08-31T17:00:00.000Z" },
    );
    const canonicalRoot = join(await realpath(home), ".pi", "agent");

    assert.deepEqual(
      result.artifacts.map(({ harnesses, category, path, kind }) => ({ harnesses, category, path, kind })),
      [
        { harnesses: ["pi"], category: "prompts", path: join(canonicalRoot, "prompts"), kind: "directory" },
        { harnesses: ["pi"], category: "prompts", path: join(canonicalRoot, "prompts", "review.md"), kind: "file" },
        { harnesses: ["pi"], category: "settings", path: join(canonicalRoot, "settings.json"), kind: "file" },
      ],
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("project adapters inventory Claude OpenCode and Pi artifacts", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-project-adapters-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const projectRoot = join(workspace, "acme");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(projectRoot, ".claude", "skills", "review"), { recursive: true });
    await mkdir(join(projectRoot, ".opencode", "commands"), { recursive: true });
    await mkdir(join(projectRoot, ".pi"), { recursive: true });
    await writeFile(join(projectRoot, "CLAUDE.md"), "shared Claude and Pi instructions");
    await writeFile(join(projectRoot, ".claude", "skills", "review", "SKILL.md"), "review skill");
    await writeFile(join(projectRoot, ".opencode", "commands", "build.md"), "build command");
    await writeFile(join(projectRoot, "opencode.json"), "{}");
    await writeFile(join(projectRoot, ".opencode", "opencode.json"), "{}");
    await writeFile(join(projectRoot, ".pi", "settings.json"), "{}");

    const result = await inventory(
      { home, workspace },
      { now: () => "2026-08-31T18:00:00.000Z" },
    );
    const canonicalProject = join(await realpath(workspace), "acme");

    assert.deepEqual(
      result.artifacts.map(({ harnesses, category, path }) => ({ harnesses, category, path })),
      [
        { harnesses: ["claude", "opencode"], category: "skills", path: join(canonicalProject, ".claude", "skills") },
        { harnesses: ["claude", "opencode"], category: "skills", path: join(canonicalProject, ".claude", "skills", "review") },
        { harnesses: ["claude", "opencode"], category: "skills", path: join(canonicalProject, ".claude", "skills", "review", "SKILL.md") },
        { harnesses: ["opencode"], category: "commands", path: join(canonicalProject, ".opencode", "commands") },
        { harnesses: ["opencode"], category: "commands", path: join(canonicalProject, ".opencode", "commands", "build.md") },
        { harnesses: ["opencode"], category: "settings", path: join(canonicalProject, ".opencode", "opencode.json") },
        { harnesses: ["pi"], category: "settings", path: join(canonicalProject, ".pi", "settings.json") },
        { harnesses: ["claude", "opencode", "pi"], category: "instructions", path: join(canonicalProject, "CLAUDE.md") },
        { harnesses: ["opencode"], category: "settings", path: join(canonicalProject, "opencode.json") },
      ],
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("the Codex adapter inventories the shared global agents skill tree", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-shared-agents-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const skillsRoot = join(home, ".agents", "skills");

  try {
    await mkdir(join(skillsRoot, "prototype"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(skillsRoot, "prototype", "SKILL.md"), "prototype skill");

    const result = await inventory(
      { home, workspace },
      { now: () => "2026-08-31T19:00:00.000Z" },
    );
    const canonicalSkills = join(await realpath(home), ".agents", "skills");

    assert.deepEqual(
      result.artifacts.map(({ harnesses, category, path }) => ({ harnesses, category, path })),
      [
        { harnesses: ["codex", "opencode", "pi"], category: "skills", path: canonicalSkills },
        { harnesses: ["codex", "opencode", "pi"], category: "skills", path: join(canonicalSkills, "prototype") },
        { harnesses: ["codex", "opencode", "pi"], category: "skills", path: join(canonicalSkills, "prototype", "SKILL.md") },
      ],
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("OpenCode and Pi inventory their complete supported configuration catalogs and exclude runtime state", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-complete-adapters-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const projectRoot = join(workspace, "acme");
  const openCodeRoot = join(home, ".config", "opencode");
  const piRoot = join(home, ".pi", "agent");

  const globalArtifacts: Array<[string, "file" | "directory"]> = [
    [join(openCodeRoot, "AGENTS.md"), "file"],
    [join(openCodeRoot, "opencode.json"), "file"],
    [join(openCodeRoot, "opencode.jsonc"), "file"],
    [join(openCodeRoot, "tui.json"), "file"],
    [join(openCodeRoot, "agents", "review.md"), "file"],
    [join(openCodeRoot, "commands", "test.md"), "file"],
    [join(openCodeRoot, "modes", "plan.md"), "file"],
    [join(openCodeRoot, "plugins", "local.ts"), "file"],
    [join(openCodeRoot, "skills", "review", "SKILL.md"), "file"],
    [join(openCodeRoot, "tools", "search.ts"), "file"],
    [join(openCodeRoot, "themes", "night.json"), "file"],
    [join(piRoot, "AGENTS.md"), "file"],
    [join(piRoot, "SYSTEM.md"), "file"],
    [join(piRoot, "APPEND_SYSTEM.md"), "file"],
    [join(piRoot, "settings.json"), "file"],
    [join(piRoot, "keybindings.json"), "file"],
    [join(piRoot, "models.json"), "file"],
    [join(piRoot, "extensions", "local.ts"), "file"],
    [join(piRoot, "skills", "review", "SKILL.md"), "file"],
    [join(piRoot, "prompts", "review.md"), "file"],
    [join(piRoot, "themes", "night.json"), "file"],
  ];
  const projectArtifacts: Array<[string, "file" | "directory"]> = [
    [join(projectRoot, "opencode.jsonc"), "file"],
    [join(projectRoot, "tui.json"), "file"],
    [join(projectRoot, ".opencode", "opencode.jsonc"), "file"],
    [join(projectRoot, ".opencode", "agents", "review.md"), "file"],
    [join(projectRoot, ".opencode", "commands", "test.md"), "file"],
    [join(projectRoot, ".opencode", "modes", "plan.md"), "file"],
    [join(projectRoot, ".opencode", "plugins", "local.ts"), "file"],
    [join(projectRoot, ".opencode", "skills", "review", "SKILL.md"), "file"],
    [join(projectRoot, ".opencode", "tools", "search.ts"), "file"],
    [join(projectRoot, ".opencode", "themes", "night.json"), "file"],
    [join(projectRoot, ".pi", "SYSTEM.md"), "file"],
    [join(projectRoot, ".pi", "APPEND_SYSTEM.md"), "file"],
    [join(projectRoot, ".pi", "settings.json"), "file"],
    [join(projectRoot, ".pi", "keybindings.json"), "file"],
    [join(projectRoot, ".pi", "extensions", "local.ts"), "file"],
    [join(projectRoot, ".pi", "skills", "review", "SKILL.md"), "file"],
    [join(projectRoot, ".pi", "prompts", "review.md"), "file"],
    [join(projectRoot, ".pi", "themes", "night.json"), "file"],
  ];

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    for (const [path, kind] of [...globalArtifacts, ...projectArtifacts]) {
      if (kind === "directory") await mkdir(path, { recursive: true });
      else {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, "configuration");
      }
    }
    const excluded = [
      join(openCodeRoot, "cache", "runtime.json"),
      join(piRoot, "auth.json"),
      join(piRoot, "sessions", "private.jsonl"),
      join(piRoot, "cache", "runtime.json"),
      join(piRoot, "extensions-data", "plugin", "state.json"),
      join(projectRoot, ".pi", "auth.json"),
      join(projectRoot, ".pi", "sessions", "private.jsonl"),
    ];
    for (const path of excluded) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "runtime or credential data");
    }

    const result = await inventory({ home, workspace });
    const paths = new Set(result.artifacts.map((artifact) => artifact.path));
    const canonicalHome = await realpath(home);
    const canonicalWorkspace = await realpath(workspace);
    const canonical = (path: string) => path
      .replace(home, canonicalHome)
      .replace(workspace, canonicalWorkspace);

    for (const [path] of [...globalArtifacts, ...projectArtifacts]) {
      assert.equal(paths.has(canonical(path)), true, `expected recognized artifact ${path}`);
    }
    for (const path of excluded) {
      assert.equal(paths.has(canonical(path)), false, `expected runtime artifact exclusion ${path}`);
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("Codex and Claude inventory their complete supported configuration catalogs", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-codex-claude-catalog-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const projectRoot = join(workspace, "acme");
  const expected: Array<[string, ArtifactCategory]> = [
    [join(home, ".codex", "AGENTS.md"), "instructions"],
    [join(home, ".codex", "AGENTS.override.md"), "instructions"],
    [join(home, ".codex", "rules", "safe.rules"), "rules"],
    [join(home, ".codex", "prompts", "review.md"), "prompts"],
    [join(home, ".claude", "CLAUDE.md"), "instructions"],
    [join(home, ".claude", "agents", "review.md"), "agents"],
    [join(home, ".claude", "commands", "test.md"), "commands"],
    [join(home, ".claude", "skills", "review", "SKILL.md"), "skills"],
    [join(projectRoot, ".codex", "config.toml"), "settings"],
    [join(projectRoot, ".codex", "rules", "safe.rules"), "rules"],
    [join(projectRoot, ".agents", "skills", "review", "SKILL.md"), "skills"],
    [join(projectRoot, ".claude", "settings.json"), "settings"],
    [join(projectRoot, ".claude", "settings.local.json"), "settings"],
    [join(projectRoot, ".claude", "agents", "review.md"), "agents"],
    [join(projectRoot, ".claude", "commands", "test.md"), "commands"],
    [join(projectRoot, ".claude", "skills", "review", "SKILL.md"), "skills"],
    [join(projectRoot, ".mcp.json"), "mcp"],
  ];

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    for (const [path] of expected) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "configuration");
    }
    const excluded = [
      join(home, ".codex", "sessions", "private.jsonl"),
      join(home, ".claude", "history.jsonl"),
      join(home, ".claude", "projects", "private.jsonl"),
      join(home, ".claude", "cache", "runtime.json"),
    ];
    for (const path of excluded) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "runtime state");
    }

    const result = await inventory({ home, workspace });
    const canonicalHome = await realpath(home);
    const canonicalWorkspace = await realpath(workspace);
    const canonical = (path: string) => path.replace(home, canonicalHome).replace(workspace, canonicalWorkspace);
    const categories = new Map(result.artifacts.map((artifact) => [artifact.path, artifact.category]));
    const memberships = new Map(result.artifacts.map((artifact) => [artifact.path, artifact.harnesses]));

    for (const [path, category] of expected) {
      assert.equal(categories.get(canonical(path)), category, `expected ${category} artifact ${path}`);
    }
    assert.deepEqual(
      memberships.get(canonical(join(home, ".claude", "CLAUDE.md"))),
      ["claude", "opencode"],
    );
    assert.deepEqual(
      memberships.get(canonical(join(home, ".claude", "skills"))),
      ["claude", "opencode"],
    );
    for (const path of excluded) assert.equal(categories.has(canonical(path)), false);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
