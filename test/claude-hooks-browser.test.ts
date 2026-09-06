import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { chromium } from "playwright";
import { startServer } from "../src/server.ts";
import type { InventoryResult } from "../src/inventory.ts";

test("Claude global and project hooks are discoverable and editable without executing or discovering unrelated scripts", async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), "hcs-claude-hooks-")));
  const home = join(fixture, "home"), workspace = join(fixture, "workspace"), project = join(workspace, "project");
  const globalHooks = join(home, ".claude", "hooks"), projectHooks = join(project, ".claude", "hooks");
  const marker = join(fixture, "must-not-run");
  const cases = [
    { path: join(globalHooks, "global.sh"), name: "global.sh", scope: "global", content: `#!/bin/sh\ntouch '${marker}'\n# original\n` },
    { path: join(projectHooks, "nested", "project.py"), name: "project.py", scope: "project", content: `from pathlib import Path\nPath(${JSON.stringify(marker)}).touch()\n# original\n` },
  ];
  await mkdir(globalHooks, { recursive: true });
  await mkdir(join(projectHooks, "nested"), { recursive: true });
  await mkdir(join(project, ".git"));
  const unrelated = join(project, "unrelated.py"), outside = join(fixture, "outside");
  await writeFile(unrelated, "UNRELATED_SOURCE_CONTENT\n");
  await mkdir(outside);
  await writeFile(join(outside, "hidden.py"), "EXTERNAL_SOURCE_CONTENT\n");
  await symlink(outside, join(projectHooks, "linked-directory"));
  await writeFile(join(project, ".claude", "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: `python3 ${unrelated}` }] }] } }));
  for (const item of cases) await writeFile(item.path, item.content.replaceAll("\n", "\r\n"), { mode: 0o750 });
  const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const response = await fetch(`${running.url}/api/inventory`);
    assert.equal(response.status, 200);
    const snapshot: InventoryResult = await response.json();
    assert.equal(snapshot.schemaVersion, 1);
    for (const item of cases) {
      const artifact = snapshot.artifacts.find(candidate => candidate.path === item.path);
      assert.ok(artifact, `Missing ${item.scope} hook`);
      assert.equal(artifact.category, "hooks");
      assert.equal(artifact.scope.kind, item.scope);
      assert.deepEqual(artifact.harnesses, ["claude"]);
    }
    assert.ok(!snapshot.artifacts.some(item => item.path === unrelated || item.path.endsWith("hidden.py")));
    assert.equal(snapshot.artifacts.find(item => item.path.endsWith("linked-directory"))?.isSymbolicLink, true);
    assert.doesNotMatch(JSON.stringify(snapshot), /UNRELATED_SOURCE_CONTENT|EXTERNAL_SOURCE_CONTENT|# original/);
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(running.url);
    await page.locator('#app[data-state="ready"]').waitFor();
    await page.getByTestId("toggle-sections").click();
    for (const item of cases) {
      await page.getByRole("button", { name: item.scope === "global" ? /\.claude.*Global Root/i : /project.*Project Root/i }).click();
      await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();
      await page.getByText(item.name, { exact: true }).click();
      const editor = page.getByLabel("Artifact content");
      await editor.waitFor();
      assert.equal(await editor.inputValue(), item.content);
      const changed = item.content.replace("# original", "# updated");
      await editor.fill(changed);
      await page.getByRole("button", { name: "Review save", exact: true }).click();
      assert.match(await page.getByTestId("save-validation").innerText(), /Syntax not validated/);
      assert.equal(await readFile(item.path, "utf8"), item.content.replaceAll("\n", "\r\n"));
      const applied = page.waitForResponse(r => r.url().endsWith("/api/management/saves/apply"));
      await page.getByRole("button", { name: "Confirm save" }).click();
      const result = await applied;
      assert.equal(result.status(), 200);
      assert.equal(await readFile((await result.json()).backupPath, "utf8"), item.content.replaceAll("\n", "\r\n"));
      assert.equal(await readFile(item.path, "utf8"), changed.replaceAll("\n", "\r\n"));
      assert.equal((await stat(item.path)).mode & 0o777, 0o750);
      await assert.rejects(lstat(marker), { code: "ENOENT" });
    }
  } finally {
    await browser.close();
    await running.close();
    await rm(fixture, { recursive: true, force: true });
  }
});
