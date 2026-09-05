import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, realpath, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { startServer } from "../src/server.ts";

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

test("saving an in-boundary symbolic link preserves the link and attributes its backup to the visible identity", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-symlink-save-"));
  const home = join(fixtureRoot, "home with spaces");
  const workspace = join(fixtureRoot, "workspace");
  const globalRoot = join(home, ".codex");
  const targetDirectory = join(globalRoot, "shared targets");
  const artifactPath = join(globalRoot, "AGENTS.md");
  const targetPath = join(targetDirectory, "instructions without extension");
  const original = Buffer.from("# Original\r\nShared\r\n", "utf8");
  const saved = Buffer.from("# Updated\r\nShared\r\n", "utf8");

  try {
    await mkdir(targetDirectory, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(targetPath, original, { mode: 0o640 });
    await symlink(relative(globalRoot, targetPath), artifactPath);
    const artifactIdentity = join(await realpath(home), ".codex", "AGENTS.md");
    const resolvedPath = await realpath(targetPath);
    const openedLink = await lstat(artifactPath, { bigint: true });
    const rawLinkTarget = await readlink(artifactPath);
    const openedTarget = await stat(targetPath, { bigint: true });
    const editRevision = sha256(original);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      const row = page.getByRole("button", { name: /AGENTS\.md.*instructions/i });
      assert.equal(await row.getByTestId("symlink-icon").count(), 1);
      await row.click();

      const detail = page.getByTestId("management-detail");
      await page.getByRole("textbox", { name: "Artifact content" }).waitFor();
      assert.match(await detail.innerText(), new RegExp(artifactIdentity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(await detail.innerText(), new RegExp(resolvedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(await detail.innerText(), /Symbolic link/);
      assert.match(await detail.innerText(), /Editing linked target/);

      await page.getByRole("textbox", { name: "Artifact content" }).fill("# Updated\nShared\n");
      await page.getByRole("button", { name: "Review save" }).click();
      const review = page.getByRole("dialog", { name: "Save Review" });
      await review.waitFor();
      assert.equal(await review.getByTestId("review-symlink-icon").count(), 1);
      const reviewText = await review.innerText();
      assert.match(reviewText, new RegExp(artifactIdentity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(reviewText, new RegExp(resolvedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(reviewText, /Saving changes the target bytes and preserves the symbolic link/);
      assert.match(reviewText, /Harness Memberships\s+Codex/i);
      const saveResponse = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      await review.getByRole("button", { name: "Confirm save" }).click();
      assert.equal((await saveResponse).status(), 200);
      await page.getByText("Saved target; symbolic link preserved", { exact: true }).waitFor();

      const savedLink = await lstat(artifactPath, { bigint: true });
      assert.equal(savedLink.isSymbolicLink(), true);
      assert.equal(savedLink.ino, openedLink.ino);
      assert.equal(await readlink(artifactPath), rawLinkTarget);
      assert.equal(await realpath(artifactPath), resolvedPath);
      assert.deepEqual(await readFile(targetPath), saved);
      assert.equal((await stat(targetPath)).mode & 0o7777, 0o640);

      const identityRoot = join(home, ".harness_config_studio", "backups", sha256(artifactIdentity));
      const backupPath = join(identityRoot, `${editRevision}.bak`);
      const metadataPath = join(identityRoot, `${editRevision}.json`);
      assert.deepEqual(await readFile(backupPath), original);
      assert.equal((await stat(backupPath)).mode & 0o7777, 0o600);
      assert.equal((await stat(metadataPath)).mode & 0o7777, 0o600);
      const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
      assert.equal(metadata.schemaVersion, 1);
      assert.equal(metadata.artifactIdentity, artifactIdentity);
      assert.equal(metadata.editRevision, editRevision);
      assert.equal(metadata.resolvedPath, resolvedPath);
      assert.match(metadata.linkRevision, /^[a-f0-9]{64}$/);
      assert.deepEqual(metadata.target, {
        device: openedTarget.dev.toString(),
        inode: openedTarget.ino.toString(),
        mode: 0o640,
        byteLength: original.length.toString(),
      });
      await assert.rejects(readdir(join(home, ".harness_config_studio", "backups", sha256(resolvedPath))));
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("link and target physical identity changes reject Save without leaking content or creating recovery data", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-symlink-conflicts-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const globalRoot = join(home, ".codex");
  const artifactPath = join(globalRoot, "AGENTS.md");
  const targetPath = join(globalRoot, "shared.md");
  const replacementPath = join(globalRoot, "replacement.md");
  const original = "ORIGINAL_LINK_TARGET_SECRET\n";
  const pending = "PENDING_BROWSER_SECRET\n";
  const applicationDataRoot = join(home, ".harness_config_studio");

  try {
    await mkdir(globalRoot, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(targetPath, original, { mode: 0o640 });
    await symlink("shared.md", artifactPath);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).click();
      const editor = page.getByRole("textbox", { name: "Artifact content" });
      await editor.fill(pending);

      const oldLinkInode = (await lstat(artifactPath, { bigint: true })).ino;
      await rm(artifactPath);
      await symlink("shared.md", artifactPath);
      assert.notEqual((await lstat(artifactPath, { bigint: true })).ino, oldLinkInode);
      const replacedLinkResponse = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/review"));
      await page.getByRole("button", { name: "Review save" }).click();
      const rejectedLink = await replacedLinkResponse;
      const rejectedLinkBody = await rejectedLink.text();
      assert.equal(rejectedLink.status(), 409);
      assert.equal(JSON.parse(rejectedLinkBody).error.code, "artifact-changed");
      assert.doesNotMatch(rejectedLinkBody, /ORIGINAL_LINK_TARGET_SECRET|PENDING_BROWSER_SECRET/);
      assert.equal(await editor.inputValue(), pending);
      await assert.rejects(lstat(applicationDataRoot));

      await page.getByTestId("close-editor").click();
      await page.getByRole("dialog", { name: "Unsaved changes" }).getByRole("button", { name: "Discard" }).click();
      await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).click();
      await page.getByRole("textbox", { name: "Artifact content" }).fill(pending);
      await page.getByRole("button", { name: "Review save" }).click();
      const review = page.getByRole("dialog", { name: "Save Review" });
      await review.waitFor();

      const targetInode = (await stat(targetPath, { bigint: true })).ino;
      await writeFile(replacementPath, original, { mode: 0o640 });
      await rename(replacementPath, targetPath);
      assert.notEqual((await stat(targetPath, { bigint: true })).ino, targetInode);
      const replacedTargetResponse = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      await review.getByRole("button", { name: "Confirm save" }).click();
      const rejectedTarget = await replacedTargetResponse;
      const rejectedTargetBody = await rejectedTarget.text();
      assert.equal(rejectedTarget.status(), 409);
      assert.equal(JSON.parse(rejectedTargetBody).error.code, "artifact-changed");
      assert.doesNotMatch(rejectedTargetBody, /ORIGINAL_LINK_TARGET_SECRET|PENDING_BROWSER_SECRET/);
      assert.equal(await readFile(targetPath, "utf8"), original);
      assert.equal((await lstat(artifactPath)).isSymbolicLink(), true);
      assert.equal(await readlink(artifactPath), "shared.md");
      assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).inputValue(), pending);
      const activity = await readFile(join(applicationDataRoot, "activity.json"), "utf8");
      assert.match(activity, /"status":"failure","code":"artifact-changed"/);
      assert.doesNotMatch(activity, /ORIGINAL_LINK_TARGET_SECRET|PENDING_BROWSER_SECRET/);
      await assert.rejects(lstat(join(applicationDataRoot, "backups")));
      assert.equal((await readdir(globalRoot)).some((name) => name.startsWith(".harness-config-studio-")), false);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("two visible aliases of one target serialize Save and prevent a lost update", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-symlink-aliases-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const projectRoot = join(workspace, "project");
  const firstDirectory = join(projectRoot, ".agents", "skills", "first-skill");
  const secondDirectory = join(projectRoot, ".agents", "skills", "second-skill");
  const firstLink = join(firstDirectory, "first.txt");
  const secondLink = join(secondDirectory, "second.txt");
  const targetPath = join(projectRoot, "shared target.txt");
  const original = "shared original\n";
  const firstEdit = "saved by first alias\n";
  const secondEdit = "saved by second alias\n";

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(firstDirectory, { recursive: true });
    await mkdir(secondDirectory, { recursive: true });
    await writeFile(targetPath, original, { mode: 0o640 });
    await symlink(relative(firstDirectory, targetPath), firstLink);
    await symlink(relative(secondDirectory, targetPath), secondLink);
    const canonicalProject = await realpath(projectRoot);
    const firstIdentity = join(canonicalProject, ".agents", "skills", "first-skill", "first.txt");
    const secondIdentity = join(canonicalProject, ".agents", "skills", "second-skill", "second.txt");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const [firstPage, secondPage] = await Promise.all([browser.newPage(), browser.newPage()]);
      for (const page of [firstPage, secondPage]) {
        await page.goto(running.url);
        await page.locator('#app[data-state="ready"]').waitFor();
        await page.getByRole("heading", { name: "Project configuration" }).click();
        await page.getByRole("button", { name: /project.*Project Root/i }).click();
        await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();
      }
      await firstPage.getByRole("button", { name: /first\.txt.*skills/i }).click();
      await secondPage.getByRole("button", { name: /second\.txt.*skills/i }).click();
      await firstPage.getByRole("textbox", { name: "Artifact content" }).fill(firstEdit);
      await secondPage.getByRole("textbox", { name: "Artifact content" }).fill(secondEdit);
      await firstPage.getByRole("button", { name: "Review save" }).click();
      await secondPage.getByRole("button", { name: "Review save" }).click();
      const firstReview = firstPage.getByRole("dialog", { name: "Save Review" });
      const secondReview = secondPage.getByRole("dialog", { name: "Save Review" });
      await Promise.all([firstReview.waitFor(), secondReview.waitFor()]);

      const firstResponsePromise = firstPage.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      const secondResponsePromise = secondPage.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      await Promise.all([
        firstReview.getByRole("button", { name: "Confirm save" }).click(),
        secondReview.getByRole("button", { name: "Confirm save" }).click(),
      ]);
      const [firstResponse, secondResponse] = await Promise.all([firstResponsePromise, secondResponsePromise]);
      assert.deepEqual([firstResponse.status(), secondResponse.status()].sort(), [200, 409]);
      const winner = firstResponse.status() === 200
        ? { identity: firstIdentity, content: firstEdit, loserResponse: secondResponse, loserPage: secondPage }
        : { identity: secondIdentity, content: secondEdit, loserResponse: firstResponse, loserPage: firstPage };
      const loserBody = await winner.loserResponse.text();
      assert.equal(JSON.parse(loserBody).error.code, "artifact-changed");
      assert.doesNotMatch(loserBody, /shared original|saved by first alias|saved by second alias/);
      assert.equal(await readFile(targetPath, "utf8"), winner.content);
      assert.equal((await lstat(firstLink)).isSymbolicLink(), true);
      assert.equal((await lstat(secondLink)).isSymbolicLink(), true);
      assert.equal(await winner.loserPage.getByRole("textbox", { name: "Artifact content" }).inputValue(), winner.identity === firstIdentity ? secondEdit : firstEdit);

      const backupRoot = join(home, ".harness_config_studio", "backups");
      const identityRoots = await readdir(backupRoot);
      assert.deepEqual(identityRoots, [sha256(winner.identity)]);
      assert.deepEqual((await readdir(join(backupRoot, identityRoots[0]!))).sort(), [
        `${sha256(original)}.bak`,
        `${sha256(original)}.json`,
      ]);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("retry after target replacement failure reuses the same backup and symlink sidecar", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-symlink-retry-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const globalRoot = join(home, ".codex");
  const targetDirectory = join(globalRoot, "targets");
  const artifactPath = join(globalRoot, "AGENTS.md");
  const targetPath = join(targetDirectory, "shared.md");
  const original = "# Original through link\n";
  const pending = "# Saved after retry\n";

  try {
    await mkdir(targetDirectory, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(targetPath, original, { mode: 0o640 });
    await symlink(relative(globalRoot, targetPath), artifactPath);
    const targetDirectoryMode = (await stat(targetDirectory)).mode & 0o7777;
    const artifactIdentity = join(await realpath(home), ".codex", "AGENTS.md");
    const identityRoot = join(home, ".harness_config_studio", "backups", sha256(artifactIdentity));
    const backupPath = join(identityRoot, `${sha256(original)}.bak`);
    const metadataPath = join(identityRoot, `${sha256(original)}.json`);
    const openedLink = await lstat(artifactPath, { bigint: true });
    const rawLinkTarget = await readlink(artifactPath);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).click();
      await page.getByRole("textbox", { name: "Artifact content" }).fill(pending);
      await page.getByRole("button", { name: "Review save" }).click();
      const firstReview = page.getByRole("dialog", { name: "Save Review" });
      await chmod(targetDirectory, 0o500);
      const failedResponse = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      await firstReview.getByRole("button", { name: "Confirm save" }).click();
      const failed = await failedResponse;
      assert.equal(failed.status(), 500);
      assert.equal((await failed.json()).error.code, "save-replacement-failed");
      assert.equal(await readFile(targetPath, "utf8"), original);
      const firstBackup = await stat(backupPath);
      const firstMetadata = await stat(metadataPath);
      const metadataContent = await readFile(metadataPath, "utf8");

      await chmod(targetDirectory, targetDirectoryMode);
      await page.getByRole("button", { name: "Review save" }).click();
      const retryReview = page.getByRole("dialog", { name: "Save Review" });
      const successfulResponse = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      await retryReview.getByRole("button", { name: "Confirm save" }).click();
      assert.equal((await successfulResponse).status(), 200);

      const reusedBackup = await stat(backupPath);
      const reusedMetadata = await stat(metadataPath);
      assert.equal(reusedBackup.ino, firstBackup.ino);
      assert.equal(reusedBackup.mtimeMs, firstBackup.mtimeMs);
      assert.equal(reusedMetadata.ino, firstMetadata.ino);
      assert.equal(reusedMetadata.mtimeMs, firstMetadata.mtimeMs);
      assert.equal(await readFile(metadataPath, "utf8"), metadataContent);
      assert.deepEqual((await readdir(identityRoot)).sort(), [`${sha256(original)}.bak`, `${sha256(original)}.json`]);
      assert.equal(await readFile(targetPath, "utf8"), pending);
      assert.equal((await lstat(artifactPath, { bigint: true })).ino, openedLink.ino);
      assert.equal(await readlink(artifactPath), rawLinkTarget);
    } finally {
      await chmod(targetDirectory, targetDirectoryMode).catch(() => undefined);
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("symlink target disappearance type bytes and retarget conflicts never recreate or overwrite filesystem objects", async () => {
  for (const changed of ["bytes", "missing", "type", "retarget"] as const) {
    const fixtureRoot = await mkdtemp(join(tmpdir(), `harness-config-symlink-${changed}-`));
    const home = join(fixtureRoot, "home");
    const workspace = join(fixtureRoot, "workspace");
    const globalRoot = join(home, ".codex");
    const artifactPath = join(globalRoot, "AGENTS.md");
    const targetPath = join(globalRoot, "target.md");
    const secondTargetPath = join(globalRoot, "second.md");
    const original = "ORIGINAL_TARGET_SECRET\n";
    const pending = "PENDING_TARGET_SECRET\n";
    const external = "EXTERNAL_TARGET_SECRET\n";

    try {
      await mkdir(globalRoot, { recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(targetPath, original, { mode: 0o640 });
      await writeFile(secondTargetPath, external, { mode: 0o640 });
      await symlink("target.md", artifactPath);
      const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
      const browser = await chromium.launch({ headless: true });

      try {
        const page = await browser.newPage();
        await page.goto(running.url);
        await page.locator('#app[data-state="ready"]').waitFor();
        await page.getByRole("heading", { name: "Global configuration" }).click();
        await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
        await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).click();
        const editor = page.getByRole("textbox", { name: "Artifact content" });
        await editor.fill(pending);

        if (changed === "bytes") await writeFile(targetPath, external, { mode: 0o640 });
        if (changed === "missing") await rm(targetPath);
        if (changed === "type") {
          await rm(targetPath);
          await mkdir(targetPath);
        }
        if (changed === "retarget") {
          await rm(artifactPath);
          await symlink("second.md", artifactPath);
        }

        const reviewResponse = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/review"));
        await page.getByRole("button", { name: "Review save" }).click();
        const rejected = await reviewResponse;
        const body = await rejected.text();
        assert.equal(rejected.status(), 409, changed);
        assert.equal(JSON.parse(body).error.code, "artifact-changed", changed);
        assert.doesNotMatch(body, /ORIGINAL_TARGET_SECRET|PENDING_TARGET_SECRET|EXTERNAL_TARGET_SECRET/);
        assert.equal(await editor.inputValue(), pending);
        await assert.rejects(lstat(join(home, ".harness_config_studio")));
        if (changed === "bytes") assert.equal(await readFile(targetPath, "utf8"), external);
        if (changed === "missing") await assert.rejects(lstat(targetPath));
        if (changed === "type") assert.equal((await lstat(targetPath)).isDirectory(), true);
        if (changed === "retarget") {
          assert.equal(await readlink(artifactPath), "second.md");
          assert.equal(await readFile(targetPath, "utf8"), original);
          assert.equal(await readFile(secondTargetPath, "utf8"), external);
        } else {
          assert.equal((await lstat(artifactPath)).isSymbolicLink(), true);
          assert.equal(await readlink(artifactPath), "target.md");
        }
      } finally {
        await browser.close();
        await running.close();
      }
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }
});
