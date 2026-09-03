import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { chromium, request as playwrightRequest } from "playwright";
import { startServer } from "../src/server.ts";
import { TrashGatewayError } from "../src/system-gateway.ts";

test("a clean inventoried file is confirmed by exact path and moved through the Trash gateway", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-trash-file-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const trash = join(fixtureRoot, "Trash");
  const artifactPath = join(home, ".codex", "AGENTS.md");
  const backupPath = join(home, "harness_config_studio", "backups", "sentinel.bak");
  const intents: Array<{ path: string; targetKind: string }> = [];
  let openTrashCalls = 0;
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(intent: { path: string; targetKind: string }): Promise<void> {
      intents.push(structuredClone(intent));
      await rename(intent.path, join(trash, basename(intent.path)));
    },
    async openTrash(): Promise<void> {
      openTrashCalls += 1;
    },
  };

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(trash, { recursive: true });
    await mkdir(join(home, "harness_config_studio", "backups"), { recursive: true, mode: 0o700 });
    await writeFile(artifactPath, "# Fixture instructions\n", { mode: 0o400 });
    await writeFile(backupPath, "BACKUP_SENTINEL");
    const artifactIdentity = join(await realpath(home), ".codex", "AGENTS.md");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      assert.equal(await page.getByRole("button", { name: ".codex directory", exact: true }).getAttribute("aria-expanded"), "true");
      await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).click();
      await page.getByRole("textbox", { name: "Artifact content" }).waitFor();

      await page.getByRole("button", { name: "Move AGENTS.md to Trash" }).click();
      const dialog = page.getByRole("dialog", { name: "Move file to Trash" });
      await dialog.waitFor();
      assert.match(await dialog.innerText(), new RegExp(artifactIdentity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(await dialog.innerText(), /This file will be moved to macOS Trash/);

      await dialog.getByRole("button", { name: "Move this file to Trash" }).click();
      await page.getByText("Moved to Trash", { exact: true }).waitFor();
      assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).count(), 0);
      assert.equal(await page.locator(`[data-tree-path="${artifactIdentity}"]`).count(), 0);
      assert.equal(await page.locator(`[data-tree-path="${join(await realpath(home), ".codex")}"]`).getAttribute("aria-selected"), "true");
      assert.equal(await page.getByRole("button", { name: ".codex directory", exact: true }).getAttribute("aria-expanded"), "false");
      await assert.rejects(lstat(artifactIdentity));
      assert.equal(await readFile(join(trash, "AGENTS.md"), "utf8"), "# Fixture instructions\n");
      assert.equal((await stat(join(trash, "AGENTS.md"))).mode & 0o7777, 0o400);
      assert.equal(await readFile(backupPath, "utf8"), "BACKUP_SENTINEL");
      assert.deepEqual(intents, [{ path: artifactIdentity, targetKind: "file" }]);

      await page.getByRole("button", { name: "Open Trash" }).click();
      assert.equal(openTrashCalls, 1);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("a Pending Edit blocks removal and SKILL.md preview explains the affected skill memberships", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-trash-skill-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const skillDirectory = join(home, ".agents", "skills", "test-skill");
  const skillPath = join(skillDirectory, "SKILL.md");
  let trashCalls = 0;
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(): Promise<Record<string, never>> { trashCalls += 1; return {}; },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(skillDirectory, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(skillPath, "# Test skill\n");
    const canonicalSkillDirectory = await realpath(skillDirectory);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.agents.*Global Root/i }).click();
      await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();
      await page.getByRole("button", { name: /SKILL\.md.*skills/i }).click();
      const editor = page.getByRole("textbox", { name: "Artifact content" });
      await editor.fill("# Unsaved skill change\n");

      const remove = page.getByRole("button", { name: "Move SKILL.md to Trash" });
      assert.equal(await remove.isDisabled(), true);
      assert.match(await remove.getAttribute("title") ?? "", /Discard or save/);
      assert.equal(await page.getByRole("dialog", { name: "Move file to Trash" }).count(), 0);
      assert.equal(trashCalls, 0);

      await editor.fill("# Test skill\n");
      assert.equal(await remove.isEnabled(), true);
      await remove.click();
      const dialog = page.getByRole("dialog", { name: "Move file to Trash" });
      await dialog.waitFor();
      const text = await dialog.innerText();
      assert.match(text, /This may disable the skill/);
      assert.match(text, new RegExp(canonicalSkillDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(text, /Codex/);
      assert.match(text, /OpenCode/);
      assert.match(text, /Pi/);
      assert.equal(trashCalls, 0);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("Removal confirmation rechecks Pending Edit and isolates the modal from the editor", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-trash-dirty-race-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const artifactPath = join(home, ".codex", "AGENTS.md");
  let trashCalls = 0;
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(): Promise<Record<string, never>> { trashCalls += 1; return {}; },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(artifactPath, "# Original\n");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).click();
      await page.getByRole("textbox", { name: "Artifact content" }).waitFor();

      await page.getByRole("button", { name: "Move AGENTS.md to Trash" }).click();
      const removalDialog = page.getByRole("dialog", { name: "Move file to Trash" });
      await removalDialog.waitFor();
      assert.equal(await page.locator(".columns").getAttribute("inert"), "");
      assert.equal(await page.locator("header").getAttribute("inert"), "");
      assert.equal(
        await removalDialog.getByRole("button", { name: "Cancel" }).evaluate((element) => element === document.activeElement),
        true,
      );
      await page.locator("#artifact-content").focus();
      assert.equal(
        await page.locator("#artifact-content").evaluate((element) => element === document.activeElement),
        false,
      );

      await page.locator("#artifact-content").evaluate((element) => {
        const editor = element as HTMLTextAreaElement;
        editor.value = "# Pending edit created after preview\n";
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await removalDialog.getByRole("button", { name: "Move this file to Trash" }).click();

      const dirtyDialog = page.getByRole("dialog", { name: "Unsaved changes" });
      await dirtyDialog.waitFor();
      assert.match(await dirtyDialog.innerText(), /browser-only Pending Edit/);
      assert.equal(trashCalls, 0);
      assert.equal(await readFile(artifactPath, "utf8"), "# Original\n");
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("Removal Preview is one-shot, rejects changed files, and reports content-free Trash failure", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-trash-safety-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const artifactPath = join(home, ".codex", "AGENTS.md");
  let trashCalls = 0;
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(): Promise<never> {
      trashCalls += 1;
      throw new TrashGatewayError(
        "trash-failed",
        "macOS could not move this file to Trash.",
        { osCode: "TEST_FAILURE", stderr: "SECRET_GATEWAY_OUTPUT" } as unknown as { osCode: string },
      );
    },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(artifactPath, "SECRET_ORIGINAL_CONTENT");
    const artifactIdentity = join(await realpath(home), ".codex", "AGENTS.md");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const shell = await (await fetch(running.url)).text();
    const capability = shell.match(/name="hcs-session-capability" content="([^"]+)"/)?.[1];
    assert.ok(capability);
    const api = await playwrightRequest.newContext({
      extraHTTPHeaders: {
        Host: new URL(running.url).host,
        Origin: running.url,
        "x-harness-config-capability": capability,
      },
    });
    const unauthenticated = await playwrightRequest.newContext({
      extraHTTPHeaders: { Host: new URL(running.url).host, Origin: running.url },
    });

    try {
      const blocked = await unauthenticated.post(`${running.url}/api/management/removals/preview`, {
        data: { artifactIdentity },
      });
      const blockedBody = await blocked.text();
      assert.equal(blocked.status(), 401);
      assert.equal(JSON.parse(blockedBody).error.code, "capability-required");
      assert.equal(JSON.parse(blockedBody).error.action, "recoverable-removal");
      assert.doesNotMatch(blockedBody, /SECRET_ORIGINAL_CONTENT/);

      const previewResponse = await api.post(`${running.url}/api/management/removals/preview`, {
        data: { artifactIdentity },
      });
      const previewBody = await previewResponse.text();
      assert.equal(previewResponse.status(), 200);
      assert.doesNotMatch(previewBody, /SECRET_ORIGINAL_CONTENT/);
      const preview = JSON.parse(previewBody) as { removalReviewId: string };
      await writeFile(artifactPath, "CHANGED_AFTER_PREVIEW");

      const changed = await api.post(`${running.url}/api/management/removals/apply`, {
        data: { removalReviewId: preview.removalReviewId },
      });
      assert.equal(changed.status(), 409);
      assert.equal((await changed.json()).error.code, "removal-changed");
      assert.equal(trashCalls, 0);

      const consumed = await api.post(`${running.url}/api/management/removals/apply`, {
        data: { removalReviewId: preview.removalReviewId },
      });
      assert.equal(consumed.status(), 409);
      assert.equal((await consumed.json()).error.code, "removal-review-invalid");

      const retryPreview = await api.post(`${running.url}/api/management/removals/preview`, {
        data: { artifactIdentity },
      });
      const retry = await retryPreview.json() as { removalReviewId: string };
      const failed = await api.post(`${running.url}/api/management/removals/apply`, {
        data: { removalReviewId: retry.removalReviewId },
      });
      const failedBody = await failed.text();
      assert.equal(failed.status(), 502);
      assert.equal(JSON.parse(failedBody).error.code, "trash-failed");
      assert.deepEqual(JSON.parse(failedBody).error.technicalDetails, { osCode: "TEST_FAILURE" });
      assert.doesNotMatch(failedBody, /SECRET_GATEWAY_OUTPUT|CHANGED_AFTER_PREVIEW/);
      assert.equal(await readFile(artifactPath, "utf8"), "CHANGED_AFTER_PREVIEW");
      assert.equal(trashCalls, 1);
    } finally {
      await unauthenticated.dispose();
      await api.dispose();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("Removal consumes its review once and shares the Artifact Identity lock with Save", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-trash-lock-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const trash = join(fixtureRoot, "Trash");
  const artifactPath = join(home, ".codex", "AGENTS.md");
  let enterTrash!: () => void;
  const trashEntered = new Promise<void>((resolve) => { enterTrash = resolve; });
  let releaseTrash!: () => void;
  const trashRelease = new Promise<void>((resolve) => { releaseTrash = resolve; });
  let trashCalls = 0;
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(intent: { path: string }): Promise<Record<string, never>> {
      trashCalls += 1;
      enterTrash();
      await trashRelease;
      await rename(intent.path, join(trash, basename(intent.path)));
      return {};
    },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(trash, { recursive: true });
    await writeFile(artifactPath, "# Original\n");
    const artifactIdentity = join(await realpath(home), ".codex", "AGENTS.md");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const shell = await (await fetch(running.url)).text();
    const capability = shell.match(/name="hcs-session-capability" content="([^"]+)"/)?.[1];
    assert.ok(capability);
    const api = await playwrightRequest.newContext({
      extraHTTPHeaders: {
        Host: new URL(running.url).host,
        Origin: running.url,
        "x-harness-config-capability": capability,
      },
    });

    try {
      const opened = await (await api.post(`${running.url}/api/management/artifacts/open`, {
        data: { artifactIdentity },
      })).json() as { editHandle: string; editRevision: string };
      const saveReview = await (await api.post(`${running.url}/api/management/saves/review`, {
        data: { editHandle: opened.editHandle, editRevision: opened.editRevision, content: "# Saved instead\n" },
      })).json() as { reviewId: string };
      const removalReview = await (await api.post(`${running.url}/api/management/removals/preview`, {
        data: { artifactIdentity },
      })).json() as { removalReviewId: string };

      const removalPromise = api.post(`${running.url}/api/management/removals/apply`, {
        data: { removalReviewId: removalReview.removalReviewId },
      });
      await trashEntered;

      const duplicate = await api.post(`${running.url}/api/management/removals/apply`, {
        data: { removalReviewId: removalReview.removalReviewId },
      });
      assert.equal(duplicate.status(), 409);
      assert.equal((await duplicate.json()).error.code, "removal-review-invalid");

      const savePromise = api.post(`${running.url}/api/management/saves/apply`, {
        data: { reviewId: saveReview.reviewId },
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      releaseTrash();

      const removal = await removalPromise;
      const save = await savePromise;
      assert.equal(removal.status(), 200);
      assert.equal(save.status(), 409);
      assert.equal((await save.json()).error.code, "artifact-changed");
      assert.equal(trashCalls, 1);
      assert.equal(await readFile(join(trash, "AGENTS.md"), "utf8"), "# Original\n");
      assert.equal((await lstat(join(home, "harness_config_studio", "activity.json"))).isFile(), true);
    } finally {
      releaseTrash();
      await api.dispose();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("Open Trash failure preserves the successful removal outcome in the browser", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-trash-open-failure-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const trash = join(fixtureRoot, "Trash");
  const artifactPath = join(home, ".codex", "AGENTS.md");
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(intent: { path: string }): Promise<Record<string, never>> {
      await rename(intent.path, join(trash, basename(intent.path)));
      return {};
    },
    async openTrash(): Promise<never> {
      throw new TrashGatewayError("trash-unavailable", "macOS Trash could not be opened.", { osCode: "TEST_OPEN" });
    },
  };

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(trash, { recursive: true });
    await writeFile(artifactPath, "# Fixture\n");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: "Move AGENTS.md to Trash" }).click();
      await page.getByRole("button", { name: "Move this file to Trash" }).click();
      await page.getByText("Moved to Trash", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Open Trash" }).click();
      await page.getByText(/Moved to Trash · trash-unavailable/).waitFor();
      assert.equal(await readFile(join(trash, "AGENTS.md"), "utf8"), "# Fixture\n");
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
