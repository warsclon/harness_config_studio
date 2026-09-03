import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium, type Page } from "playwright";
import { startServer } from "../src/server.ts";

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function openGlobalMarkdown(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`${name.replace(".", "\\.")}.*instructions`, "i") }).click();
  await page.getByRole("textbox", { name: "Artifact content" }).waitFor();
}

async function saveCurrentMarkdown(page: Page, content: string): Promise<Record<string, unknown>> {
  await page.getByRole("textbox", { name: "Artifact content" }).fill(content);
  await page.getByRole("button", { name: "Review save" }).click();
  const review = page.getByRole("dialog", { name: "Save Review" });
  await review.waitFor();
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
  await review.getByRole("button", { name: "Confirm save" }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 200);
  return response.json() as Promise<Record<string, unknown>>;
}

test("eleven accepted saves retain the newest ten Artifact Backups for only that Artifact Identity", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-backup-retention-"));
  const home = join(fixtureRoot, "home with ünicode.dots");
  const workspace = join(fixtureRoot, "workspace");
  const agentsPath = join(home, ".codex", "AGENTS.md");
  const otherPath = join(home, ".codex", "AGENTS.override.md");
  const states = Array.from({ length: 12 }, (_, index) => `# Version ${index}\n`);

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(agentsPath, states[0]!, { mode: 0o640 });
    await writeFile(otherPath, "# Other original\n", { mode: 0o600 });
    const canonicalHome = await realpath(home);
    const artifactIdentity = join(canonicalHome, ".codex", "AGENTS.md");
    const otherIdentity = join(canonicalHome, ".codex", "AGENTS.override.md");
    const backupRoot = join(canonicalHome, "harness_config_studio", "backups");
    const identityRoot = join(backupRoot, sha256(artifactIdentity));
    const otherIdentityRoot = join(backupRoot, sha256(otherIdentity));
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();

      await openGlobalMarkdown(page, "AGENTS.override.md");
      await saveCurrentMarkdown(page, "# Other saved\n");
      await openGlobalMarkdown(page, "AGENTS.md");
      await saveCurrentMarkdown(page, states[1]!);
      await writeFile(join(identityRoot, "user-note.txt"), "MUST_NOT_BE_PRUNED");
      for (let index = 2; index < states.length; index += 1) {
        await saveCurrentMarkdown(page, states[index]!);
      }

      const backups = (await readdir(identityRoot)).filter((name) => name.endsWith(".bak")).sort();
      assert.equal(backups.length, 10);
      assert.equal(backups.includes(`${sha256(states[0]!)}.bak`), false);
      for (let index = 1; index <= 10; index += 1) {
        const backupPath = join(identityRoot, `${sha256(states[index]!)}.bak`);
        assert.deepEqual(await readFile(backupPath), Buffer.from(states[index]!));
      }
      assert.equal(await readFile(join(identityRoot, "user-note.txt"), "utf8"), "MUST_NOT_BE_PRUNED");
      assert.deepEqual((await readdir(otherIdentityRoot)).filter((name) => name.endsWith(".bak")), [`${sha256("# Other original\n")}.bak`]);
      assert.equal(await readFile(agentsPath, "utf8"), states[11]);
      assert.equal((await stat(agentsPath)).mode & 0o7777, 0o640);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("the first accepted save creates a private deterministic zero-byte Artifact Backup", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-backup-permissions-"));
  const home = join(fixtureRoot, "home with spaces and ünicode");
  const workspace = join(fixtureRoot, "workspace");
  const artifactPath = join(home, ".codex", "AGENTS.md");

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(artifactPath, Buffer.alloc(0), { mode: 0o640 });
    const artifactIdentity = join(await realpath(home), ".codex", "AGENTS.md");
    const revision = sha256(Buffer.alloc(0));
    const identityKey = sha256(artifactIdentity);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await openGlobalMarkdown(page, "AGENTS.md");
      const result = await saveCurrentMarkdown(page, "# First content\n");

      const dataRoot = join(home, "harness_config_studio");
      const backupRoot = join(dataRoot, "backups");
      const identityRoot = join(backupRoot, identityKey);
      const backupPath = join(identityRoot, `${revision}.bak`);
      assert.equal((await stat(dataRoot)).mode & 0o7777, 0o700);
      assert.equal((await stat(backupRoot)).mode & 0o7777, 0o700);
      assert.equal((await stat(identityRoot)).mode & 0o7777, 0o700);
      assert.equal((await stat(backupPath)).mode & 0o7777, 0o600);
      assert.deepEqual(await readFile(backupPath), Buffer.alloc(0));
      assert.equal(await readFile(artifactPath, "utf8"), "# First content\n");
      assert.equal((await stat(artifactPath)).mode & 0o7777, 0o640);
      assert.equal(result.artifactIdentity, artifactIdentity);
      assert.equal(String(result.backupPath).endsWith(`/${identityKey}/${revision}.bak`), true);
      assert.doesNotMatch(JSON.stringify(result), /First content/);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("retrying an interrupted replacement reuses the matching Artifact Backup", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-backup-retry-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const artifactDirectory = join(home, ".codex");
  const artifactPath = join(artifactDirectory, "AGENTS.md");
  const original = "# Original for retry\n";
  const pending = "# Saved after retry\n";

  try {
    await mkdir(artifactDirectory, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(artifactPath, original, { mode: 0o640 });
    const originalDirectoryMode = (await stat(artifactDirectory)).mode & 0o7777;
    const artifactIdentity = join(await realpath(home), ".codex", "AGENTS.md");
    const identityRoot = join(home, "harness_config_studio", "backups", sha256(artifactIdentity));
    const backupPath = join(identityRoot, `${sha256(original)}.bak`);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await openGlobalMarkdown(page, "AGENTS.md");
      await page.getByRole("textbox", { name: "Artifact content" }).fill(pending);
      await page.getByRole("button", { name: "Review save" }).click();
      const review = page.getByRole("dialog", { name: "Save Review" });
      await review.waitFor();
      await chmod(artifactDirectory, 0o500);
      const failedResponse = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      await review.getByRole("button", { name: "Confirm save" }).click();
      const failed = await failedResponse;

      assert.equal(failed.status(), 500);
      assert.equal((await failed.json()).error.code, "save-replacement-failed");
      assert.equal(await readFile(artifactPath, "utf8"), original);
      assert.deepEqual(await readFile(backupPath), Buffer.from(original));
      assert.deepEqual((await readdir(identityRoot)).filter((name) => name.endsWith(".bak")), [`${sha256(original)}.bak`]);
      const firstBackup = await stat(backupPath);
      assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).inputValue(), pending);
      assert.equal(await page.getByRole("button", { name: "Review save" }).isEnabled(), true);

      await chmod(artifactDirectory, originalDirectoryMode);
      await page.getByRole("button", { name: "Review save" }).click();
      const retryReview = page.getByRole("dialog", { name: "Save Review" });
      const successfulResponse = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      await retryReview.getByRole("button", { name: "Confirm save" }).click();
      assert.equal((await successfulResponse).status(), 200);

      const reusedBackup = await stat(backupPath);
      assert.equal(reusedBackup.ino, firstBackup.ino);
      assert.equal(reusedBackup.mtimeMs, firstBackup.mtimeMs);
      assert.deepEqual((await readdir(identityRoot)).filter((name) => name.endsWith(".bak")), [`${sha256(original)}.bak`]);
      assert.equal(await readFile(artifactPath, "utf8"), pending);
      assert.equal((await stat(artifactPath)).mode & 0o7777, 0o640);
    } finally {
      await chmod(artifactDirectory, originalDirectoryMode).catch(() => undefined);
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("Save recovers either half of an interrupted Artifact Backup publication", async (context) => {
  for (const orphan of ["backup", "metadata"] as const) {
    await context.test(`${orphan}-only state`, async () => {
      const fixtureRoot = await mkdtemp(join(tmpdir(), `harness-config-backup-${orphan}-orphan-`));
      const home = join(fixtureRoot, "home");
      const workspace = join(fixtureRoot, "workspace");
      const artifactPath = join(home, ".codex", "AGENTS.md");
      const original = `# ${orphan} orphan original\n`;
      const pending = `# ${orphan} orphan saved\n`;

      try {
        await mkdir(join(home, ".codex"), { recursive: true });
        await mkdir(workspace, { recursive: true });
        await writeFile(artifactPath, original, { mode: 0o640 });
        const artifactIdentity = join(await realpath(home), ".codex", "AGENTS.md");
        const revision = sha256(original);
        const identityRoot = join(home, "harness_config_studio", "backups", sha256(artifactIdentity));
        const backupPath = join(identityRoot, `${revision}.bak`);
        const metadataPath = join(identityRoot, `${revision}.json`);
        const interruptedAt = "2026-08-31T12:00:00.000Z";
        await mkdir(identityRoot, { recursive: true, mode: 0o700 });
        if (orphan === "backup") {
          await writeFile(backupPath, original, { mode: 0o600 });
        } else {
          await writeFile(metadataPath, `${JSON.stringify({
            schemaVersion: 1,
            artifactIdentity,
            editRevision: revision,
            createdAt: interruptedAt,
          })}\n`, { mode: 0o600 });
        }

        const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage();
          await page.goto(running.url);
          await page.locator('#app[data-state="ready"]').waitFor();
          await page.getByRole("heading", { name: "Global configuration" }).click();
          await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
          await openGlobalMarkdown(page, "AGENTS.md");
          const result = await saveCurrentMarkdown(page, pending);

          assert.deepEqual(await readFile(backupPath), Buffer.from(original));
          const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
          assert.equal(metadata.artifactIdentity, artifactIdentity);
          assert.equal(metadata.editRevision, revision);
          assert.equal(result.backupReference && (result.backupReference as Record<string, unknown>).reused, true);
          if (orphan === "metadata") {
            assert.equal(metadata.createdAt, interruptedAt);
            assert.equal((result.backupReference as Record<string, unknown>).createdAt, interruptedAt);
          }
          assert.equal(await readFile(artifactPath, "utf8"), pending);
        } finally {
          await browser.close();
          await running.close();
        }
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    });
  }
});

test("a corrupt oldest backup makes retention fail closed before replacing the artifact", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-backup-prune-failure-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const artifactPath = join(home, ".codex", "AGENTS.md");
  const states = Array.from({ length: 12 }, (_, index) => `# Prune version ${index}\n`);

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(artifactPath, states[0]!, { mode: 0o640 });
    const artifactIdentity = join(await realpath(home), ".codex", "AGENTS.md");
    const identityRoot = join(home, "harness_config_studio", "backups", sha256(artifactIdentity));
    const oldestPath = join(identityRoot, `${sha256(states[0]!)}.bak`);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await openGlobalMarkdown(page, "AGENTS.md");
      for (let index = 1; index <= 10; index += 1) await saveCurrentMarkdown(page, states[index]!);

      await rm(oldestPath);
      await mkdir(oldestPath);
      await writeFile(join(oldestPath, "must-remain.txt"), "UNRELATED_SENTINEL");
      await page.getByRole("textbox", { name: "Artifact content" }).fill(states[11]!);
      await page.getByRole("button", { name: "Review save" }).click();
      const review = page.getByRole("dialog", { name: "Save Review" });
      const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      await review.getByRole("button", { name: "Confirm save" }).click();
      const response = await responsePromise;
      const responseBody = await response.text();

      assert.equal(response.status(), 500);
      const error = JSON.parse(responseBody).error;
      assert.equal(error.code, "backup-retention-failed");
      assert.equal(error.action, "apply-save");
      assert.equal(error.path, artifactIdentity);
      assert.doesNotMatch(responseBody, /Prune version|UNRELATED_SENTINEL/);
      assert.equal(await readFile(artifactPath, "utf8"), states[10]);
      assert.equal((await stat(artifactPath)).mode & 0o7777, 0o640);
      assert.equal(await readFile(join(oldestPath, "must-remain.txt"), "utf8"), "UNRELATED_SENTINEL");
      assert.equal((await readdir(identityRoot)).filter((name) => name.endsWith(".bak")).length, 11);
      assert.equal((await readdir(identityRoot)).some((name) => name.endsWith(".backup-stage")), false);
      const newlyPublishedBackup = join(identityRoot, `${sha256(states[10]!)}.bak`);
      assert.deepEqual(await readFile(newlyPublishedBackup), Buffer.from(states[10]!));
      assert.equal(await lstat(join(identityRoot, `${sha256(states[10]!)}.json`)).then(() => true, () => false), true);
      assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).inputValue(), states[11]);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("a failure before backup publication does not prune any retained backup", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-backup-publication-failure-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const artifactPath = join(home, ".codex", "AGENTS.md");
  const states = Array.from({ length: 12 }, (_, index) => `# Publish version ${index}\n`);

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(artifactPath, states[0]!, { mode: 0o640 });
    const artifactIdentity = join(await realpath(home), ".codex", "AGENTS.md");
    const identityRoot = join(home, "harness_config_studio", "backups", sha256(artifactIdentity));
    const blockedBackupPath = join(identityRoot, `${sha256(states[10]!)}.bak`);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await openGlobalMarkdown(page, "AGENTS.md");
      for (let index = 1; index <= 10; index += 1) await saveCurrentMarkdown(page, states[index]!);
      const retainedBefore = (await readdir(identityRoot)).filter((name) => name.endsWith(".bak")).sort();
      assert.equal(retainedBefore.length, 10);
      await mkdir(blockedBackupPath);

      await page.getByRole("textbox", { name: "Artifact content" }).fill(states[11]!);
      await page.getByRole("button", { name: "Review save" }).click();
      const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      await page.getByRole("dialog", { name: "Save Review" }).getByRole("button", { name: "Confirm save" }).click();
      const response = await responsePromise;

      assert.equal(response.status(), 500);
      assert.equal((await response.json()).error.code, "backup-conflict");
      assert.deepEqual((await readdir(identityRoot)).filter((name) => name.endsWith(".bak") && name !== `${sha256(states[10]!)}.bak`).sort(), retainedBefore);
      assert.equal(await readFile(artifactPath, "utf8"), states[10]);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("opening one artifact removes only its old exact-prefix real sibling temporary", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-temporary-cleanup-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const artifactDirectory = join(home, ".codex");
  const artifactPath = join(artifactDirectory, "AGENTS.md");
  const otherArtifactPath = join(artifactDirectory, "AGENTS.override.md");

  try {
    await mkdir(artifactDirectory, { recursive: true });
    await mkdir(join(workspace, "elsewhere"), { recursive: true });
    await writeFile(artifactPath, "# Cleanup A\n");
    await writeFile(otherArtifactPath, "# Cleanup B\n");
    const canonicalHome = await realpath(home);
    const artifactIdentity = join(canonicalHome, ".codex", "AGENTS.md");
    const otherIdentity = join(canonicalHome, ".codex", "AGENTS.override.md");
    const prefix = `.harness-config-studio-${sha256(artifactIdentity)}-`;
    const otherPrefix = `.harness-config-studio-${sha256(otherIdentity)}-`;
    const oldTemporary = join(artifactDirectory, `${prefix}1111111111111111.tmp`);
    const newTemporary = join(artifactDirectory, `${prefix}2222222222222222.tmp`);
    const prefixLikeUserFile = join(artifactDirectory, `${prefix}not-an-owned-nonce.tmp`);
    const ownedDirectory = join(artifactDirectory, `${prefix}3333333333333333.tmp`);
    const ownedSymlink = join(artifactDirectory, `${prefix}4444444444444444.tmp`);
    const otherArtifactTemporary = join(artifactDirectory, `${otherPrefix}5555555555555555.tmp`);
    const elsewhereTemporary = join(workspace, "elsewhere", `${prefix}6666666666666666.tmp`);
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const newDate = new Date(Date.now() - 60 * 60 * 1000);

    await writeFile(oldTemporary, "owned old");
    await writeFile(newTemporary, "owned new");
    await writeFile(prefixLikeUserFile, "user file");
    await mkdir(ownedDirectory);
    await symlink(oldTemporary, ownedSymlink);
    await writeFile(otherArtifactTemporary, "other artifact");
    await writeFile(elsewhereTemporary, "elsewhere");
    for (const path of [oldTemporary, prefixLikeUserFile, ownedDirectory, otherArtifactTemporary, elsewhereTemporary]) {
      await utimes(path, oldDate, oldDate);
    }
    await utimes(newTemporary, newDate, newDate);

    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await openGlobalMarkdown(page, "AGENTS.md");

      await assert.rejects(lstat(oldTemporary));
      for (const path of [newTemporary, prefixLikeUserFile, ownedDirectory, ownedSymlink, otherArtifactTemporary, elsewhereTemporary]) {
        assert.equal(await lstat(path).then(() => true, () => false), true, path);
      }
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
