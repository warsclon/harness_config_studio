import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { startServer } from "../src/server.ts";
import { FinderGatewayError } from "../src/system-gateway.ts";

test("System Reveal appends one private metadata-only Activity Record", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-activity-reveal-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const artifactPath = join(home, ".codex", "config.toml");
  const secret = "SECRET_ARTIFACT_CONTENT";
  const intents: Array<{ disposition: string; path: string }> = [];
  const systemGateway = { async reveal(intent: { disposition: string; path: string }) { intents.push({ ...intent }); } };
  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(artifactPath, secret);
    const artifactIdentity = join(await realpath(home), ".codex", "config.toml");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: "Reveal config.toml in Finder" }).click();
      await page.getByText("Asked Finder to select config.toml.", { exact: true }).waitFor();

      const dataRoot = join(await realpath(home), ".harness_config_studio");
      const activityPath = join(dataRoot, "activity.json");
      const raw = await readFile(activityPath, "utf8");
      const document = JSON.parse(raw) as { schemaVersion: number; records: unknown[] };
      assert.equal((await stat(dataRoot)).mode & 0o7777, 0o700);
      assert.equal((await stat(activityPath)).mode & 0o7777, 0o600);
      assert.equal(document.schemaVersion, 1);
      assert.equal(document.records.length, 1);
      const record = document.records[0] as Record<string, unknown>;
      assert.match(String(record.time), /^\d{4}-\d\d-\d\dT/);
      assert.equal(record.action, "system-reveal");
      assert.deepEqual(record.subject, { kind: "artifact", path: artifactIdentity, artifactIdentity });
      assert.deepEqual(record.result, { status: "success", code: "finder-request-accepted" });
      assert.doesNotMatch(raw, new RegExp(secret));
      assert.doesNotMatch(raw, /capability|technicalDetails|resolvedPath/);
      assert.deepEqual(intents, [{ disposition: "select-item", path: artifactIdentity }]);
      await lstat(join(dataRoot, "activity.json"));
      assert.equal(relative(dataRoot, activityPath), "activity.json");
      const appDataReveal = page.getByTestId("reveal-application-data");
      assert.equal(await appDataReveal.count(), 1);
      await appDataReveal.click();
      await page.getByText("Asked Finder to open .harness_config_studio.", { exact: true }).waitFor();
      assert.deepEqual(intents.at(-1), { disposition: "open-directory", path: dataRoot });

      const corrupt = "{CORRUPT_ACTIVITY_SENTINEL";
      await writeFile(activityPath, corrupt, { mode: 0o600 });
      await page.getByRole("button", { name: "Reveal config.toml in Finder" }).click();
      await page.getByText(/Asked Finder to select config.toml.*Activity Record could not be updated/i).waitFor();
      assert.equal(await readFile(activityPath, "utf8"), corrupt);
      assert.equal(intents.length, 3);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("Save exposes and reveals the latest validated backup without browsing its content", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-recovery-backup-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const artifactPath = join(home, ".codex", "AGENTS.md");
  const original = "# DO_NOT_RENDER_BACKUP_CONTENT\n";
  const intents: Array<{ disposition: string; path: string }> = [];
  const systemGateway = { async reveal(intent: { disposition: string; path: string }) { intents.push({ ...intent }); } };
  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(artifactPath, original, { mode: 0o600 });
    const artifactIdentity = join(await realpath(home), ".codex", "AGENTS.md");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).click();
      await page.getByRole("textbox", { name: "Artifact content" }).fill("# Saved\n");
      await page.getByRole("button", { name: "Review save" }).click();
      const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      await page.getByRole("dialog", { name: "Save Review" }).getByRole("button", { name: "Confirm save" }).click();
      const response = await responsePromise;
      assert.equal(response.status(), 200);
      const payload = await response.json() as { backupReference: { relativePath: string; editRevision: string; createdAt: string; reused: boolean } };
      assert.equal(payload.backupReference.reused, false);
      assert.match(payload.backupReference.relativePath, /^backups\/[a-f0-9]{64}\/[a-f0-9]{64}\.bak$/);

      const recovery = page.getByTestId("artifact-recovery");
      await recovery.getByText("Latest backup", { exact: true }).waitFor();
      assert.equal((await recovery.innerText()).includes(original.trim()), false);
      await recovery.getByRole("button", { name: "Reveal backup in Finder" }).click();
      await page.getByText("Asked Finder to select latest backup.", { exact: true }).waitFor();
      const expectedBackupPath = join(await realpath(home), ".harness_config_studio", payload.backupReference.relativePath);
      assert.deepEqual(intents, [{ disposition: "select-item", path: expectedBackupPath }]);

      const activity = JSON.parse(await readFile(join(home, ".harness_config_studio", "activity.json"), "utf8")) as { records: Array<Record<string, unknown>> };
      assert.equal(activity.records.length, 2);
      assert.equal(activity.records[0]?.action, "save");
      assert.deepEqual(activity.records[0]?.backupReference, payload.backupReference);
      assert.equal(activity.records[1]?.action, "system-reveal");
      assert.doesNotMatch(JSON.stringify(activity), /DO_NOT_RENDER_BACKUP_CONTENT|# Saved/);
      assert.equal(await page.getByRole("button", { name: /restore|download|delete backup/i }).count(), 0);
      assert.equal(await readFile(artifactPath, "utf8"), "# Saved\n");
      assert.equal(artifactIdentity, activity.records[0]?.subject && (activity.records[0]!.subject as { artifactIdentity: string }).artifactIdentity);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("a failed Save Apply records one metadata-only failure outcome", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-activity-save-failure-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const artifactPath = join(home, ".codex", "AGENTS.md");
  const original = "# PRIVATE ORIGINAL\n";
  const pending = "# PRIVATE PENDING\n";
  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(artifactPath, original, { mode: 0o600 });
    const artifactIdentity = join(await realpath(home), ".codex", "AGENTS.md");
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
      await page.getByRole("dialog", { name: "Save Review" }).waitFor();
      await writeFile(artifactPath, "# EXTERNAL CHANGE\n", { mode: 0o600 });

      const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      await page.getByRole("button", { name: "Confirm save" }).click();
      const response = await responsePromise;
      assert.equal(response.status(), 409);
      assert.equal((await response.json()).error.code, "artifact-changed");

      const raw = await readFile(join(home, ".harness_config_studio", "activity.json"), "utf8");
      const document = JSON.parse(raw) as { records: Array<Record<string, unknown>> };
      assert.equal(document.records.length, 1);
      assert.deepEqual(document.records[0], {
        time: document.records[0]?.time,
        action: "save",
        subject: { kind: "artifact", path: artifactIdentity, artifactIdentity },
        result: { status: "failure", code: "artifact-changed" },
      });
      assert.doesNotMatch(raw, /PRIVATE|EXTERNAL CHANGE|technicalDetails|capability/);
      assert.equal(await readFile(artifactPath, "utf8"), "# EXTERNAL CHANGE\n");
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("Activity retention keeps the newest 1,000 records by append order", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-activity-retention-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const artifactPath = join(home, ".codex", "config.toml");
  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(artifactPath, "model='x'\n");
    const artifactIdentity = join(await realpath(home), ".codex", "config.toml");
    const dataRoot = join(home, ".harness_config_studio");
    await mkdir(dataRoot, { mode: 0o700 });
    const records = Array.from({ length: 1_000 }, (_, index) => ({
      time: "2026-01-01T00:00:00.000Z",
      action: "system-reveal",
      subject: { kind: "artifact", path: `${artifactIdentity}-${index}`, artifactIdentity: `${artifactIdentity}-${index}` },
      result: { status: "success", code: "finder-request-accepted" },
    }));
    await writeFile(join(dataRoot, "activity.json"), `${JSON.stringify({ schemaVersion: 1, records })}\n`, { mode: 0o600 });
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway: { async reveal() {} } });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: "Reveal config.toml in Finder" }).click();
      await page.getByText("Asked Finder to select config.toml.", { exact: true }).waitFor();
      const document = JSON.parse(await readFile(join(dataRoot, "activity.json"), "utf8")) as { records: Array<{ subject: { path: string } }> };
      assert.equal(document.records.length, 1_000);
      assert.equal(document.records[0]?.subject.path, `${artifactIdentity}-1`);
      assert.equal(document.records.at(-1)?.subject.path, artifactIdentity);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("a legacy Activity Record with an unknown nested field is preserved byte-for-byte and not appended", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-activity-unknown-field-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const artifactPath = join(home, ".codex", "config.toml");
  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(artifactPath, "model='x'\n");
    const artifactIdentity = join(await realpath(home), ".codex", "config.toml");
    const dataRoot = join(home, ".harness_config_studio");
    await mkdir(dataRoot, { mode: 0o700 });
    const legacy = `${JSON.stringify({
      schemaVersion: 1,
      records: [{
        time: "2026-01-01T00:00:00.000Z",
        action: "save",
        subject: { kind: "artifact", path: artifactIdentity, artifactIdentity },
        result: { status: "success", code: "saved" },
        backupReference: {
          relativePath: "backups/a/b.bak",
          editRevision: "a".repeat(64),
          createdAt: "2026-01-01T00:00:00.000Z",
          reused: false,
          content: "LEGACY_CONTENT_MUST_NOT_SURVIVE_VALIDATION",
        },
      }],
    })}\n`;
    const activityPath = join(dataRoot, "activity.json");
    await writeFile(activityPath, legacy, { mode: 0o600 });
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway: { async reveal() {} } });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: "Reveal config.toml in Finder" }).click();
      await page.getByText(/Asked Finder to select config.toml.*Activity Record could not be updated/i).waitFor();
      assert.equal(await readFile(activityPath, "utf8"), legacy);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("latest-backup Reveal preserves stable Finder gateway codes and sanitized details", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-recovery-finder-errors-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const artifactPath = join(home, ".codex", "AGENTS.md");
  const failures = [
    new FinderGatewayError("finder-unavailable", "Finder could not be launched.", { osCode: "ENOENT" }),
    new FinderGatewayError("finder-reveal-timeout", "Finder timed out.", { signal: "SIGTERM" }),
    new FinderGatewayError("finder-reveal-failed", "Finder denied the request.", { osCode: "EACCES", exitCode: 1 }),
  ];
  let failureIndex = 0;
  const systemGateway = {
    async reveal(): Promise<never> { throw failures[failureIndex++]!; },
  };
  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(artifactPath, "# Original\n", { mode: 0o600 });
    const artifactIdentity = join(await realpath(home), ".codex", "AGENTS.md");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).click();
      await page.getByRole("textbox", { name: "Artifact content" }).fill("# Saved\n");
      await page.getByRole("button", { name: "Review save" }).click();
      await page.getByRole("dialog", { name: "Save Review" }).getByRole("button", { name: "Confirm save" }).click();
      await page.getByText("Saved successfully", { exact: true }).waitFor();

      const outcomes = await page.evaluate(async ({ artifactIdentity }) => {
        const capability = document.querySelector('meta[name="hcs-session-capability"]')?.getAttribute("content") || "";
        const values = [];
        for (let index = 0; index < 3; index += 1) {
          const response = await fetch("/api/management/reveal", {
            method: "POST",
            headers: { "content-type": "application/json", "x-harness-config-capability": capability },
            body: JSON.stringify({ target: { kind: "latest-artifact-backup", artifactIdentity } }),
          });
          values.push({ status: response.status, body: await response.json() });
        }
        return values;
      }, { artifactIdentity });
      assert.deepEqual(outcomes.map(({ status, body }) => ({ status, code: body.error.code, details: body.error.technicalDetails })), [
        { status: 503, code: "finder-unavailable", details: { osCode: "ENOENT" } },
        { status: 504, code: "finder-reveal-timeout", details: { signal: "SIGTERM" } },
        { status: 502, code: "finder-reveal-failed", details: { osCode: "EACCES", exitCode: 1 } },
      ]);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("an unsafe Activity Journal warns without changing successful Save or Trash outcomes", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-activity-warning-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const savePath = join(home, ".codex", "AGENTS.md");
  const removalPath = join(home, ".codex", "config.toml");
  const moved: string[] = [];
  const revealed: string[] = [];
  const systemGateway = {
    async reveal(intent: { path: string }) { revealed.push(intent.path); },
    async moveToTrash(intent: { path: string }) {
      moved.push(intent.path);
      await rm(intent.path);
      return {};
    },
    async openTrash() {},
  };
  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(savePath, "# Original\n", { mode: 0o600 });
    await writeFile(removalPath, "model='x'\n", { mode: 0o600 });
    const dataRoot = join(home, ".harness_config_studio");
    await mkdir(join(dataRoot, "activity.json"), { recursive: true, mode: 0o700 });
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: "Reveal config.toml in Finder" }).click();
      await page.getByText(/Asked Finder to select config.toml.*Activity Record could not be updated/i).waitFor();
      assert.deepEqual(revealed, [join(await realpath(home), ".codex", "config.toml")]);
      await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).click();
      await page.getByRole("textbox", { name: "Artifact content" }).fill("# Saved despite journal\n");
      await page.getByRole("button", { name: "Review save" }).click();
      const saveResponse = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      await page.getByRole("dialog", { name: "Save Review" }).getByRole("button", { name: "Confirm save" }).click();
      const savedResponse = await saveResponse;
      assert.equal(savedResponse.status(), 200);
      const savedPayload = await savedResponse.json() as {
        applicationDataRootAvailable: boolean;
        reconciliation: { status: string };
        warnings: Array<{ code: string }>;
      };
      assert.equal(savedPayload.applicationDataRootAvailable, false);
      assert.equal(savedPayload.reconciliation.status, "fresh");
      assert.deepEqual(savedPayload.warnings.map((warning) => warning.code), ["activity-record-failed"]);
      await page.getByTestId("editor-status").getByText("Saved", { exact: true }).waitFor();
      assert.equal(await page.getByTestId("reveal-application-data").count(), 0);
      assert.equal(await page.getByTestId("editor-status").innerText(), "Saved");
      assert.equal(await readFile(savePath, "utf8"), "# Saved despite journal\n");

      await page.getByRole("button", { name: "Move config.toml to Trash" }).click();
      await page.getByRole("dialog", { name: "Move file to Trash" }).getByRole("button", { name: "Move this file to Trash" }).click();
      await page.getByText(/Moved to Trash.*Activity Record could not be updated/i).waitFor();
      assert.equal(await page.getByRole("button", { name: "Open Trash" }).count(), 1);
      assert.deepEqual(moved, [join(await realpath(home), ".codex", "config.toml")]);
      await assert.rejects(lstat(removalPath));
      assert.equal((await lstat(join(dataRoot, "activity.json"))).isDirectory(), true);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("file, symbolic-link, and Managed Skill Directory removals record only metadata", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-activity-removals-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const filePath = join(home, ".codex", "config.toml");
  const linkPath = join(home, ".codex", "AGENTS.md");
  const targetPath = join(fixtureRoot, "RAW_LINK_TARGET_SECRET.md");
  const skillPath = join(home, ".agents", "skills", "my-skill");
  const intents: Array<{ path: string; targetKind: string }> = [];
  const systemGateway = {
    async moveToTrash(intent: { path: string; targetKind: string }) {
      intents.push({ ...intent });
      await rm(intent.path, { recursive: true });
      return {};
    },
  };
  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(skillPath, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(filePath, "PRIVATE_FILE_CONTENT");
    await writeFile(targetPath, "PRIVATE_TARGET_CONTENT");
    await symlink(targetPath, linkPath);
    await writeFile(join(skillPath, "SKILL.md"), "PRIVATE_SKILL_CONTENT");
    const canonicalHome = await realpath(home);
    const identities = [
      join(canonicalHome, ".codex", "config.toml"),
      join(canonicalHome, ".codex", "AGENTS.md"),
      join(canonicalHome, ".agents", "skills", "my-skill"),
    ];
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      const results = await page.evaluate(async ({ identities }) => {
        const capability = document.querySelector('meta[name="hcs-session-capability"]')?.getAttribute("content") || "";
        const call = async (path: string, body: object) => {
          const response = await fetch(path, {
            method: "POST",
            headers: { "content-type": "application/json", "x-harness-config-capability": capability },
            body: JSON.stringify(body),
          });
          return { status: response.status, payload: await response.json() };
        };
        const outcomes = [];
        for (const artifactIdentity of identities) {
          const preview = await call("/api/management/removals/preview", { artifactIdentity });
          const skillName = preview.payload.targetKind === "managed-skill-directory" ? preview.payload.skillName : undefined;
          outcomes.push(await call("/api/management/removals/apply", {
            removalReviewId: preview.payload.removalReviewId,
            ...(skillName ? { confirmationName: skillName } : {}),
          }));
        }
        return outcomes;
      }, { identities });
      assert.deepEqual(results.map((result) => result.status), [200, 200, 200]);
      assert.deepEqual(intents.map((intent) => intent.targetKind), ["file", "symbolic-link", "managed-skill-directory"]);
      assert.equal(await readFile(targetPath, "utf8"), "PRIVATE_TARGET_CONTENT");
      const raw = await readFile(join(home, ".harness_config_studio", "activity.json"), "utf8");
      const document = JSON.parse(raw) as { records: Array<{ action: string; targetKind: string; subject: { artifactIdentity: string } }> };
      assert.deepEqual(document.records.map(({ action, targetKind, subject }) => ({ action, targetKind, identity: subject.artifactIdentity })), [
        { action: "recoverable-removal", targetKind: "file", identity: identities[0] },
        { action: "recoverable-removal", targetKind: "symbolic-link", identity: identities[1] },
        { action: "recoverable-removal", targetKind: "managed-skill-directory", identity: identities[2] },
      ]);
      assert.doesNotMatch(raw, /PRIVATE_|RAW_LINK_TARGET_SECRET|SKILL\.md/);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("concurrent management outcomes are serialized without losing Activity Records", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-activity-concurrent-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const artifactPath = join(home, ".codex", "config.toml");
  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(artifactPath, "model='x'\n");
    const artifactIdentity = join(await realpath(home), ".codex", "config.toml");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway: { async reveal() {} } });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      const statuses = await page.evaluate(async ({ artifactIdentity }) => {
        const capability = document.querySelector('meta[name="hcs-session-capability"]')?.getAttribute("content") || "";
        return Promise.all(Array.from({ length: 16 }, async () => {
          const response = await fetch("/api/management/reveal", {
            method: "POST",
            headers: { "content-type": "application/json", "x-harness-config-capability": capability },
            body: JSON.stringify({ target: { kind: "artifact", artifactIdentity } }),
          });
          return response.status;
        }));
      }, { artifactIdentity });
      assert.deepEqual(statuses, Array(16).fill(200));
      const document = JSON.parse(await readFile(join(home, ".harness_config_studio", "activity.json"), "utf8")) as { records: unknown[] };
      assert.equal(document.records.length, 16);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
