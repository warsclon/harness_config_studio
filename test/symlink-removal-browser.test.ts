import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, realpath, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import test from "node:test";
import { chromium, request as playwrightRequest } from "playwright";
import { startServer } from "../src/server.ts";
import { TrashGatewayError } from "../src/system-gateway.ts";

test("an in-boundary symbolic link is reviewed and moved without touching its target", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-trash-symlink-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const globalRoot = join(home, ".codex");
  const trash = join(fixtureRoot, "Trash");
  const targetPath = join(globalRoot, "shared target.md");
  const linkPath = join(globalRoot, "AGENTS.md");
  const backupSentinel = join(home, "harness_config_studio", "backups", "sentinel.bak");
  const targetBytes = Buffer.from("# TARGET_SECRET\n", "utf8");
  const intents: Array<{ path: string; targetKind: string }> = [];
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(intent: { path: string; targetKind: string }): Promise<Record<string, never>> {
      intents.push(structuredClone(intent));
      await rename(intent.path, join(trash, basename(intent.path)));
      return {};
    },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(globalRoot, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(trash, { recursive: true });
    await mkdir(join(home, "harness_config_studio", "backups"), { recursive: true, mode: 0o700 });
    await writeFile(targetPath, targetBytes, { mode: 0o440 });
    await symlink("shared target.md", linkPath);
    await writeFile(backupSentinel, "BACKUP_SENTINEL", { mode: 0o600 });
    const artifactIdentity = join(await realpath(home), ".codex", "AGENTS.md");
    const resolvedPath = await realpath(targetPath);
    const beforeTarget = await stat(targetPath, { bigint: true });
    const beforeLink = await lstat(linkPath, { bigint: true });
    const rawLinkTarget = await readlink(linkPath);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();

      const row = page.getByRole("button", { name: /AGENTS\.md.*instructions/i });
      assert.equal(await row.getByTestId("symlink-icon").count(), 1);
      assert.equal(await page.getByRole("button", { name: "Reveal AGENTS.md in Finder" }).isEnabled(), true);
      const removeButton = page.getByRole("button", { name: "Move AGENTS.md to Trash" });
      assert.equal(await removeButton.count(), 1);
      assert.equal(await removeButton.isEnabled(), true);
      await row.click();
      await page.getByRole("textbox", { name: "Artifact content" }).waitFor();

      await removeButton.click();
      const dialog = page.getByRole("dialog", { name: "Move symbolic link to Trash" });
      await dialog.waitFor();
      const previewText = await dialog.innerText();
      assert.match(previewText, new RegExp(artifactIdentity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(previewText, new RegExp(resolvedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(previewText, /Inside Management Boundary/);
      assert.match(previewText, /1 symbolic link/);
      assert.match(previewText, /Only this symbolic link will be moved to macOS Trash\. Its target will not be moved, copied, modified, or backed up\./);

      await dialog.getByRole("button", { name: "Move symbolic link to Trash" }).click();
      await page.getByText("Symbolic link moved to Trash; target unchanged", { exact: true }).waitFor();
      assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).count(), 0);

      assert.deepEqual(intents, [{ path: artifactIdentity, targetKind: "symbolic-link" }]);
      await assert.rejects(lstat(linkPath));
      const trashedLink = await lstat(join(trash, "AGENTS.md"), { bigint: true });
      assert.equal(trashedLink.isSymbolicLink(), true);
      assert.equal(trashedLink.ino, beforeLink.ino);
      assert.equal(await readlink(join(trash, "AGENTS.md")), rawLinkTarget);
      const afterTarget = await stat(targetPath, { bigint: true });
      assert.equal(afterTarget.ino, beforeTarget.ino);
      assert.equal(afterTarget.mode, beforeTarget.mode);
      assert.deepEqual(await readFile(targetPath), targetBytes);
      assert.equal(await readFile(backupSentinel, "utf8"), "BACKUP_SENTINEL");
      assert.deepEqual(await readdir(join(home, "harness_config_studio", "backups")), ["sentinel.bak"]);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("an out-of-boundary target stays opaque while its visible symbolic link remains removable", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-trash-outside-link-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const globalRoot = join(home, ".codex");
  const trash = join(fixtureRoot, "Trash");
  const targetPath = join(fixtureRoot, "OUTSIDE_SECRET.toml");
  const linkPath = join(globalRoot, "config.toml");
  const targetBytes = Buffer.from("outside_secret = true\n", "utf8");
  const intents: Array<{ path: string; targetKind: string }> = [];
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(intent: { path: string; targetKind: string }): Promise<Record<string, never>> {
      intents.push(structuredClone(intent));
      await rename(intent.path, join(trash, basename(intent.path)));
      return {};
    },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(globalRoot, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(trash, { recursive: true });
    await writeFile(targetPath, targetBytes, { mode: 0o000 });
    await symlink(targetPath, linkPath);
    const artifactIdentity = join(await realpath(home), ".codex", "config.toml");
    const beforeTarget = await stat(targetPath, { bigint: true });
    const rawLinkTarget = await readlink(linkPath);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      const previewResponse = page.waitForResponse((response) => response.url().endsWith("/api/management/removals/preview"));
      await page.getByRole("button", { name: "Move config.toml to Trash" }).click();
      const preview = await previewResponse;
      assert.equal(preview.status(), 200);
      assert.doesNotMatch(await preview.text(), /outside_secret/);

      const dialog = page.getByRole("dialog", { name: "Move symbolic link to Trash" });
      const text = await dialog.innerText();
      assert.match(text, /Outside Management Boundary/);
      assert.match(text, new RegExp(targetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      await dialog.getByRole("button", { name: "Move symbolic link to Trash" }).click();
      await page.getByText("Symbolic link moved to Trash; target unchanged", { exact: true }).waitFor();

      assert.deepEqual(intents, [{ path: artifactIdentity, targetKind: "symbolic-link" }]);
      assert.equal((await lstat(join(trash, "config.toml"))).isSymbolicLink(), true);
      assert.equal(await readlink(join(trash, "config.toml")), rawLinkTarget);
      const afterTarget = await stat(targetPath, { bigint: true });
      assert.equal(afterTarget.ino, beforeTarget.ino);
      assert.equal(afterTarget.mode, beforeTarget.mode);
      await chmod(targetPath, 0o400);
      assert.deepEqual(await readFile(targetPath), targetBytes);
      assert.equal((await lstat(join(home, "harness_config_studio", "activity.json"))).isFile(), true);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("a broken symbolic link is reviewed as one link and moved without inventing a target", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-trash-broken-link-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const globalRoot = join(home, ".codex");
  const trash = join(fixtureRoot, "Trash");
  const linkPath = join(globalRoot, "config.toml");
  const rawLinkTarget = "../missing target 🧪\n--quoted.toml";
  const intents: Array<{ path: string; targetKind: string }> = [];
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(intent: { path: string; targetKind: string }): Promise<Record<string, never>> {
      intents.push(structuredClone(intent));
      await rename(intent.path, join(trash, basename(intent.path)));
      return {};
    },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(globalRoot, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(trash, { recursive: true });
    await symlink(rawLinkTarget, linkPath);
    const artifactIdentity = join(await realpath(home), ".codex", "config.toml");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      const row = page.getByRole("button", { name: /config\.toml.*settings/i });
      assert.equal(await row.getByTestId("symlink-icon").getAttribute("aria-label"), "Broken symbolic link");
      assert.equal(await page.getByRole("button", { name: "Reveal config.toml in Finder" }).isEnabled(), true);

      const previewResponse = page.waitForResponse((response) => response.url().endsWith("/api/management/removals/preview"));
      await page.getByRole("button", { name: "Move config.toml to Trash" }).click();
      const preview = await previewResponse;
      assert.equal(preview.status(), 200);
      const payload = await preview.json() as { summary: Record<string, number>; resolvedPath: null; targetBoundary: string };
      assert.deepEqual(payload.summary, {
        entries: 1,
        files: 0,
        directories: 0,
        symbolicLinks: 1,
        totalBytes: Buffer.byteLength(rawLinkTarget),
      });
      assert.equal(payload.resolvedPath, null);
      assert.equal(payload.targetBoundary, "unknown");
      const dialog = page.getByRole("dialog", { name: "Move symbolic link to Trash" });
      const text = await dialog.innerText();
      assert.match(text, /Broken target — no target will be accessed/);
      assert.match(text, /Resolved Path\s+Not available/i);
      assert.match(text, /1 symbolic link/);
      assert.doesNotMatch(text, /missing target|quoted\.toml/);

      await dialog.getByRole("button", { name: "Move symbolic link to Trash" }).click();
      await page.getByText("Symbolic link moved to Trash; target unchanged", { exact: true }).waitFor();
      assert.deepEqual(intents, [{ path: artifactIdentity, targetKind: "symbolic-link" }]);
      assert.equal((await lstat(join(trash, "config.toml"))).isSymbolicLink(), true);
      assert.equal(await readlink(join(trash, "config.toml")), rawLinkTarget);
      await assert.rejects(lstat(linkPath));
      assert.equal((await lstat(join(home, "harness_config_studio", "activity.json"))).isFile(), true);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("retargeted and replaced links reject their one-shot review without reaching Trash", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-trash-changed-link-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const globalRoot = join(home, ".codex");
  const linkPath = join(globalRoot, "AGENTS.md");
  const targetPath = join(globalRoot, "target.md");
  const targetSecret = "TARGET_CONTENT_MUST_NOT_LEAK\n";
  let trashCalls = 0;
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(): Promise<Record<string, never>> { trashCalls += 1; return {}; },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(globalRoot, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(targetPath, targetSecret);
    await symlink("target.md", linkPath);
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
      const firstPreview = await (await api.post(`${running.url}/api/management/removals/preview`, {
        data: { artifactIdentity },
      })).json() as { removalReviewId: string };
      await rm(linkPath);
      await symlink("./target.md", linkPath);
      const retargeted = await api.post(`${running.url}/api/management/removals/apply`, {
        data: { removalReviewId: firstPreview.removalReviewId },
      });
      const retargetedBody = await retargeted.text();
      assert.equal(retargeted.status(), 409);
      assert.equal(JSON.parse(retargetedBody).error.code, "removal-changed");
      assert.doesNotMatch(retargetedBody, /TARGET_CONTENT_MUST_NOT_LEAK|\.\/target\.md/);
      assert.equal(await readlink(linkPath), "./target.md");
      assert.equal(trashCalls, 0);

      const replay = await api.post(`${running.url}/api/management/removals/apply`, {
        data: { removalReviewId: firstPreview.removalReviewId },
      });
      assert.equal(replay.status(), 409);
      assert.equal((await replay.json()).error.code, "removal-review-invalid");

      const secondPreview = await (await api.post(`${running.url}/api/management/removals/preview`, {
        data: { artifactIdentity },
      })).json() as { removalReviewId: string };
      await rm(linkPath);
      await writeFile(linkPath, "replacement regular file\n");
      const replaced = await api.post(`${running.url}/api/management/removals/apply`, {
        data: { removalReviewId: secondPreview.removalReviewId },
      });
      const replacedBody = await replaced.text();
      assert.equal(replaced.status(), 409);
      assert.equal(JSON.parse(replacedBody).error.code, "removal-changed");
      assert.doesNotMatch(replacedBody, /TARGET_CONTENT_MUST_NOT_LEAK|replacement regular file/);
      assert.equal((await lstat(linkPath)).isFile(), true);
      assert.equal(await readFile(targetPath, "utf8"), targetSecret);
      assert.equal(trashCalls, 0);
      assert.equal((await lstat(join(home, "harness_config_studio", "activity.json"))).isFile(), true);
    } finally {
      await api.dispose();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("target-only changes do not invalidate a symbolic-link removal review", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-trash-target-change-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const globalRoot = join(home, ".codex");
  const trash = join(fixtureRoot, "Trash");
  const linkPath = join(globalRoot, "AGENTS.md");
  const targetPath = join(globalRoot, "target.md");
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(intent: { path: string }): Promise<Record<string, never>> {
      await rename(intent.path, join(trash, basename(intent.path)));
      return {};
    },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(globalRoot, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(trash, { recursive: true });
    await writeFile(targetPath, "first target state\n", { mode: 0o640 });
    await symlink("target.md", linkPath);
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
      const preview = await (await api.post(`${running.url}/api/management/removals/preview`, {
        data: { artifactIdentity },
      })).json() as { removalReviewId: string };
      await writeFile(targetPath, "newest external target state\n", { mode: 0o600 });
      await chmod(targetPath, 0o600);
      const applied = await api.post(`${running.url}/api/management/removals/apply`, {
        data: { removalReviewId: preview.removalReviewId },
      });
      assert.equal(applied.status(), 200);
      assert.equal((await applied.json()).targetKind, "symbolic-link");
      assert.equal((await lstat(join(trash, "AGENTS.md"))).isSymbolicLink(), true);
      assert.equal(await readFile(targetPath, "utf8"), "newest external target state\n");
      assert.equal((await stat(targetPath)).mode & 0o7777, 0o600);
      assert.equal((await lstat(join(home, "harness_config_studio", "activity.json"))).isFile(), true);
    } finally {
      await api.dispose();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("a Pending Edit blocks only its own link identity and not another alias of the same target", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-trash-dirty-alias-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const projectRoot = join(workspace, "project");
  const firstDirectory = join(projectRoot, ".agents", "skills", "first");
  const secondDirectory = join(projectRoot, ".agents", "skills", "second");
  const firstLink = join(firstDirectory, "first.txt");
  const secondLink = join(secondDirectory, "second.txt");
  const targetPath = join(projectRoot, "shared.txt");
  const trash = join(fixtureRoot, "Trash");
  const targetBytes = "shared target remains\n";
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(intent: { path: string }): Promise<Record<string, never>> {
      await rename(intent.path, join(trash, basename(intent.path)));
      return {};
    },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(firstDirectory, { recursive: true });
    await mkdir(secondDirectory, { recursive: true });
    await mkdir(trash, { recursive: true });
    await writeFile(targetPath, targetBytes);
    await symlink(relative(firstDirectory, targetPath), firstLink);
    await symlink(relative(secondDirectory, targetPath), secondLink);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Project configuration" }).click();
      await page.getByRole("button", { name: /project.*Project Root/i }).click();
      await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();
      await page.getByRole("button", { name: /first\.txt.*skills/i }).click();
      const editor = page.getByRole("textbox", { name: "Artifact content" });
      await editor.fill("pending edit for first alias\n");

      assert.equal(await page.getByRole("button", { name: "Move first.txt to Trash" }).isDisabled(), true);
      const removeSecond = page.getByRole("button", { name: "Move second.txt to Trash" });
      assert.equal(await removeSecond.isEnabled(), true);
      await removeSecond.click();
      const dialog = page.getByRole("dialog", { name: "Move symbolic link to Trash" });
      await dialog.getByRole("button", { name: "Move symbolic link to Trash" }).click();
      await page.getByText("Symbolic link moved to Trash; target unchanged", { exact: true }).waitFor();

      assert.equal(await editor.inputValue(), "pending edit for first alias\n");
      assert.equal((await lstat(firstLink)).isSymbolicLink(), true);
      await assert.rejects(lstat(secondLink));
      assert.equal((await lstat(join(trash, "second.txt"))).isSymbolicLink(), true);
      assert.equal(await readFile(targetPath, "utf8"), targetBytes);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("a Trash gateway failure leaves the link target and existing backups unchanged", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-trash-link-failure-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const globalRoot = join(home, ".codex");
  const linkPath = join(globalRoot, "AGENTS.md");
  const targetPath = join(globalRoot, "target.md");
  const backupSentinel = join(home, "harness_config_studio", "backups", "sentinel.bak");
  const intents: Array<{ path: string; targetKind: string }> = [];
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(intent: { path: string; targetKind: string }): Promise<never> {
      intents.push(structuredClone(intent));
      throw new TrashGatewayError("trash-permission-denied", "macOS denied permission to move this link to Trash.", {
        osCode: "TEST_DENIED",
      });
    },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(globalRoot, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(join(home, "harness_config_studio", "backups"), { recursive: true, mode: 0o700 });
    await writeFile(targetPath, "target remains exact\n", { mode: 0o400 });
    await symlink("target.md", linkPath);
    await writeFile(backupSentinel, "BACKUP_SENTINEL", { mode: 0o600 });
    const artifactIdentity = join(await realpath(home), ".codex", "AGENTS.md");
    const rawLinkTarget = await readlink(linkPath);
    const beforeLink = await lstat(linkPath, { bigint: true });
    const beforeTarget = await stat(targetPath, { bigint: true });
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: "Move AGENTS.md to Trash" }).click();
      const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/management/removals/apply"));
      await page.getByRole("dialog", { name: "Move symbolic link to Trash" })
        .getByRole("button", { name: "Move symbolic link to Trash" }).click();
      const response = await responsePromise;
      const body = await response.text();
      assert.equal(response.status(), 403);
      assert.equal(JSON.parse(body).error.code, "trash-permission-denied");
      assert.deepEqual(JSON.parse(body).error.technicalDetails, { osCode: "TEST_DENIED" });
      assert.doesNotMatch(body, /target remains exact|BACKUP_SENTINEL/);

      assert.deepEqual(intents, [{ path: artifactIdentity, targetKind: "symbolic-link" }]);
      const afterLink = await lstat(linkPath, { bigint: true });
      const afterTarget = await stat(targetPath, { bigint: true });
      assert.equal(afterLink.ino, beforeLink.ino);
      assert.equal(await readlink(linkPath), rawLinkTarget);
      assert.equal(afterTarget.ino, beforeTarget.ino);
      assert.equal(afterTarget.mode, beforeTarget.mode);
      assert.equal(await readFile(targetPath, "utf8"), "target remains exact\n");
      assert.equal(await readFile(backupSentinel, "utf8"), "BACKUP_SENTINEL");
      assert.deepEqual(await readdir(join(home, "harness_config_studio", "backups")), ["sentinel.bak"]);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("link removal serializes with Save on the same Artifact Identity", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-trash-link-save-lock-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const globalRoot = join(home, ".codex");
  const linkPath = join(globalRoot, "AGENTS.md");
  const targetPath = join(globalRoot, "target.md");
  const trash = join(fixtureRoot, "Trash");
  let enterTrash!: () => void;
  const trashEntered = new Promise<void>((resolve) => { enterTrash = resolve; });
  let releaseTrash!: () => void;
  const trashReleased = new Promise<void>((resolve) => { releaseTrash = resolve; });
  let trashCalls = 0;
  const intents: Array<{ path: string; targetKind: string }> = [];
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(intent: { path: string; targetKind: string }): Promise<Record<string, never>> {
      trashCalls += 1;
      intents.push(structuredClone(intent));
      enterTrash();
      await trashReleased;
      await rename(intent.path, join(trash, basename(intent.path)));
      return {};
    },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(globalRoot, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(trash, { recursive: true });
    await writeFile(targetPath, "# Original target\n", { mode: 0o640 });
    await symlink("target.md", linkPath);
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
        data: { editHandle: opened.editHandle, editRevision: opened.editRevision, content: "# Save must lose\n" },
      })).json() as { reviewId: string };
      const removalReview = await (await api.post(`${running.url}/api/management/removals/preview`, {
        data: { artifactIdentity },
      })).json() as { removalReviewId: string };

      const removalPromise = api.post(`${running.url}/api/management/removals/apply`, {
        data: { removalReviewId: removalReview.removalReviewId },
      });
      await trashEntered;
      const savePromise = api.post(`${running.url}/api/management/saves/apply`, {
        data: { reviewId: saveReview.reviewId },
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      releaseTrash();

      const [removal, save] = await Promise.all([removalPromise, savePromise]);
      assert.equal(removal.status(), 200);
      assert.equal(save.status(), 409);
      assert.equal((await save.json()).error.code, "artifact-changed");
      assert.equal(trashCalls, 1);
      assert.deepEqual(intents, [{ path: artifactIdentity, targetKind: "symbolic-link" }]);
      assert.equal((await lstat(join(trash, "AGENTS.md"))).isSymbolicLink(), true);
      assert.equal(await readFile(targetPath, "utf8"), "# Original target\n");
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

test("a recognized skills root stays protected even when its directory entry is a symbolic link", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-trash-protected-link-root-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const globalRoot = join(home, ".agents");
  const skillsRoot = join(globalRoot, "skills");
  const targetDirectory = join(fixtureRoot, "shared-skills");
  let trashCalls = 0;
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(): Promise<Record<string, never>> { trashCalls += 1; return {}; },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(globalRoot, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(targetDirectory, { recursive: true });
    await symlink(targetDirectory, skillsRoot);
    const artifactIdentity = join(await realpath(home), ".agents", "skills");
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
      const response = await api.post(`${running.url}/api/management/removals/preview`, {
        data: { artifactIdentity },
      });
      assert.equal(response.status(), 422);
      assert.equal((await response.json()).error.code, "removal-not-eligible");
      assert.equal(trashCalls, 0);
      assert.equal((await lstat(skillsRoot)).isSymbolicLink(), true);
      assert.equal((await lstat(targetDirectory)).isDirectory(), true);
    } finally {
      await api.dispose();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
