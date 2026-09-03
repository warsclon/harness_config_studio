import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { chromium, request as playwrightRequest } from "playwright";
import { startServer } from "../src/server.ts";
import { TrashGatewayError } from "../src/system-gateway.ts";

test("a Managed Skill Directory is reviewed without following links and moved after exact-name confirmation", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "hcs-skill-removal-ready-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const trash = join(fixtureRoot, "Trash");
  const skillsRoot = join(home, ".agents", "skills");
  const skillDirectory = join(skillsRoot, "review-me");
  const external = join(fixtureRoot, "external");
  const backup = join(home, "harness_config_studio", "backups", "sentinel.bak");
  const intents: Array<{ path: string; targetKind: string }> = [];
  let openTrashCalls = 0;
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(intent: { path: string; targetKind: string }): Promise<Record<string, never>> {
      intents.push(structuredClone(intent));
      await rename(intent.path, join(trash, basename(intent.path)));
      return {};
    },
    async openTrash(): Promise<void> { openTrashCalls += 1; },
  };

  try {
    await mkdir(join(skillDirectory, "assets"), { recursive: true });
    await mkdir(external, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(trash, { recursive: true });
    await mkdir(join(home, "harness_config_studio", "backups"), { recursive: true, mode: 0o700 });
    await writeFile(join(skillDirectory, "SKILL.md"), "# Review me\n");
    await writeFile(join(skillDirectory, "assets", "example.json"), "{\"ok\":true}\n");
    await writeFile(join(external, "MUST_NOT_APPEAR.txt"), "EXTERNAL_SECRET");
    await symlink(external, join(skillDirectory, "external-link"));
    await writeFile(backup, "BACKUP_SENTINEL");
    const canonicalSkill = await realpath(skillDirectory);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(3_000);
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.agents.*Global Root/i }).click();
      await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();
      await page.getByRole("button", { name: /SKILL\.md.*skills/i }).click();
      await page.getByRole("textbox", { name: "Artifact content" }).waitFor();

      await page.getByRole("button", { name: "Move review-me to Trash" }).click();
      const dialog = page.getByRole("dialog", { name: "Move skill directory to Trash" });
      await dialog.waitFor();
      const dialogText = await dialog.innerText();
      assert.match(dialogText, new RegExp(canonicalSkill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(dialogText, /review-me/);
      assert.match(dialogText, /Codex/);
      assert.match(dialogText, /OpenCode/);
      assert.match(dialogText, /Pi/);
      assert.match(dialogText, /Files\s+2/i);
      assert.match(dialogText, /Directories\s+1/i);
      assert.match(dialogText, /Symbolic links\s+1/i);
      assert.match(dialogText, /SKILL\.md/);
      assert.match(dialogText, /assets\/example\.json/);
      assert.doesNotMatch(dialogText, /MUST_NOT_APPEAR|EXTERNAL_SECRET/);

      const confirmation = dialog.getByRole("textbox", { name: "Type “review-me” to confirm" });
      const move = dialog.getByRole("button", { name: "Move review-me to Trash" });
      await confirmation.fill("Review-me");
      assert.equal(await move.isDisabled(), true);
      await confirmation.fill("review-me");
      assert.equal(await move.isEnabled(), true);
      await move.click();

      await page.getByText("Moved to Trash", { exact: true }).waitFor();
      assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).count(), 0);
      await assert.rejects(lstat(canonicalSkill));
      assert.equal(await readFile(join(trash, "review-me", "SKILL.md"), "utf8"), "# Review me\n");
      assert.equal(await readFile(join(external, "MUST_NOT_APPEAR.txt"), "utf8"), "EXTERNAL_SECRET");
      assert.equal(await readFile(backup, "utf8"), "BACKUP_SENTINEL");
      assert.deepEqual(intents, [{ path: canonicalSkill, targetKind: "managed-skill-directory" }]);
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

