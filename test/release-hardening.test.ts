import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { chromium } from "playwright";
import { startServer } from "../src/server.ts";
import type { MacOsSystemGateway } from "../src/system-gateway.ts";

function capabilityFrom(shell: string): string {
  const match = shell.match(/<meta name="hcs-session-capability" content="([^"]+)">/);
  assert.ok(match?.[1], "web shell must contain the in-memory session capability");
  return match[1];
}

function managementHeaders(url: string, capability: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-harness-config-capability": capability,
    origin: url,
  };
}

test("the package exposes a complete public npm identity", async () => {
  const manifest = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
    name: string;
    private?: boolean;
    license?: string;
    repository?: { type?: string; url?: string };
    homepage?: string;
    bugs?: { url?: string };
    publishConfig?: { access?: string };
    scripts?: Record<string, string>;
    files?: string[];
  };

  assert.equal(manifest.name, "harness-config-studio");
  assert.equal("private" in manifest, false);
  assert.equal(manifest.license, "MIT");
  assert.deepEqual(manifest.repository, {
    type: "git",
    url: "git+https://github.com/warsclon/harness_config_studio.git",
  });
  assert.equal(manifest.homepage, "https://github.com/warsclon/harness_config_studio#readme");
  assert.deepEqual(manifest.bugs, {
    url: "https://github.com/warsclon/harness_config_studio/issues",
  });
  assert.deepEqual(manifest.publishConfig, { access: "public" });
  assert.equal(manifest.scripts?.prototype, undefined);
  assert.equal(manifest.scripts?.["prototype:cli"], undefined);
  assert.ok(manifest.files?.includes("LICENSE"));
  assert.match(await readFile(join(process.cwd(), "LICENSE"), "utf8"), /^MIT License/);
});

test("the compiled CLI remains executable for linked local installations", async () => {
  const cli = await stat(join(process.cwd(), "dist", "cli.js"));
  assert.ok(cli.mode & 0o111, "dist/cli.js must retain an executable mode after every build");
});

test("the package manifest is the only product version surfaced by CLI and web", async () => {
  const manifest = JSON.parse(await (await import("node:fs/promises")).readFile(join(process.cwd(), "package.json"), "utf8")) as {
    version: string;
  };
  const cli = join(process.cwd(), "dist", "cli.js");
  const version = spawnSync(process.execPath, [cli, "--version"], { encoding: "utf8" });
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-release-version-"));

  try {
    const home = join(fixtureRoot, "home");
    const workspace = join(fixtureRoot, "workspace");
    await mkdir(home, { recursive: true });
    await mkdir(workspace, { recursive: true });
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    try {
      const shell = await (await fetch(running.url)).text();
      assert.deepEqual(
        { status: version.status, stdout: version.stdout, stderr: version.stderr },
        { status: 0, stdout: `${manifest.version}\n`, stderr: "" },
      );
      assert.equal(help.status, 0);
      assert.match(help.stdout, new RegExp(`^Harness Config Studio ${manifest.version.replaceAll(".", "\\.")}`));
      assert.match(shell, new RegExp(`Version ${manifest.version.replaceAll(".", "\\.")}`));
      assert.doesNotMatch(shell, /class="tag"[^>]*>\s*v(?:1|\d+\.\d+\.\d+)\s*</i);
    } finally {
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("HTTP failures use one safe error envelope and management POST requires JSON", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-release-errors-"));
  const home = join(fixtureRoot, "home");
  const missingWorkspace = join(fixtureRoot, "missing-workspace");

  try {
    await mkdir(home, { recursive: true });
    const running = await startServer({ home, workspace: missingWorkspace, preferredPort: 0, strictPort: true });
    try {
      const shell = await (await fetch(running.url)).text();
      const capability = capabilityFrom(shell);
      const inventoryResponse = await fetch(`${running.url}/api/inventory`);
      const inventoryBody = await inventoryResponse.json();
      assert.deepEqual(inventoryBody, {
        error: {
          code: "inventory-refresh-failed",
          message: "Inventory could not be refreshed.",
          action: "inventory",
        },
      });

      const managementResponse = await fetch(`${running.url}/api/management/inventory/refresh`, {
        method: "POST",
        headers: {
          "x-harness-config-capability": capability,
          origin: running.url,
        },
        body: JSON.stringify({ reason: "manual" }),
      });
      assert.equal(managementResponse.status, 415);
      assert.deepEqual(await managementResponse.json(), {
        error: {
          code: "content-type-unsupported",
          message: "Management requests require application/json.",
          action: "refresh-inventory",
        },
      });
    } finally {
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("non-macOS management fails closed before a system gateway can act", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-release-platform-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const artifact = join(home, ".codex", "config.toml");
  const calls: string[] = [];
  const gateway: MacOsSystemGateway = {
    reveal: async () => { calls.push("reveal"); },
    moveToTrash: async () => { calls.push("trash"); return {}; },
    openTrash: async () => { calls.push("open-trash"); },
  };

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(artifact, "model = 'test'\n");
    const running = await startServer({
      home,
      workspace,
      preferredPort: 0,
      strictPort: true,
      systemGateway: gateway,
      platform: "linux",
    });
    try {
      const shell = await (await fetch(running.url)).text();
      const capability = capabilityFrom(shell);
      assert.match(shell, /data-system-management-supported="false"/);
      const response = await fetch(`${running.url}/api/management/reveal`, {
        method: "POST",
        headers: managementHeaders(running.url, capability),
        body: JSON.stringify({ target: { kind: "artifact", artifactIdentity: artifact } }),
      });
      assert.equal(response.status, 501);
      assert.deepEqual(await response.json(), {
        error: {
          code: "platform-unsupported",
          message: "This management action is available only on macOS.",
          action: "system-reveal",
        },
      });
      assert.deepEqual(calls, []);

      for (const [path, body, expectedAction] of [
        ["/api/management/saves/apply", { reviewId: "not-authoritative" }, "apply-save"],
        ["/api/management/removals/apply", { removalReviewId: "not-authoritative" }, "recoverable-removal"],
        ["/api/management/trash/open", {}, "open-trash"],
      ] as const) {
        const blocked = await fetch(`${running.url}${path}`, {
          method: "POST",
          headers: managementHeaders(running.url, capability),
          body: JSON.stringify(body),
        });
        assert.equal(blocked.status, 501);
        assert.deepEqual(await blocked.json(), {
          error: {
            code: "platform-unsupported",
            message: "This management action is available only on macOS.",
            action: expectedAction,
          },
        });
      }

      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(running.url);
        await page.locator('#app[data-state="ready"]').waitFor();
        await page.getByTestId("toggle-sections").click();
        assert.equal(await page.locator(".source-reveal").first().isDisabled(), true);
        assert.equal(await page.locator(".reveal-button").first().isDisabled(), true);
        assert.equal(await page.locator(".trash-button").first().isDisabled(), true);
        await page.locator("[data-artifact]").filter({ hasText: "config.toml" }).click();
        const editor = page.getByLabel("Artifact content");
        await editor.fill("model = 'edited'\n");
        await page.getByTestId("review-save").click();
        assert.equal(await page.getByTestId("confirm-save").isDisabled(), true);
        assert.equal(await readFile(artifact, "utf8"), "model = 'test'\n");
        assert.deepEqual(calls, []);
      } finally {
        await browser.close();
      }
    } finally {
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
