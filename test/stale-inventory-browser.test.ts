import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { chromium, request as playwrightRequest } from "playwright";
import { startServer } from "../src/server.ts";

test("a successful Save publishes a fresh Inventory without resetting the clean editor or preferences", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "hcs-inventory-save-fresh-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const artifactPath = join(home, ".codex", "config.toml");

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(artifactPath, "model = 'before'\n");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(5_000);
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Agent Harnesses" }).click();
      await page.getByTestId("filter-claude").click();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: /config\.toml.*settings/i }).click();
      const editor = page.getByRole("textbox", { name: "Artifact content" });
      await editor.fill("model = 'after'\n");
      await page.getByRole("button", { name: "Review save" }).click();

      const appliedResponse = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      await page.getByRole("dialog", { name: "Save Review" }).getByRole("button", { name: "Confirm save" }).click();
      const response = await appliedResponse;
      const payload = await response.json() as {
        editRevision: string;
        reconciliation: { status: string; published: { generation: number; snapshot: { schemaVersion: number } } };
      };

      assert.equal(response.status(), 200);
      assert.equal(payload.reconciliation.status, "fresh");
      assert.equal(payload.reconciliation.published.snapshot.schemaVersion, 1);
      assert.equal(payload.reconciliation.published.generation >= 2, true);
      await page.getByTestId("editor-status").getByText("Saved", { exact: true }).waitFor();
      assert.equal(await editor.inputValue(), "model = 'after'\n");
      assert.equal(await page.getByTestId("filter-claude").getAttribute("aria-pressed"), "false");
      assert.equal(await page.getByRole("button", { name: /\.codex.*Global Root/i }).getAttribute("aria-pressed"), "true");
      assert.equal(await page.getByRole("heading", { name: "Global configuration" }).locator("../..").getAttribute("open"), "");
      assert.equal(await readFile(artifactPath, "utf8"), "model = 'after'\n");
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("a Pending Edit through a symbolic-link alias blocks Removal of the exact target file", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "hcs-alias-target-dirty-removal-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const targetPath = join(home, ".codex", "config.toml");
  const aliasPath = join(home, ".codex", "AGENTS.md");
  let trashCalls = 0;
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(): Promise<void> { trashCalls += 1; },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(targetPath, "model = 'before'\n");
    await symlink("config.toml", aliasPath);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(5_000);
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).click();
      await page.getByRole("textbox", { name: "Artifact content" }).fill("# Browser-only draft through alias\n");

      const removeTarget = page.getByRole("button", { name: "Move config.toml to Trash" });
      assert.equal(await removeTarget.isDisabled(), true);
      assert.match(await removeTarget.getAttribute("title") ?? "", /Discard or save the pending edit first/);
      assert.equal(await page.getByRole("dialog", { name: "Move file to Trash" }).count(), 0);
      assert.equal(trashCalls, 0);
      assert.equal(await readFile(targetPath, "utf8"), "model = 'before'\n");
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("the protected refresh envelope is serialized and the public Inventory remains raw schemaVersion 1", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "hcs-inventory-refresh-api-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const unavailableWorkspace = join(fixtureRoot, "PRIVATE_REFRESH_SECRET");

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(home, ".codex", "config.toml"), "secret = 'must-not-leak'\n");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    try {
      const shell = await (await fetch(running.url)).text();
      const capability = shell.match(/name="hcs-session-capability" content="([^"]+)"/)?.[1];
      assert.ok(capability);
      const host = new URL(running.url).host;
      const validHeaders = { Host: host, Origin: running.url, "x-harness-config-capability": capability };
      const callRefresh = async (headers: Record<string, string>, reason: unknown = "manual", method = "POST") => {
        const api = await playwrightRequest.newContext({ extraHTTPHeaders: headers });
        try {
          const response = await api.fetch(`${running.url}/api/management/inventory/refresh`, {
            method,
            data: { reason },
          });
          return { status: response.status(), text: await response.text() };
        } finally {
          await api.dispose();
        }
      };

      const publicResponse = await fetch(`${running.url}/api/inventory`);
      const publicText = await publicResponse.text();
      assert.equal(publicResponse.status, 200);
      assert.equal(JSON.parse(publicText).schemaVersion, 1);
      assert.equal(JSON.parse(publicText).status, undefined);
      assert.equal(publicResponse.headers.get("x-harness-config-inventory-generation"), "1");

      const [second, third] = await Promise.all([
        callRefresh(validHeaders),
        callRefresh(validHeaders),
      ]);
      assert.equal(second.status, 200);
      assert.equal(third.status, 200);
      assert.deepEqual([
        JSON.parse(second.text).published.generation,
        JSON.parse(third.text).published.generation,
      ].sort((left, right) => left - right), [2, 3]);

      assert.equal((await callRefresh({ Host: host, Origin: running.url })).status, 401);
      assert.equal((await callRefresh({ ...validHeaders, Origin: "https://example.test" })).status, 403);
      assert.equal((await callRefresh({ ...validHeaders, Host: "example.test" })).status, 403);
      assert.equal((await callRefresh(validHeaders, "unexpected")).status, 400);
      assert.equal((await callRefresh(validHeaders, "manual", "GET")).status, 405);

      await rename(workspace, unavailableWorkspace);
      const stale = await callRefresh(validHeaders, "retry");
      assert.equal(stale.status, 200);
      const stalePayload = JSON.parse(stale.text);
      assert.equal(stalePayload.status, "stale");
      assert.equal(stalePayload.lastPublished.generation, 3);
      assert.equal(stalePayload.error.code, "inventory-refresh-failed");
      assert.doesNotMatch(stale.text, /PRIVATE_REFRESH_SECRET|must-not-leak|ENOENT|stack/i);

      const failedPublic = await fetch(`${running.url}/api/inventory`);
      const failedText = await failedPublic.text();
      assert.equal(failedPublic.status, 500);
      assert.deepEqual(JSON.parse(failedText), {
        error: {
          code: "inventory-refresh-failed",
          message: "Inventory could not be refreshed.",
          action: "inventory",
        },
      });
      assert.doesNotMatch(failedText, /PRIVATE_REFRESH_SECRET|must-not-leak|ENOENT|stack/i);

      await rename(unavailableWorkspace, workspace);
      const recovered = await callRefresh(validHeaders, "retry");
      assert.equal(JSON.parse(recovered.text).published.generation, 4);
    } finally {
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("a confirmed file Removal overlays the stale snapshot and Retry never repeats Trash", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "hcs-inventory-file-removal-stale-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const unavailableWorkspace = join(fixtureRoot, "workspace-unavailable");
  const trash = join(fixtureRoot, "Trash");
  const artifactPath = join(home, ".codex", "AGENTS.md");
  const aliasPath = join(home, ".codex", "config.toml");
  let trashCalls = 0;
  let barrierUsed = false;
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(intent: { path: string }): Promise<void> {
      trashCalls += 1;
      await rename(intent.path, join(trash, basename(intent.path)));
    },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(trash, { recursive: true });
    await writeFile(artifactPath, "# Remove me\n");
    await symlink("AGENTS.md", aliasPath);
    const running = await startServer({
      home,
      workspace,
      preferredPort: 0,
      strictPort: true,
      systemGateway,
      async afterPrimaryEffectForTest(effect) {
        if (effect.action !== "removal" || barrierUsed) return;
        barrierUsed = true;
        await rename(workspace, unavailableWorkspace);
      },
    });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(5_000);
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: /config\.toml.*settings/i }).click();
      await page.getByRole("textbox", { name: "Artifact content" }).waitFor();
      await page.getByRole("button", { name: "Move AGENTS.md to Trash" }).click();

      const appliedResponse = page.waitForResponse((response) => response.url().endsWith("/api/management/removals/apply"));
      await page.getByRole("dialog", { name: "Move file to Trash" }).getByRole("button", { name: "Move this file to Trash" }).click();
      const response = await appliedResponse;
      const payload = await response.json() as { result: string; reconciliation: { status: string } };
      assert.equal(response.status(), 200);
      assert.equal(payload.result, "moved-to-trash");
      assert.equal(payload.reconciliation.status, "stale");
      await page.getByText("Moved to Trash", { exact: true }).waitFor();
      await page.getByText("Moved to Trash. Inventory refresh failed; the view below may be outdated.", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).count(), 0);
      assert.equal(await page.getByRole("button", { name: /config\.toml.*settings/i }).count(), 0);
      assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "Open Trash" }).isEnabled(), true);
      assert.equal(trashCalls, 1);
      await assert.rejects(lstat(artifactPath));
      assert.equal(await readFile(join(trash, "AGENTS.md"), "utf8"), "# Remove me\n");

      await rename(unavailableWorkspace, workspace);
      await page.getByRole("button", { name: "Retry Inventory" }).click();
      await page.getByTestId("stale-inventory").waitFor({ state: "detached" });
      assert.equal(await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).count(), 0);
      const brokenAlias = page.getByRole("button", { name: /config\.toml.*settings/i });
      assert.equal(await brokenAlias.count(), 1);
      assert.equal(await brokenAlias.getByTestId("symlink-icon").getAttribute("aria-label"), "Broken symbolic link");
      assert.equal(trashCalls, 1);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("a confirmed symbolic-link Removal hides only the link while stale and leaves its target intact", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "hcs-inventory-link-removal-stale-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const unavailableWorkspace = join(fixtureRoot, "workspace-unavailable");
  const trash = join(fixtureRoot, "Trash");
  const targetPath = join(home, ".codex", "target.toml");
  const linkPath = join(home, ".codex", "config.toml");
  const otherAliasPath = join(home, ".codex", "AGENTS.md");
  let trashCalls = 0;
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(intent: { path: string }): Promise<void> {
      trashCalls += 1;
      await rename(intent.path, join(trash, basename(intent.path)));
    },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(trash, { recursive: true });
    await writeFile(targetPath, "target_secret = true\n");
    await symlink("target.toml", linkPath);
    await symlink("target.toml", otherAliasPath);
    const running = await startServer({
      home,
      workspace,
      preferredPort: 0,
      strictPort: true,
      systemGateway,
      async afterPrimaryEffectForTest(effect) {
        if (effect.action === "removal") await rename(workspace, unavailableWorkspace);
      },
    });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(5_000);
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: /config\.toml.*settings/i }).click();
      await page.getByRole("button", { name: "Move config.toml to Trash" }).click();
      await page.getByRole("dialog", { name: "Move symbolic link to Trash" }).getByRole("button", { name: "Move symbolic link to Trash" }).click();

      await page.getByText("Symbolic link moved to Trash; target unchanged", { exact: true }).waitFor();
      await page.getByTestId("stale-inventory").waitFor();
      assert.equal(await page.getByRole("button", { name: /config\.toml.*settings/i }).count(), 0);
      const otherAlias = page.getByRole("button", { name: /AGENTS\.md.*instructions/i });
      assert.equal(await otherAlias.count(), 1);
      assert.equal(await otherAlias.getByTestId("symlink-icon").getAttribute("aria-label"), "Symbolic link");
      assert.equal(await readFile(targetPath, "utf8"), "target_secret = true\n");
      assert.equal((await lstat(join(trash, "config.toml"))).isSymbolicLink(), true);
      assert.equal(await readlink(join(trash, "config.toml")), "target.toml");
      assert.equal(trashCalls, 1);

      await rename(unavailableWorkspace, workspace);
      await page.getByRole("button", { name: "Retry Inventory" }).click();
      await page.getByTestId("stale-inventory").waitFor({ state: "detached" });
      assert.equal(await page.getByRole("button", { name: /config\.toml.*settings/i }).count(), 0);
      assert.equal(await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).count(), 1);
      assert.equal(await readFile(targetPath, "utf8"), "target_secret = true\n");
      assert.equal(trashCalls, 1);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("a confirmed Managed Skill Directory Removal overlays only its subtree while stale", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "hcs-inventory-skill-removal-stale-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const unavailableWorkspace = join(fixtureRoot, "workspace-unavailable");
  const trash = join(fixtureRoot, "Trash");
  const skillDirectory = join(home, ".agents", "skills", "tool");
  const siblingDirectory = join(home, ".agents", "skills", "toolbox");
  const externalAlias = join(home, ".codex", "AGENTS.md");
  let trashCalls = 0;
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(intent: { path: string }): Promise<void> {
      trashCalls += 1;
      await rename(intent.path, join(trash, basename(intent.path)));
    },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(skillDirectory, { recursive: true });
    await mkdir(siblingDirectory, { recursive: true });
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(trash, { recursive: true });
    await writeFile(join(skillDirectory, "SKILL.md"), "# Tool\n");
    await writeFile(join(siblingDirectory, "SKILL.md"), "# Toolbox\n");
    await symlink(join(skillDirectory, "SKILL.md"), externalAlias);
    const running = await startServer({
      home,
      workspace,
      preferredPort: 0,
      strictPort: true,
      systemGateway,
      async afterPrimaryEffectForTest(effect) {
        if (effect.action === "removal") await rename(workspace, unavailableWorkspace);
      },
    });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(5_000);
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("button", { name: "Expand all sections" }).click();
      await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();
      await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).click();
      await page.getByRole("textbox", { name: "Artifact content" }).waitFor();
      await page.getByRole("button", { name: "Move tool to Trash", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Move skill directory to Trash" });
      await dialog.getByRole("textbox", { name: "Type “tool” to confirm" }).fill("tool");
      await dialog.getByRole("button", { name: "Move tool to Trash" }).click();

      await page.getByText("Moved to Trash", { exact: true }).waitFor();
      await page.getByTestId("stale-inventory").waitFor();
      assert.equal(await page.getByTestId("artifact-path").filter({ hasText: "/tool/SKILL.md" }).count(), 0);
      assert.equal(await page.getByTestId("artifact-path").filter({ hasText: "/toolbox/SKILL.md" }).count(), 1);
      assert.equal(await page.getByTestId("artifact-path").filter({ hasText: "/.codex/AGENTS.md" }).count(), 0);
      assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).count(), 0);
      await assert.rejects(lstat(skillDirectory));
      assert.equal(await readFile(join(trash, "tool", "SKILL.md"), "utf8"), "# Tool\n");
      assert.equal(await readFile(join(siblingDirectory, "SKILL.md"), "utf8"), "# Toolbox\n");
      assert.equal(trashCalls, 1);

      await rename(unavailableWorkspace, workspace);
      await page.getByRole("button", { name: "Retry Inventory" }).click();
      await page.getByTestId("stale-inventory").waitFor({ state: "detached" });
      assert.equal(await page.getByTestId("artifact-path").filter({ hasText: "/tool/SKILL.md" }).count(), 0);
      assert.equal(await page.getByTestId("artifact-path").filter({ hasText: "/toolbox/SKILL.md" }).count(), 1);
      const brokenAlias = page.getByRole("button", { name: /AGENTS\.md.*instructions/i });
      assert.equal(await brokenAlias.count(), 1);
      assert.equal(await brokenAlias.getByTestId("symlink-icon").getAttribute("aria-label"), "Broken symbolic link");
      assert.equal(trashCalls, 1);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("a successful Save stays authoritative when refresh fails and Retry only rescans Inventory", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "hcs-inventory-save-stale-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const unavailableWorkspace = join(fixtureRoot, "workspace-unavailable");
  const artifactPath = join(home, ".codex", "config.toml");
  let primaryEffects = 0;

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(artifactPath, "model = 'before'\n");
    const running = await startServer({
      home,
      workspace,
      preferredPort: 0,
      strictPort: true,
      async afterPrimaryEffectForTest(effect) {
        if (effect.action !== "save" || primaryEffects > 0) return;
        primaryEffects += 1;
        await rename(workspace, unavailableWorkspace);
      },
    });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(5_000);
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: /config\.toml.*settings/i }).click();
      const editor = page.getByRole("textbox", { name: "Artifact content" });
      await editor.fill("model = 'saved'\n");
      await page.getByRole("button", { name: "Review save" }).click();

      const appliedResponse = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      await page.getByRole("dialog", { name: "Save Review" }).getByRole("button", { name: "Confirm save" }).click();
      const response = await appliedResponse;
      const payload = await response.json() as {
        reconciliation: { status: string; lastPublishedGeneration: number; error: { code: string } };
      };
      assert.equal(response.status(), 200);
      assert.equal(payload.reconciliation.status, "stale");
      assert.equal(payload.reconciliation.lastPublishedGeneration, 1);
      assert.equal(payload.reconciliation.error.code, "inventory-refresh-failed");
      const activity = JSON.parse(await readFile(join(home, ".harness_config_studio", "activity.json"), "utf8")) as {
        records: Array<{ action: string; result: { status: string } }>;
      };
      assert.deepEqual(activity.records.map(({ action, result }) => ({ action, status: result.status })), [
        { action: "save", status: "success" },
      ]);
      assert.equal(await readFile(artifactPath, "utf8"), "model = 'saved'\n");
      assert.equal(await editor.inputValue(), "model = 'saved'\n");
      await page.getByText("Saved successfully. Inventory refresh failed; the view below may be outdated.", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Move config.toml to Trash" }).isDisabled(), true);
      assert.match(await page.getByRole("button", { name: "Move config.toml to Trash" }).getAttribute("title") ?? "", /Refresh Inventory/);

      await editor.fill("model = 'browser draft'\n");
      await page.getByRole("button", { name: "Retry Inventory" }).click();
      const guard = page.getByRole("dialog", { name: "Unsaved changes" });
      await guard.waitFor();
      await guard.getByRole("button", { name: "Cancel" }).click();
      assert.equal(await editor.inputValue(), "model = 'browser draft'\n");
      assert.equal(await page.getByTestId("stale-inventory").isVisible(), true);

      await rename(unavailableWorkspace, workspace);
      const retryResponse = page.waitForResponse((candidate) => candidate.url().endsWith("/api/management/inventory/refresh"));
      await page.getByRole("button", { name: "Retry Inventory" }).click();
      await page.getByRole("dialog", { name: "Unsaved changes" }).getByRole("button", { name: "Discard" }).click();
      const retry = await retryResponse;
      const retried = await retry.json() as { status: string; published: { generation: number } };
      assert.equal(retry.status(), 200);
      assert.equal(retried.status, "fresh");
      assert.equal(retried.published.generation, 2);
      await page.getByText("Saved successfully. Inventory refresh failed; the view below may be outdated.", { exact: true }).waitFor({ state: "detached" });
      assert.equal(await editor.inputValue(), "model = 'saved'\n");
      assert.equal(primaryEffects, 1);
      assert.equal(await readFile(artifactPath, "utf8"), "model = 'saved'\n");
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
