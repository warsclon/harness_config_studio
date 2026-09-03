import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

test("the compiled CLI exposes inventory JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-config-cli-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const configPath = join(home, ".codex", "config.toml");

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(configPath, "model = 'gpt-test'");

    const execution = spawnSync(
      process.execPath,
      [join(process.cwd(), "dist", "cli.js"), "inventory", workspace, "--json"],
      {
        encoding: "utf8",
        env: { ...process.env, HOME: home },
      },
    );
    const payload = execution.stdout ? JSON.parse(execution.stdout) : null;
    const normalizedPayload = payload && !Number.isNaN(Date.parse(payload.generatedAt))
      ? { ...payload, generatedAt: "<iso-timestamp>" }
      : payload;

    assert.deepEqual(
      { status: execution.status, stderr: execution.stderr, payload: normalizedPayload },
      {
        status: 0,
        stderr: "",
        payload: {
          schemaVersion: 1,
          generatedAt: "<iso-timestamp>",
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
        },
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the compiled CLI help explains commands, machine-readable output, filters, and exit status", () => {
  const execution = spawnSync(
    process.execPath,
    [join(process.cwd(), "dist", "cli.js"), "--help"],
    { encoding: "utf8" },
  );

  assert.equal(execution.status, 0);
  assert.equal(execution.stderr, "");
  assert.match(execution.stdout, /Commands:/);
  assert.match(execution.stdout, /Inventory options:/);
  assert.match(execution.stdout, /--show-empty-projects/);
  assert.match(execution.stdout, /--no-warnings/);
  assert.match(execution.stdout, /JSON contract:/);
  assert.match(execution.stdout, /warnings.*remains present/i);
  assert.match(execution.stdout, /Exit status:/);
  assert.match(execution.stdout, /Examples:/);
});

test("the compiled inventory command honors discovery depth and returns partial warnings", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-config-cli-depth-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(workspace, "too-deep", ".git"), { recursive: true });
    const execution = spawnSync(
      process.execPath,
      [join(process.cwd(), "dist", "cli.js"), "inventory", workspace, "--depth", "0", "--json"],
      { encoding: "utf8", env: { ...process.env, HOME: home } },
    );
    const payload = execution.stdout ? JSON.parse(execution.stdout) as { warnings: unknown[] } : null;

    assert.equal(execution.status, 0);
    assert.equal(execution.stderr, "");
    assert.deepEqual(payload?.warnings, [{
      code: "depth-limit",
      path: join(await realpath(workspace), "too-deep"),
      message: "Skipped directory beyond max depth 0",
    }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the compiled inventory command hides empty Project Roots unless requested", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-config-cli-empty-projects-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(workspace, "empty", ".git"), { recursive: true });
    await mkdir(join(workspace, "configured", ".git"), { recursive: true });
    await writeFile(join(workspace, "configured", "AGENTS.md"), "project instructions");
    const cli = join(process.cwd(), "dist", "cli.js");
    const hidden = spawnSync(process.execPath, [cli, "inventory", workspace, "--json"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    const shown = spawnSync(
      process.execPath,
      [cli, "inventory", workspace, "--json", "--show-empty-projects"],
      { encoding: "utf8", env: { ...process.env, HOME: home } },
    );

    assert.equal(hidden.status, 0);
    assert.equal(shown.status, 0);
    assert.deepEqual(JSON.parse(hidden.stdout).projectRoots.map((project: { name: string }) => project.name), ["configured"]);
    assert.deepEqual(JSON.parse(shown.stdout).projectRoots.map((project: { name: string }) => project.name), ["configured", "empty"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the compiled inventory command can suppress warnings without changing the JSON shape", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-config-cli-no-warnings-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(workspace, "too-deep", ".git"), { recursive: true });
    const execution = spawnSync(
      process.execPath,
      [join(process.cwd(), "dist", "cli.js"), "inventory", workspace, "--depth", "0", "--json", "--no-warnings"],
      { encoding: "utf8", env: { ...process.env, HOME: home } },
    );

    assert.equal(execution.status, 0);
    assert.equal(execution.stderr, "");
    assert.deepEqual(JSON.parse(execution.stdout).warnings, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the compiled CLI starts the web UI by default and can suppress browser opening", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-config-cli-web-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(workspace, { recursive: true });
    const child = spawn(
      process.execPath,
      [join(process.cwd(), "dist", "cli.js"), workspace, "--no-open"],
      { env: { ...process.env, HOME: home }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });

    try {
      const url = await new Promise<string>((resolveUrl, rejectUrl) => {
        const timeout = setTimeout(() => rejectUrl(new Error(`Timed out waiting for CLI URL\n${stdout}\n${stderr}`)), 5_000);
        const inspect = () => {
          const match = stdout.match(/URL: (http:\/\/127\.0\.0\.1:\d+)/);
          if (!match?.[1]) return;
          clearTimeout(timeout);
          resolveUrl(match[1]);
        };
        child.stdout.on("data", inspect);
        child.once("exit", (code) => {
          clearTimeout(timeout);
          rejectUrl(new Error(`CLI exited before startup (${code})\n${stderr}`));
        });
      });
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /Harness Config Studio/);
      assert.equal(stderr, "");
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid CLI arguments and missing workspaces fail with a non-zero exit", () => {
  const cli = join(process.cwd(), "dist", "cli.js");
  const invalidDepth = spawnSync(process.execPath, [cli, "inventory", ".", "--depth", "nope"], { encoding: "utf8" });
  const missingWorkspace = spawnSync(
    process.execPath,
    [cli, "inventory", join(tmpdir(), "harness-config-does-not-exist"), "--json"],
    { encoding: "utf8" },
  );
  const removedAlias = spawnSync(process.execPath, [cli, "list", "."], { encoding: "utf8" });

  assert.deepEqual(
    { status: invalidDepth.status, stdout: invalidDepth.stdout, stderr: invalidDepth.stderr },
    { status: 1, stdout: "", stderr: "--depth must be an integer from 0 to 10\n" },
  );
  assert.equal(missingWorkspace.status, 1);
  assert.equal(missingWorkspace.stdout, "");
  assert.match(missingWorkspace.stderr, /ENOENT|no such file or directory/i);
  assert.equal(removedAlias.status, 1);
  assert.equal(removedAlias.stdout, "");
  assert.match(removedAlias.stderr, /Unexpected argument: \./);
});
