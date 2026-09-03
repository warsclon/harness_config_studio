import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { startServer } from "../src/server.ts";

test("Web Management resizes adjacent columns without losing a Pending Edit or resetting widths on tree changes", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-column-resize-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(home, ".codex", "AGENTS.md"), "# Instructions\n");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      assert.equal(await page.getByRole("separator").count(), 2);
      await page.getByTestId("toggle-sections").click();
      await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).click();
      const editor = page.getByRole("textbox", { name: "Artifact content" });
      await editor.fill("# Keep this Pending Edit\n");
      await editor.press("Shift+Home");
      const selection = await editor.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd]);
      const widths = async () => Promise.all(["management-sources", "management-artifacts", "management-detail"].map(async (id) => {
        const box = await page.getByTestId(id).boundingBox();
        assert.ok(box);
        return Math.round(box.width);
      }));
      const drag = async (name: string, delta: number) => {
        const box = await page.getByRole("separator", { name, exact: true }).boundingBox();
        assert.ok(box);
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + delta, y, { steps: 8 });
        await page.mouse.up();
      };
      const initial = await widths();
      assert.deepEqual(initial.slice(0, 2), [270, 330]);
      await drag("Resize Configuration and Artifacts", 40);
      assert.deepEqual(await widths(), [310, 290, initial[2]]);
      await drag("Resize Artifacts and Editor", 140);
      const resized = await widths();
      assert.deepEqual(resized, [310, 430, initial[2]! - 140]);
      assert.equal(await editor.inputValue(), "# Keep this Pending Edit\n");
      assert.deepEqual(await editor.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd]), selection);
      assert.match(await page.getByTestId("editor-status").innerText(), /Unsaved changes/);
      assert.equal(await page.getByRole("dialog").count(), 0);

      await page.getByRole("button", { name: ".codex directory", exact: true }).click();
      await page.getByTestId("dirty-cancel").click();
      assert.deepEqual(await widths(), resized);
      assert.equal(await editor.inputValue(), "# Keep this Pending Edit\n");
      await drag("Resize Configuration and Artifacts", -2000);
      assert.equal((await widths())[0], 200);
      await drag("Resize Artifacts and Editor", 2000);
      assert.equal((await widths())[2], 320);
      await drag("Resize Configuration and Artifacts", 2000);
      assert.equal((await widths())[1], 260);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("column separators support keyboard resizing and keep the Editor visible when the window shrinks", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-column-keyboard-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  try {
    await mkdir(home, { recursive: true });
    await mkdir(workspace, { recursive: true });
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      const sources = page.getByTestId("management-sources");
      const artifacts = page.getByTestId("management-artifacts");
      const detail = page.getByTestId("management-detail");
      const first = page.getByRole("separator", { name: "Resize Configuration and Artifacts", exact: true });
      const second = page.getByRole("separator", { name: "Resize Artifacts and Editor", exact: true });
      await first.press("ArrowRight");
      assert.equal(Math.round((await sources.boundingBox())!.width), 286);
      assert.equal(await first.getAttribute("aria-valuenow"), "286");
      await first.press("Home");
      assert.equal(Math.round((await sources.boundingBox())!.width), 200);
      await first.press("ArrowLeft");
      assert.equal(Math.round((await sources.boundingBox())!.width), 200);
      await first.press("End");
      assert.equal(Math.round((await artifacts.boundingBox())!.width), 260);
      await second.press("ArrowRight");
      assert.equal(Math.round((await artifacts.boundingBox())!.width), 276);
      await second.press("End");
      assert.equal(Math.round((await detail.boundingBox())!.width), 320);
      await page.setViewportSize({ width: 980, height: 800 });
      await page.waitForFunction(() => document.querySelector('[data-testid="management-detail"]')!.getBoundingClientRect().right <= window.innerWidth, undefined, { timeout: 2000 });
      assert.ok((await sources.boundingBox())!.width >= 200);
      assert.ok((await artifacts.boundingBox())!.width >= 260);
      assert.ok((await detail.boundingBox())!.width >= 320);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