test("Removal Preview accepts exact limits, refuses the next entry or byte, and offers Finder", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "hcs-skill-removal-limits-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const skillDirectory = join(home, ".agents", "skills", "limits");
  const revealIntents: Array<{ disposition: string; path: string }> = [];
  const systemGateway = {
    async reveal(intent: { disposition: string; path: string }): Promise<void> { revealIntents.push(structuredClone(intent)); },
    async moveToTrash(): Promise<Record<string, never>> { return {}; },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(skillDirectory, { recursive: true });
    await mkdir(workspace, { recursive: true });
    const canonicalSkill = await realpath(skillDirectory);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(10_000);
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.agents.*Global Root/i }).click();
      await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();
      const post = (route: string, data: unknown) => page.evaluate(async ({ route, data }) => {
        const capability = document.querySelector('meta[name="hcs-session-capability"]')?.getAttribute("content") ?? "";
        const response = await fetch(route, {
          method: "POST",
          headers: { "content-type": "application/json", "x-harness-config-capability": capability },
          body: JSON.stringify(data),
        });
        return { status: response.status, body: await response.json() };
      }, { route, data });

      for (let offset = 0; offset < 5_000; offset += 250) {
        await Promise.all(Array.from({ length: 250 }, (_, index) => writeFile(
          join(skillDirectory, `entry-${String(offset + index).padStart(4, "0")}`),
          "",
        )));
      }

      const exactEntries = await post("/api/management/removals/preview", { artifactIdentity: canonicalSkill });
      assert.equal(exactEntries.status, 200);
      assert.equal(exactEntries.body.status, "ready");
      assert.equal(exactEntries.body.summary.entries, 5_000);
      assert.equal(exactEntries.body.tree.entries.length, 200);
      assert.equal(exactEntries.body.tree.truncated, true);

      await writeFile(join(skillDirectory, "entry-5000"), "");
      await page.getByRole("button", { name: "Move limits to Trash" }).click();
      const refusal = page.getByRole("dialog", { name: "Too large to review safely" });
      await refusal.waitFor();
      assert.match(await refusal.innerText(), /5,000 entries/);
      assert.equal(await refusal.getByTestId("removal-confirmation").count(), 0);
      assert.equal(await refusal.getByRole("button", { name: /Move .* to Trash/ }).count(), 0);
      await refusal.getByRole("button", { name: "Reveal in Finder" }).click();
      await page.getByText(/Asked Finder to open limits/).waitFor();
      assert.deepEqual(revealIntents, [{ disposition: "open-directory", path: canonicalSkill }]);
      const invalidated = await post("/api/management/removals/apply", {
        removalReviewId: exactEntries.body.removalReviewId,
        confirmationName: "limits",
      });
      assert.equal(invalidated.status, 409);
      assert.equal(invalidated.body.error.code, "removal-review-invalid");

      await refusal.getByRole("button", { name: "Cancel" }).click();
      await rm(skillDirectory, { recursive: true, force: true });
      await mkdir(skillDirectory, { recursive: true });
      const sparse = await open(join(skillDirectory, "payload.bin"), "w");
      await sparse.truncate(104_857_600);
      await sparse.close();
      const exactBytes = await post("/api/management/removals/preview", { artifactIdentity: canonicalSkill });
      assert.equal(exactBytes.body.status, "ready");
      assert.equal(exactBytes.body.summary.totalBytes, 104_857_600);

      const oversized = await open(join(skillDirectory, "payload.bin"), "r+");
      await oversized.truncate(104_857_601);
      await oversized.close();
      const tooManyBytes = await post("/api/management/removals/preview", { artifactIdentity: canonicalSkill });
      assert.equal(tooManyBytes.body.status, "refused");
      assert.equal(tooManyBytes.body.reason, "bytes");
      assert.equal(tooManyBytes.body.observedAtLeast, "104857601");
      assert.equal("removalReviewId" in tooManyBytes.body, false);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("eligibility, typed confirmation, and changed-tree checks fail closed", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "hcs-skill-removal-edges-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const skillsRoot = join(home, ".agents", "skills");
  const empty = join(skillsRoot, "empty skill");
  const incomplete = join(skillsRoot, "incomplete");
  const nested = join(incomplete, "nested");
  const hidden = join(skillsRoot, ".hidden");
  const external = join(fixtureRoot, "external-skill");
  const externalAlternate = join(fixtureRoot, "external-skill-alternate");
  const linked = join(skillsRoot, "linked");
  const retargetDirectory = join(skillsRoot, "retarget");
  const internalLink = join(retargetDirectory, "external-link");
  const newlineName = "odd\nname";
  const newlineDirectory = join(skillsRoot, newlineName);
  const projectSkill = join(workspace, "project", ".agents", "skills", "project-skill");
  let trashCalls = 0;
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(): Promise<Record<string, never>> { trashCalls += 1; return {}; },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(empty, { recursive: true });
    await mkdir(nested, { recursive: true });
    await mkdir(hidden, { recursive: true });
    await mkdir(external, { recursive: true });
    await mkdir(externalAlternate, { recursive: true });
    await mkdir(retargetDirectory, { recursive: true });
    await mkdir(newlineDirectory, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(join(workspace, "project", ".git"), { recursive: true });
    await mkdir(projectSkill, { recursive: true });
    await writeFile(join(incomplete, "README.txt"), "Incomplete skill");
    await symlink(external, linked);
    await symlink(external, internalLink);
    const canonicalRoot = await realpath(skillsRoot);
    const canonicalEmpty = await realpath(empty);
    const canonicalNested = await realpath(nested);
    const canonicalHidden = await realpath(hidden);
    const canonicalLinked = join(canonicalRoot, "linked");
    const canonicalRetarget = await realpath(retargetDirectory);
    const canonicalProjectSkill = await realpath(projectSkill);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.agents.*Global Root/i }).click();
      await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "Move empty skill to Trash" }).count(), 1);
      assert.equal(await page.getByRole("button", { name: "Move incomplete to Trash" }).count(), 1);
      assert.equal(await page.getByRole("button", { name: "Move .hidden to Trash" }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "Move nested to Trash" }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "Move linked to Trash" }).count(), 1);
      assert.equal(await page.getByRole("button", { name: "Move skills to Trash" }).count(), 0);

      await page.getByRole("button", { name: /Move odd\s+name to Trash/ }).click();
      const newlineDialog = page.getByRole("dialog", { name: "Move skill directory to Trash" });
      await newlineDialog.getByTestId("removal-confirmation").fill(newlineName);
      assert.equal(await newlineDialog.getByRole("button", { name: /Move odd\s+name to Trash/ }).isEnabled(), true);
      await newlineDialog.getByRole("button", { name: "Cancel" }).click();

      const post = (route: string, data: unknown) => page.evaluate(async ({ route, data }) => {
        const capability = document.querySelector('meta[name="hcs-session-capability"]')?.getAttribute("content") ?? "";
        const response = await fetch(route, {
          method: "POST",
          headers: { "content-type": "application/json", "x-harness-config-capability": capability },
          body: JSON.stringify(data),
        });
        return { status: response.status, body: await response.json() };
      }, { route, data });

      for (const path of [canonicalRoot, canonicalNested, canonicalHidden]) {
        const response = await post("/api/management/removals/preview", { artifactIdentity: path });
        assert.equal(response.status, 422);
        assert.equal(response.body.error.code, "removal-not-eligible");
      }
      const linkedPreview = await post("/api/management/removals/preview", { artifactIdentity: canonicalLinked });
      assert.equal(linkedPreview.status, 200);
      assert.equal(linkedPreview.body.targetKind, "symbolic-link");
      assert.equal(linkedPreview.body.consequence, "link-only");

      const preview = await post("/api/management/removals/preview", { artifactIdentity: canonicalEmpty });
      assert.equal(preview.body.status, "ready");
      const wrong = await post("/api/management/removals/apply", {
        removalReviewId: preview.body.removalReviewId,
        confirmationName: "empty skill ",
      });
      assert.equal(wrong.status, 422);
      assert.equal(wrong.body.error.code, "removal-confirmation-invalid");
      const consumed = await post("/api/management/removals/apply", {
        removalReviewId: preview.body.removalReviewId,
        confirmationName: "empty skill",
      });
      assert.equal(consumed.status, 409);
      assert.equal(consumed.body.error.code, "removal-review-invalid");

      const projectPreview = await post("/api/management/removals/preview", { artifactIdentity: canonicalProjectSkill });
      assert.equal(projectPreview.body.status, "ready");
      assert.equal(projectPreview.body.scope.kind, "project");
      assert.deepEqual(projectPreview.body.harnesses, ["codex", "opencode", "pi"]);

      const changedPreview = await post("/api/management/removals/preview", { artifactIdentity: canonicalEmpty });
      await writeFile(join(empty, "added-after-preview.txt"), "changed");
      const changed = await post("/api/management/removals/apply", {
        removalReviewId: changedPreview.body.removalReviewId,
        confirmationName: "empty skill",
      });
      assert.equal(changed.status, 409);
      assert.equal(changed.body.error.code, "removal-changed");
      assert.equal(await readFile(join(empty, "added-after-preview.txt"), "utf8"), "changed");

      const linkPreview = await post("/api/management/removals/preview", { artifactIdentity: canonicalRetarget });
      assert.doesNotMatch(JSON.stringify(linkPreview.body), /external-skill/);
      await rm(internalLink, { force: true });
      await symlink(externalAlternate, internalLink);
      const retargeted = await post("/api/management/removals/apply", {
        removalReviewId: linkPreview.body.removalReviewId,
        confirmationName: "retarget",
      });
      assert.equal(retargeted.status, 409);
      assert.equal(retargeted.body.error.code, "removal-changed");
      assert.equal((await lstat(internalLink)).isSymbolicLink(), true);
      assert.equal(trashCalls, 0);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("a Pending Edit inside the subtree or reached through a symlink blocks directory removal", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "hcs-skill-removal-dirty-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const skillDirectory = join(home, ".agents", "skills", "guarded");
  const target = join(skillDirectory, "settings.toml");
  const visibleLink = join(home, ".codex", "config.toml");
  let trashCalls = 0;
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(): Promise<Record<string, never>> { trashCalls += 1; return {}; },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(skillDirectory, { recursive: true });
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(target, "enabled = true\n");
    await symlink(target, visibleLink);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByTestId("toggle-sections").click();
      await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();
      await page.getByRole("button", { name: /config\.toml.*settings/i }).click();
      const editor = page.getByRole("textbox", { name: "Artifact content" });
      await editor.fill("enabled = false\n");
      const remove = page.getByRole("button", { name: "Move guarded to Trash" });
      assert.equal(await remove.isDisabled(), true);
      assert.match(await remove.getAttribute("title") ?? "", /Discard or save/);
      assert.equal(trashCalls, 0);

      await editor.fill("enabled = true\n");
      assert.equal(await remove.isEnabled(), true);
      await remove.click();
      const removalDialog = page.getByRole("dialog", { name: "Move skill directory to Trash" });
      await removalDialog.getByRole("textbox", { name: "Type “guarded” to confirm" }).fill("guarded");
      await page.locator("#artifact-content").evaluate((element) => {
        const textarea = element as HTMLTextAreaElement;
        textarea.value = "enabled = false\n";
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await removalDialog.getByRole("button", { name: "Move guarded to Trash" }).click();
      await page.getByRole("dialog", { name: "Unsaved changes" }).waitFor();
      assert.equal(trashCalls, 0);
      assert.equal(await readFile(target, "utf8"), "enabled = true\n");
      assert.equal((await lstat(skillDirectory)).isDirectory(), true);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("directory removal holds a subtree mutation scope against a descendant Save", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "hcs-skill-removal-lock-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const trash = join(fixtureRoot, "Trash");
  const skillDirectory = join(home, ".agents", "skills", "locked");
  const skillFile = join(skillDirectory, "settings.toml");
  const visibleLink = join(home, ".codex", "config.toml");
  let enterTrash!: () => void;
  const trashEntered = new Promise<void>((resolve) => { enterTrash = resolve; });
  let releaseTrash!: () => void;
  const trashReleased = new Promise<void>((resolve) => { releaseTrash = resolve; });
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(intent: { path: string }): Promise<Record<string, never>> {
      enterTrash();
      await trashReleased;
      await rename(intent.path, join(trash, basename(intent.path)));
      return {};
    },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(skillDirectory, { recursive: true });
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(trash, { recursive: true });
    await writeFile(skillFile, "enabled = true\n");
    await symlink(skillFile, visibleLink);
    const canonicalDirectory = await realpath(skillDirectory);
    const visibleArtifactIdentity = join(await realpath(home), ".codex", "config.toml");
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
        data: { artifactIdentity: visibleArtifactIdentity },
      })).json() as { editHandle: string; editRevision: string };
      const saveReview = await (await api.post(`${running.url}/api/management/saves/review`, {
        data: { editHandle: opened.editHandle, editRevision: opened.editRevision, content: "enabled = false\n" },
      })).json() as { reviewId: string };
      const removalReview = await (await api.post(`${running.url}/api/management/removals/preview`, {
        data: { artifactIdentity: canonicalDirectory },
      })).json() as { removalReviewId: string };

      const removalPromise = api.post(`${running.url}/api/management/removals/apply`, {
        data: { removalReviewId: removalReview.removalReviewId, confirmationName: "locked" },
      });
      await trashEntered;
      let saveSettled = false;
      const savePromise = api.post(`${running.url}/api/management/saves/apply`, {
        data: { reviewId: saveReview.reviewId },
      }).then((response) => { saveSettled = true; return response; });
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(saveSettled, false);
      releaseTrash();

      const removal = await removalPromise;
      const save = await savePromise;
      assert.equal(removal.status(), 200);
      assert.equal(save.status(), 409);
      assert.equal((await save.json()).error.code, "artifact-changed");
      assert.equal(await readFile(join(trash, "locked", "settings.toml"), "utf8"), "enabled = true\n");
      assert.equal((await lstat(visibleLink)).isSymbolicLink(), true);
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

test("a directory Trash gateway failure leaves the whole tree and backups unchanged", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "hcs-skill-removal-gateway-failure-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const skillDirectory = join(home, ".agents", "skills", "keep-me");
  const backup = join(home, "harness_config_studio", "backups", "sentinel.bak");
  const intents: Array<{ path: string; targetKind: string }> = [];
  const systemGateway = {
    async reveal(): Promise<void> {},
    async moveToTrash(intent: { path: string; targetKind: string }): Promise<never> {
      intents.push(structuredClone(intent));
      throw new TrashGatewayError("trash-failed", "macOS could not move this directory to Trash.");
    },
    async openTrash(): Promise<void> {},
  };

  try {
    await mkdir(skillDirectory, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(join(home, "harness_config_studio", "backups"), { recursive: true, mode: 0o700 });
    await writeFile(join(skillDirectory, "SKILL.md"), "# Keep me\n");
    await writeFile(backup, "BACKUP_SENTINEL");
    const canonicalSkill = await realpath(skillDirectory);
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
        data: { artifactIdentity: canonicalSkill },
      })).json() as { removalReviewId: string };
      const failed = await api.post(`${running.url}/api/management/removals/apply`, {
        data: { removalReviewId: preview.removalReviewId, confirmationName: "keep-me" },
      });
      assert.equal(failed.status(), 502);
      assert.equal((await failed.json()).error.code, "trash-failed");
      assert.equal(await readFile(join(skillDirectory, "SKILL.md"), "utf8"), "# Keep me\n");
      assert.equal(await readFile(backup, "utf8"), "BACKUP_SENTINEL");
      assert.deepEqual(intents, [{ path: canonicalSkill, targetKind: "managed-skill-directory" }]);
    } finally {
      await api.dispose();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
