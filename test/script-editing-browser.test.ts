import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { chromium } from "playwright";
import { startServer } from "../src/server.ts";

test("Python and shell edits preserve executable permissions, BOM, CRLF and backups without execution", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "hcs-script-edit-"));
  const home = join(fixture, "home"), workspace = join(fixture, "workspace");
  const skill = join(home, ".agents", "skills", "scripts");
  const marker = join(fixture, "must-not-execute");
  await mkdir(skill, { recursive: true });
  await mkdir(workspace);
  const cases = [
    { name: "sample.py", bom: true, source: `from pathlib import Path\nPath(${JSON.stringify(marker)}).touch()\n# original\n    # preserve indentation\n` },
    { name: "sample.sh", bom: false, source: `#!/bin/sh\ntouch '${marker}'\n# original\n    # preserve indentation\n` },
  ];
  for (const item of cases) {
    await writeFile(join(skill, item.name), (item.bom ? "\ufeff" : "") + item.source.replaceAll("\n", "\r\n"), { mode: 0o750 });
  }
  const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(running.url);
    await page.locator('#app[data-state="ready"]').waitFor();
    await page.getByTestId("toggle-sections").click();
    await page.getByRole("button", { name: /\.agents.*Global Root/i }).click();
    await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();
    for (const item of cases) {
      const path = join(skill, item.name);
      const original = await readFile(path);
      await page.getByText(item.name, { exact: true }).click();
      const editor = page.getByLabel("Artifact content");
      await editor.waitFor();
      assert.equal(await editor.inputValue(), item.source);
      const updated = item.source.replace("# original", "# updated");
      await editor.fill(updated);
      await page.getByRole("button", { name: "Review save", exact: true }).click();
      await page.getByRole("dialog", { name: "Save Review" }).waitFor();
      assert.deepEqual(await readFile(path), original);
      const response = page.waitForResponse(r => r.url().endsWith("/api/management/saves/apply"));
      await page.getByRole("button", { name: "Confirm save" }).click();
      const applied = await response;
      assert.equal(applied.status(), 200);
      const result = await applied.json();
      assert.deepEqual(await readFile(result.backupPath), original);
      assert.equal(await readFile(path, "utf8"), (item.bom ? "\ufeff" : "") + updated.replaceAll("\n", "\r\n"));
      assert.equal((await stat(path)).mode & 0o777, 0o750);
      await assert.rejects(lstat(marker), { code: "ENOENT" });
    }
  } finally {
    await browser.close();
    await running.close();
    await rm(fixture, { recursive: true, force: true });
  }
});
