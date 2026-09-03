import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { startServer } from "../src/server.ts";

async function explorerFixture() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "hcs-explorer-navigation-"));
  const home = join(temporaryRoot, "home");
  const workspace = join(temporaryRoot, "workspace");
  await mkdir(join(home, ".codex", "rules"), { recursive: true });
  await mkdir(join(home, ".agents", "skills", "Alpha"), { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(join(home, ".codex", "AGENTS.md"), "# Instructions\n");
  await writeFile(join(home, ".codex", "config.toml"), "model = 'fixture'\n");
  await writeFile(join(home, ".codex", "rules", "default.rules"), "allow\n");
  await writeFile(join(home, ".agents", "skills", "Alpha", "SKILL.md"), "# Alpha\n");
  const canonicalHome = await realpath(home);
  const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(4000);
  await page.goto(running.url);
  await page.locator('#app[data-state="ready"]').waitFor();
  await page.getByTestId("toggle-sections").click();
  return {
    page,
    node: (relative: string) => page.locator(`[data-tree-path="${join(canonicalHome, relative)}"]`),
    async close() {
      await browser.close();
      await running.close();
      await rm(temporaryRoot, { recursive: true, force: true });
    },
  };
}

test("Artifact Explorer starts nested directories collapsed and remembers each root across source changes", async () => {
  const fixture = await explorerFixture();
  const { page, node } = fixture;
  try {
    assert.equal(await node(".codex").getAttribute("aria-expanded"), "true");
    assert.equal(await node(".codex/rules").getAttribute("aria-expanded"), "false");
    await page.getByRole("button", { name: "rules directory", exact: true }).click();
    assert.equal(await node(".codex/rules").getAttribute("aria-expanded"), "true");
    await page.getByRole("button", { name: /\.agents.*Global Root/i }).click();
    assert.equal(await node(".agents/skills").getAttribute("aria-expanded"), "false");
    await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
    assert.equal(await node(".codex/rules").getAttribute("aria-expanded"), "true");
    await page.getByRole("button", { name: ".codex directory", exact: true }).click();
    await page.getByRole("button", { name: /\.agents.*Global Root/i }).click();
    await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
    assert.equal(await node(".codex").getAttribute("aria-expanded"), "false");
    await page.reload();
    await page.locator('#app[data-state="ready"]').waitFor();
    await page.getByTestId("toggle-sections").click();
    assert.equal(await node(".codex").getAttribute("aria-expanded"), "true");
    assert.equal(await node(".codex/rules").getAttribute("aria-expanded"), "false");
  } finally {
    await fixture.close();
  }
});

test("tree row actions appear on hover or selection and keep stable accessible names", async () => {
  const fixture = await explorerFixture();
  const { page, node } = fixture;
  try {
    await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
    const artifact = node(".codex/AGENTS.md");
    const remove = page.getByRole("button", { name: "Move AGENTS.md to Trash", exact: true });
    assert.equal(await remove.evaluate((element) => getComputedStyle(element).opacity), "0");
    await artifact.hover();
    assert.equal(await remove.evaluate((element) => getComputedStyle(element).opacity), "1");
    await artifact.locator(":scope > .artifact-row-main > .artifact-button").focus();
    assert.equal(await artifact.getAttribute("aria-selected"), "true");
    assert.equal(await remove.evaluate((element) => getComputedStyle(element).opacity), "1");
    assert.equal(await page.getByRole("button", { name: "Reveal AGENTS.md in Finder", exact: true }).count(), 1);
  } finally {
    await fixture.close();
  }
});

test("tree keyboard navigation selects without opening, guards Pending Edits, and Delete only reviews removal", async () => {
  const fixture = await explorerFixture();
  const { page, node } = fixture;
  const row = (relative: string) => node(relative).locator(":scope > .artifact-row-main > .artifact-button");
  try {
    await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
    await row(".codex").focus();
    await row(".codex").press("ArrowDown");
    assert.equal(await node(".codex/rules").getAttribute("aria-selected"), "true");
    await row(".codex/rules").press("ArrowRight");
    assert.equal(await node(".codex/rules").getAttribute("aria-expanded"), "true");
    await row(".codex/rules").press("ArrowRight");
    assert.equal(await node(".codex/rules/default.rules").getAttribute("aria-selected"), "true");
    await row(".codex/rules/default.rules").press("ArrowLeft");
    await row(".codex/rules").press("ArrowLeft");
    assert.equal(await node(".codex/rules").getAttribute("aria-expanded"), "false");
    await row(".codex/rules").press("ArrowDown");
    assert.equal(await node(".codex/AGENTS.md").getAttribute("aria-selected"), "true");
    assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).count(), 0);
    await row(".codex/AGENTS.md").press("Enter");
    const editor = page.getByRole("textbox", { name: "Artifact content" });
    await row(".codex/AGENTS.md").press("ArrowDown");
    assert.equal(await node(".codex/config.toml").getAttribute("aria-selected"), "true");
    await editor.fill("# Pending\n");
    await row(".codex/config.toml").press("Enter");
    await page.getByTestId("dirty-cancel").click();
    assert.equal(await node(".codex/config.toml").getAttribute("aria-selected"), "true");
    assert.equal(await editor.inputValue(), "# Pending\n");
    await row(".codex/AGENTS.md").click();
    assert.equal(await node(".codex/AGENTS.md").getAttribute("aria-selected"), "true");
    assert.equal(await editor.inputValue(), "# Pending\n");
    await row(".codex/config.toml").click();
    await page.getByTestId("dirty-cancel").click();
    assert.equal(await node(".codex/AGENTS.md").getAttribute("aria-selected"), "true");
    assert.equal(await editor.inputValue(), "# Pending\n");
    await row(".codex/AGENTS.md").press("Enter");
    assert.equal(await editor.inputValue(), "# Pending\n");
    await page.getByTestId("editor-status").getByText("Unsaved changes", { exact: true }).waitFor();
    await row(".codex/AGENTS.md").press("ArrowUp");
    await page.getByTestId("dirty-cancel").click();
    assert.equal(await node(".codex/AGENTS.md").getAttribute("aria-selected"), "true");
    assert.equal(await editor.inputValue(), "# Pending\n");
    await row(".codex/AGENTS.md").press("ArrowUp");
    await page.getByTestId("dirty-discard").click();
    assert.equal(await node(".codex/rules").getAttribute("aria-selected"), "true");
    await row(".codex/rules").press("ArrowDown");
    await row(".codex/AGENTS.md").press("Delete");
    await page.getByRole("dialog", { name: "Move file to Trash", exact: true }).waitFor();
    await page.getByTestId("cancel-removal").click();
    assert.equal(await node(".codex/AGENTS.md").count(), 1);
    assert.equal(await editor.inputValue(), "# Instructions\n");
  } finally {
    await fixture.close();
  }
});

test("Artifact Explorer toolbar expands only the tree and keeps a visible selection when collapsing", async () => {
  const fixture = await explorerFixture();
  const { page, node } = fixture;
  try {
    await page.getByRole("button", { name: /\.agents.*Global Root/i }).click();
    await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();
    assert.equal(await node(".agents/skills/Alpha").getAttribute("aria-expanded"), "true");
    await page.getByRole("button", { name: /SKILL\.md.*skills/i }).click();
    assert.equal(await node(".agents/skills/Alpha/SKILL.md").getAttribute("aria-selected"), "true");
    await page.getByRole("button", { name: "Collapse all artifact directories", exact: true }).click();
    assert.equal(await node(".agents").getAttribute("aria-expanded"), "false");
    assert.equal(await node(".agents").getAttribute("aria-selected"), "true");
    assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).inputValue(), "# Alpha\n");
    assert.equal(await page.locator('[data-group="global"]').getAttribute("open"), "");
  } finally {
    await fixture.close();
  }
});
