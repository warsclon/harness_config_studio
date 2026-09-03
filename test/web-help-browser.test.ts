import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { startServer } from "../src/server.ts";

test("Web Management help explains workflows and shortcuts without disturbing a Pending Edit", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-web-help-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(home, ".codex", "AGENTS.md"), "# Instructions\n");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 980, height: 700 } });
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();

      const helpButton = page.getByRole("button", { name: "Help and keyboard shortcuts", exact: true });
      assert.equal(await helpButton.getAttribute("aria-keyshortcuts"), "?");
      await helpButton.click();
      const help = page.getByRole("dialog", { name: "Harness Config Studio help", exact: true });
      await help.waitFor();
      const helpBox = await help.boundingBox();
      assert.ok(helpBox);
      assert.ok(helpBox.x >= 0 && helpBox.y >= 0);
      assert.ok(helpBox.x + helpBox.width <= 980 && helpBox.y + helpBox.height <= 700);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 980);
      for (const heading of ["How it works", "Artifact Explorer", "Editing and saving", "Removal and recovery", "Keyboard shortcuts", "Safety boundaries"]) {
        assert.equal(await help.getByRole("heading", { name: heading, exact: true }).count(), 1);
      }
      for (const shortcut of ["?", "Esc", "↑ / ↓", "← / →", "Enter", "Delete", "Cmd/Ctrl+S", "Home / End"]) {
        assert.equal(await help.getByText(shortcut, { exact: true }).count(), 1);
      }
      assert.match(await help.innerText(), /browser-only Pending Edit/);
      assert.match(await help.innerText(), /symbolic-link directories are never traversed/i);
      await help.getByRole("button", { name: "Close help", exact: true }).click();
      assert.equal(await help.count(), 0);
      assert.equal(await helpButton.evaluate((element) => element === document.activeElement), true);

      await page.getByTestId("toggle-sections").click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).click();
      const editor = page.getByRole("textbox", { name: "Artifact content" });
      await editor.fill("# Pending help check\n");
      await page.keyboard.press("?");
      assert.equal(await help.count(), 0);
      assert.equal(await editor.inputValue(), "# Pending help check\n?");

      await helpButton.click();
      await help.waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await help.count(), 0);
      assert.equal(await editor.inputValue(), "# Pending help check\n?");
      assert.equal(await helpButton.evaluate((element) => element === document.activeElement), true);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
