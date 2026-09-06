import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium, request as playwrightRequest } from "playwright";
import { startServer } from "../src/server.ts";

test("Web Management opens one inventoried artifact through an authenticated Finder Columns surface", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-management-open-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const agentsPath = join(home, ".codex", "AGENTS.md");
  const agentsTarget = join(home, ".codex", "shared-instructions.md");
  const settingsPath = join(home, ".codex", "config.toml");
  const untrackedPath = join(workspace, "private-not-in-inventory.md");
  const secret = "SECRET_AGENT_TEXT\nSecond line";

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(agentsTarget, secret);
    await symlink(agentsTarget, agentsPath);
    await writeFile(settingsPath, "model = 'test'");
    await writeFile(untrackedPath, "UNTRACKED_SECRET");
    const canonicalAgentsPath = join(await realpath(home), ".codex", "AGENTS.md");
    const canonicalAgentsTarget = await realpath(agentsTarget);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();

      await page.getByTestId("management-sources").waitFor();
      await page.getByTestId("management-artifacts").waitFor();
      await page.getByTestId("management-detail").waitFor();
      assert.doesNotMatch(await page.content(), /SECRET_AGENT_TEXT|UNTRACKED_SECRET/);

      const inventoryResponse = await page.request.get(`${running.url}/api/inventory`);
      const inventoryBody = await inventoryResponse.text();
      assert.equal(JSON.parse(inventoryBody).schemaVersion, 1);
      assert.doesNotMatch(inventoryBody, /SECRET_AGENT_TEXT|UNTRACKED_SECRET/);

      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).click();

      const editor = page.getByRole("textbox", { name: "Artifact content" });
      assert.equal(await editor.inputValue(), secret);
      const detail = page.getByTestId("management-detail");
      await detail.getByText(canonicalAgentsPath, { exact: true }).waitFor();
      assert.match(await detail.innerText(), /Markdown/);
      assert.match(await detail.innerText(), /Global/);
      assert.match(await detail.innerText(), /Codex/);
      assert.match(await detail.innerText(), /Symbolic link/);
      await detail.getByText(canonicalAgentsTarget, { exact: true }).waitFor();
      assert.match(await detail.innerText(), /[a-f0-9]{64}/);

      await page.getByRole("button", { name: /config\.toml.*settings/i }).click();
      assert.equal(await editor.inputValue(), "model = 'test'");
      assert.doesNotMatch(await detail.innerText(), /SECRET_AGENT_TEXT/);
      assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).count(), 1);

      const capability = await page.locator('meta[name="hcs-session-capability"]').getAttribute("content");
      assert.ok(capability);
      const host = new URL(running.url).host;
      const callOpen = async (headers: Record<string, string>, artifactIdentity = agentsPath, method = "POST", path = "/api/management/artifacts/open") => {
        const api = await playwrightRequest.newContext({ extraHTTPHeaders: headers });
        try {
          const response = await api.fetch(`${running.url}${path}`, {
            method,
            data: { artifactIdentity },
          });
          return { status: response.status(), body: await response.text() };
        } finally {
          await api.dispose();
        }
      };
      const expectContentFreeError = async (response: Awaited<ReturnType<typeof callOpen>>, status: number, code: string) => {
        assert.equal(response.status, status);
        assert.equal(JSON.parse(response.body).error.code, code);
        assert.doesNotMatch(response.body, /SECRET_AGENT_TEXT|UNTRACKED_SECRET/);
      };
      const validHeaders = {
        Host: host,
        Origin: running.url,
        "x-harness-config-capability": capability,
      };

      await expectContentFreeError(await callOpen({ Host: host, Origin: running.url }), 401, "capability-required");
      await expectContentFreeError(await callOpen({ ...validHeaders, "x-harness-config-capability": "wrong" }), 401, "capability-invalid");
      await expectContentFreeError(await callOpen({ ...validHeaders, Origin: "https://example.test" }), 403, "origin-invalid");
      await expectContentFreeError(await callOpen({ ...validHeaders, Host: "example.test" }), 403, "host-invalid");
      await expectContentFreeError(await callOpen(validHeaders, agentsPath, "GET"), 405, "method-not-allowed");
      await expectContentFreeError(await callOpen(validHeaders, agentsPath, "POST", "/api/management/not-a-route"), 404, "route-not-found");
      await expectContentFreeError(await callOpen(validHeaders, untrackedPath), 404, "artifact-not-found");
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("a late Open response cannot replace the current artifact or its Pending Edit", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-open-order-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const agentsPath = join(home, ".codex", "AGENTS.md");
  const settingsPath = join(home, ".codex", "config.toml");
  let releaseFirst!: () => void;
  let markFirstSeen!: () => void;
  let markFirstFinished!: () => void;
  const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstSeen = new Promise<void>((resolve) => { markFirstSeen = resolve; });
  const firstFinished = new Promise<void>((resolve) => { markFirstFinished = resolve; });

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(agentsPath, "FIRST\n");
    await writeFile(settingsPath, "SECOND\n");
    const canonicalAgentsPath = join(await realpath(home), ".codex", "AGENTS.md");
    const running = await startServer({
      home,
      workspace,
      preferredPort: 0,
      strictPort: true,
      async beforeOpenResponseForTest(artifactIdentity) {
        if (artifactIdentity !== canonicalAgentsPath) return;
        markFirstSeen();
        await firstRelease;
        markFirstFinished();
      },
    });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();

      const firstClick = page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).click();
      await firstSeen;
      await page.getByRole("button", { name: /config\.toml.*settings/i }).click();

      const editor = page.getByRole("textbox", { name: "Artifact content" });
      await assert.doesNotReject(() => editor.waitFor());
      assert.equal(await editor.inputValue(), "SECOND\n");
      await editor.fill("SECOND DIRTY\n");
      assert.match(await page.getByTestId("editor-status").innerText(), /Unsaved changes/);

      releaseFirst();
      await firstFinished;
      await firstClick;

      assert.equal(await editor.inputValue(), "SECOND DIRTY\n");
      assert.match(await page.getByTestId("management-detail").innerText(), /config\.toml/);
      assert.match(await page.getByTestId("editor-status").innerText(), /Unsaved changes/);
      assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).count(), 1);
    } finally {
      releaseFirst();
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("Markdown editing stays browser-local and exposes a dirty editor state", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-markdown-edit-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const agentsPath = join(home, ".codex", "AGENTS.md");
  const original = "# Instructions\n\nKeep this safe.\n";

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(agentsPath, original);
    const canonicalAgentsPath = join(await realpath(home), ".codex", "AGENTS.md");
    const originalMode = (await stat(agentsPath)).mode & 0o7777;
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
      const save = page.getByRole("button", { name: "Review save" });
      assert.equal(await editor.isEditable(), true);
      assert.equal(await save.isDisabled(), true);
      assert.match(await page.getByTestId("editor-status").innerText(), /Saved/);

      await editor.fill("# Instructions\n\nKeep this safer.\n");
      assert.equal(await save.isEnabled(), true);
      assert.match(await page.getByTestId("editor-status").innerText(), /Unsaved changes/);
      assert.equal(await readFile(agentsPath, "utf8"), original);

      await editor.press("End");
      await editor.press("Tab");
      assert.match(await editor.inputValue(), /\t$/);
      assert.match(await page.getByTestId("cursor-position").innerText(), /Ln 4, Col 2/);
      assert.equal(await readFile(agentsPath, "utf8"), original);

      await editor.press("Meta+S");
      const review = page.getByRole("dialog", { name: "Save Review" });
      await review.waitFor();
      await review.getByText(canonicalAgentsPath, { exact: true }).waitFor();
      assert.equal(await review.getByTestId("save-validation").innerText(), "No validation required");
      assert.match(await review.getByTestId("save-diff").innerText(), /Keep this safe\./);
      assert.match(await review.getByTestId("save-diff").innerText(), /Keep this safer\./);
      assert.equal(await readFile(agentsPath, "utf8"), original);
      await assert.rejects(stat(join(home, ".harness_config_studio")));

      await review.getByRole("button", { name: "Confirm save" }).click();
      await page.getByTestId("editor-status").getByText("Saved", { exact: true }).waitFor();
      const saved = "# Instructions\n\nKeep this safer.\n\t";
      assert.equal(await readFile(agentsPath, "utf8"), saved);
      assert.equal((await stat(agentsPath)).mode & 0o7777, originalMode);
      const backupRoot = join(home, ".harness_config_studio", "backups");
      const backupEntries = await readdir(backupRoot, { recursive: true });
      const backups = backupEntries.filter((entry) => entry.endsWith(".bak"));
      assert.equal(backups.length, 1);
      assert.equal(await readFile(join(backupRoot, backups[0]!), "utf8"), original);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("all supported Editable Artifact formats share one exact Open Review Apply flow", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-format-policy-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const projectRoot = join(workspace, "project");
  const policyRoot = join(projectRoot, ".agents", "skills", "policy");
  const cases = [
    { name: "sample.md", content: "# Updated\n", validation: "No validation required" },
    { name: "sample.txt", content: "updated plain text\n", validation: "No validation required" },
    { name: "sample.json", content: "[\n  1,\n  2\n]\n", validation: "Valid JSON" },
    { name: "sample.jsonc", content: "// comment stays\n{\"value\": true,}\n", validation: "Not validated; content will be preserved exactly" },
    { name: "sample.toml", content: "this is deliberately = dubious = toml\n", validation: "Not validated; content will be preserved exactly" },
    { name: "sample.yaml", content: ": deliberately: [dubious\n", validation: "Not validated; content will be preserved exactly" },
    { name: "sample.YmL", content: "also: [dubious\n", validation: "Not validated; content will be preserved exactly" },
    { name: "sample.rules", content: "# preserved source\n  deliberately unvalidated\n", format: "Rules", validation: "Syntax not validated; content will be preserved exactly" },
    { name: "sample.py", content: "# preserved source\n  deliberately unvalidated\n", format: "Python", validation: "Syntax not validated; content will be preserved exactly" },
    { name: "sample.ts", content: "# preserved source\n  deliberately unvalidated\n", format: "TypeScript", validation: "Syntax not validated; content will be preserved exactly" },
    { name: "sample.js", content: "# preserved source\n  deliberately unvalidated\n", format: "JavaScript", validation: "Syntax not validated; content will be preserved exactly" },
    { name: "sample.mjs", content: "# preserved source\n  deliberately unvalidated\n", format: "JavaScript", validation: "Syntax not validated; content will be preserved exactly" },
    { name: "sample.cjs", content: "# preserved source\n  deliberately unvalidated\n", format: "JavaScript", validation: "Syntax not validated; content will be preserved exactly" },
    { name: "sample.mts", content: "# preserved source\n  deliberately unvalidated\n", format: "TypeScript", validation: "Syntax not validated; content will be preserved exactly" },
    { name: "sample.cts", content: "# preserved source\n  deliberately unvalidated\n", format: "TypeScript", validation: "Syntax not validated; content will be preserved exactly" },
    { name: "sample.sh", content: "# preserved source\n  deliberately unvalidated\n", format: "Shell", validation: "Syntax not validated; content will be preserved exactly" },
    { name: "sample.bash", content: "# preserved source\n  deliberately unvalidated\n", format: "Shell", validation: "Syntax not validated; content will be preserved exactly" },
    { name: "sample.ZsH", content: "# preserved source\n  deliberately unvalidated\n", format: "Shell", validation: "Syntax not validated; content will be preserved exactly" },
  ] as const;

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(policyRoot, { recursive: true });
    for (const entry of cases) await writeFile(join(policyRoot, entry.name), "original\n");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Project configuration" }).click();
      await page.getByRole("button", { name: /project.*Project Root/i }).click();
      await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();

      for (const entry of cases) {
        await page.getByText(entry.name, { exact: true }).click();
        const editor = page.getByRole("textbox", { name: "Artifact content" });
        await editor.waitFor();
        assert.equal(await editor.isEditable(), true, entry.name);
        assert.equal(await editor.inputValue(), "original\n");
        if ("format" in entry) await page.locator(".detail-meta").getByText(entry.format, { exact: true }).waitFor();
        await editor.fill(entry.content);
        await page.getByRole("button", { name: "Review save" }).click();
        const review = page.getByRole("dialog", { name: "Save Review" });
        assert.equal(await review.getByTestId("save-validation").innerText(), entry.validation);
        assert.equal(await readFile(join(policyRoot, entry.name), "utf8"), "original\n");
        const applyResponse = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
        await review.getByRole("button", { name: "Confirm save" }).click();
        assert.equal((await applyResponse).status(), 200);
        assert.equal(await readFile(join(policyRoot, entry.name), "utf8"), entry.content);
      }
      const backupRoot = join(home, ".harness_config_studio", "backups");
      const backups = (await readdir(backupRoot, { recursive: true })).filter(name => name.endsWith(".bak"));
      assert.equal(backups.length, cases.length);
      for (const backup of backups) assert.equal(await readFile(join(backupRoot, backup), "utf8"), "original\n");
      const journal = JSON.parse(await readFile(join(home, ".harness_config_studio", "activity.json"), "utf8"));
      assert.equal(journal.records.filter((record: { action: string }) => record.action === "save").length, cases.length);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("Editable Artifact open enforces exact byte UTF-8 BOM and NUL boundaries", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-open-policy-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const projectRoot = join(workspace, "project");
  const policyRoot = join(projectRoot, ".agents", "skills", "policy");
  const paths = {
    exact: join(policyRoot, "exact.py"),
    unicode: join(policyRoot, "unicode.py"),
    tooLarge: join(policyRoot, "too-large.py"),
    bom: join(policyRoot, "bom.py"),
    malformed: join(policyRoot, "malformed.py"),
    binary: join(policyRoot, "binary.py"),
  };

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(policyRoot, { recursive: true });
    await writeFile(paths.exact, Buffer.alloc(1_048_576, 0x61));
    await writeFile(paths.unicode, "é".repeat(524_288));
    await writeFile(paths.tooLarge, Buffer.alloc(1_048_577, 0x62));
    await writeFile(paths.bom, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("original\n")]));
    await writeFile(paths.malformed, Buffer.from([0xc3, 0x28]));
    await writeFile(paths.binary, Buffer.from("BINARY_SECRET\0tail", "utf8"));
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Project configuration" }).click();
      await page.getByRole("button", { name: /project.*Project Root/i }).click();
      await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();

      await page.getByText("exact.py", { exact: true }).click();
      assert.equal((await page.getByRole("textbox", { name: "Artifact content" }).inputValue()).length, 1_048_576);
      await page.getByTestId("close-editor").click();

      await page.getByText("unicode.py", { exact: true }).click();
      assert.equal((await page.getByRole("textbox", { name: "Artifact content" }).inputValue()).length, 524_288);
      await page.getByTestId("close-editor").click();

      for (const [name, status, code] of [["too-large.py", 413, "artifact-too-large"], ["malformed.py", 415, "artifact-not-utf8"], ["binary.py", 415, "artifact-binary"]] as const) {
        const openResponse = page.waitForResponse((candidate) => candidate.url().endsWith("/api/management/artifacts/open"));
        await page.getByText(name, { exact: true }).click();
        assert.equal((await openResponse).status(), status);
        await page.getByText(code, { exact: true }).waitFor();
        assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).count(), 0);
        assert.equal(await page.getByRole("button", { name: `Reveal ${name} in Finder` }).isEnabled(), true);
        assert.doesNotMatch(await page.getByTestId("management-detail").innerText(), /BINARY_SECRET/);
      }

      await page.getByText("bom.py", { exact: true }).click();
      const editor = page.getByRole("textbox", { name: "Artifact content" });
      assert.equal(await editor.inputValue(), "original\n");
      assert.match(await page.getByTestId("management-detail").innerText(), /UTF-8 BOM/);
      await editor.fill("updated\n");
      await page.getByRole("button", { name: "Review save" }).click();
      const response = page.waitForResponse((candidate) => candidate.url().endsWith("/api/management/saves/apply"));
      await page.getByRole("button", { name: "Confirm save" }).click();
      assert.equal((await response).status(), 200);
      assert.deepEqual(await readFile(paths.bom), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("updated\n")]));
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("readable non-writable Editable Artifacts are view-only and unreadable files expose no content", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-permission-policy-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const projectRoot = join(workspace, "project");
  const policyRoot = join(projectRoot, ".agents", "skills", "policy");
  const writablePath = join(policyRoot, "writable.txt");
  const viewOnlyPath = join(policyRoot, "view-only.txt");
  const unreadablePath = join(policyRoot, "unreadable.txt");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(policyRoot, { recursive: true });
    await writeFile(writablePath, "writable\n", { mode: 0o644 });
    await writeFile(viewOnlyPath, "view only\n", { mode: 0o444 });
    await writeFile(unreadablePath, "UNREADABLE_SECRET\n", { mode: 0o600 });
    await chmod(unreadablePath, 0o000);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Project configuration" }).click();
      await page.getByRole("button", { name: /project.*Project Root/i }).click();
      await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();

      await page.getByText("writable.txt", { exact: true }).click();
      assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).isEditable(), true);

      const viewOnlyResponse = page.waitForResponse((candidate) => candidate.url().endsWith("/api/management/artifacts/open"));
      await page.getByText("view-only.txt", { exact: true }).click();
      const viewOnlyPayload = await (await viewOnlyResponse).json();
      assert.equal(viewOnlyPayload.editability, "view-only");
      assert.equal(viewOnlyPayload.editabilityReason, "not-writable");
      const editor = page.getByRole("textbox", { name: "Artifact content" });
      assert.equal(await editor.inputValue(), "view only\n");
      assert.equal(await editor.isEditable(), false);
      assert.equal(await page.getByRole("button", { name: "Review save" }).isDisabled(), true);
      await editor.press("Meta+S");
      assert.equal(await page.getByRole("dialog", { name: "Save Review" }).count(), 0);
      assert.equal((await stat(viewOnlyPath)).mode & 0o7777, 0o444);

      const unreadableResponse = page.waitForResponse((candidate) => candidate.url().endsWith("/api/management/artifacts/open"));
      await page.getByText("unreadable.txt", { exact: true }).click();
      const rejected = await unreadableResponse;
      const body = await rejected.text();
      assert.equal(rejected.status(), 403);
      assert.equal(JSON.parse(body).error.code, "artifact-unreadable");
      assert.doesNotMatch(body, /UNREADABLE_SECRET/);
      assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).count(), 0);
      assert.doesNotMatch(await page.getByTestId("management-detail").innerText(), /UNREADABLE_SECRET/);
      assert.equal((await stat(unreadablePath)).mode & 0o7777, 0o000);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await chmod(unreadablePath, 0o600).catch(() => undefined);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("authenticated save endpoints enforce view-only authorization at Review and Apply", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-server-view-only-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const projectRoot = join(workspace, "project");
  const policyRoot = join(projectRoot, ".agents", "skills", "policy");
  const artifactPath = join(policyRoot, "protected.txt");
  const applicationDataRoot = join(home, ".harness_config_studio");
  const original = "ORIGINAL_SECRET\n";

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(policyRoot, { recursive: true });
    await writeFile(artifactPath, original, { mode: 0o444 });
    const artifactIdentity = join(await realpath(policyRoot), "protected.txt");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
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
      const viewOnlyOpen = await api.post(`${running.url}/api/management/artifacts/open`, {
        data: { artifactIdentity },
      });
      assert.equal(viewOnlyOpen.status(), 200);
      const viewOnly = await viewOnlyOpen.json() as { editHandle: string; editRevision: string; editability: string };
      assert.equal(viewOnly.editability, "view-only");

      const proposedAtReview = "REVIEW_PROPOSED_SECRET\n";
      const rejectedReview = await api.post(`${running.url}/api/management/saves/review`, {
        data: { editHandle: viewOnly.editHandle, editRevision: viewOnly.editRevision, content: proposedAtReview },
      });
      const reviewBody = await rejectedReview.text();
      assert.equal(rejectedReview.status(), 403);
      assert.equal(JSON.parse(reviewBody).error.code, "artifact-view-only");
      assert.doesNotMatch(reviewBody, /ORIGINAL_SECRET|REVIEW_PROPOSED_SECRET/);
      assert.equal(await readFile(artifactPath, "utf8"), original);
      assert.equal((await stat(artifactPath)).mode & 0o7777, 0o444);
      assert.equal(await lstat(applicationDataRoot).then(() => true, () => false), false);

      await chmod(artifactPath, 0o644);
      const writableOpen = await api.post(`${running.url}/api/management/artifacts/open`, {
        data: { artifactIdentity },
      });
      assert.equal(writableOpen.status(), 200);
      const writable = await writableOpen.json() as { editHandle: string; editRevision: string };
      const proposedAtApply = "APPLY_PROPOSED_SECRET\n";
      const acceptedReview = await api.post(`${running.url}/api/management/saves/review`, {
        data: { editHandle: writable.editHandle, editRevision: writable.editRevision, content: proposedAtApply },
      });
      assert.equal(acceptedReview.status(), 200);
      const { reviewId } = await acceptedReview.json() as { reviewId: string };
      await chmod(artifactPath, 0o444);

      const rejectedApply = await api.post(`${running.url}/api/management/saves/apply`, { data: { reviewId } });
      const applyBody = await rejectedApply.text();
      assert.equal(rejectedApply.status(), 409);
      assert.equal(JSON.parse(applyBody).error.code, "artifact-changed");
      assert.doesNotMatch(applyBody, /ORIGINAL_SECRET|APPLY_PROPOSED_SECRET/);
      assert.equal(await readFile(artifactPath, "utf8"), original);
      assert.equal((await stat(artifactPath)).mode & 0o7777, 0o444);
      const activity = await readFile(join(applicationDataRoot, "activity.json"), "utf8");
      assert.match(activity, /"status":"failure","code":"artifact-changed"/);
      assert.doesNotMatch(activity, /ORIGINAL_SECRET|APPLY_PROPOSED_SECRET/);
      assert.equal(await lstat(join(applicationDataRoot, "backups")).then(() => true, () => false), false);
    } finally {
      await api.dispose();
      await running.close();
    }
  } finally {
    await chmod(artifactPath, 0o600).catch(() => undefined);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("JSON Save Review reports stable content-free line and column errors and recovers", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-json-validation-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const projectRoot = join(workspace, "project");
  const policyRoot = join(projectRoot, ".agents", "skills", "policy");
  const jsonPath = join(policyRoot, "validation.json");
  const invalidCases = [
    { content: "{\n  \"ok\": true,\n  \"bad\": ]\n}\n", line: 3, column: 10 },
    { content: "", line: 1, column: 1 },
    { content: " \n  ", line: 2, column: 3 },
    { content: "{\n  \"a\": 1", line: 2, column: 9 },
    { content: "{\"😀\": true,}", line: 1, column: 13 },
  ] as const;

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(policyRoot, { recursive: true });
    await writeFile(jsonPath, "{\"original\":true}\n");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Project configuration" }).click();
      await page.getByRole("button", { name: /project.*Project Root/i }).click();
      await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();
      await page.getByText("validation.json", { exact: true }).click();
      const editor = page.getByRole("textbox", { name: "Artifact content" });

      for (const invalid of invalidCases) {
        await editor.fill(invalid.content);
        const reviewResponse = page.waitForResponse((candidate) => candidate.url().endsWith("/api/management/saves/review"));
        await page.getByRole("button", { name: "Review save" }).click();
        const rejected = await reviewResponse;
        const body = await rejected.text();
        const error = JSON.parse(body).error;
        assert.equal(rejected.status(), 422);
        assert.equal(error.code, "json-invalid");
        assert.deepEqual(error.technicalDetails, { line: invalid.line, column: invalid.column });
        assert.doesNotMatch(body, /bad|😀|original|not valid JSON at position|Unexpected/);
        assert.match(await page.getByRole("alert").innerText(), new RegExp(`Line ${invalid.line}, column ${invalid.column}`));
      }

      await editor.fill("true\n");
      await page.getByRole("button", { name: "Review save" }).click();
      assert.equal(await page.getByTestId("save-validation").innerText(), "Valid JSON");
      assert.equal(await readFile(jsonPath, "utf8"), "{\"original\":true}\n");
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("oversized multibyte Pending Edit stays dirty and becomes reviewable again at exactly one MiB", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-pending-size-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const projectRoot = join(workspace, "project");
  const policyRoot = join(projectRoot, ".agents", "skills", "policy");
  const textPath = join(policyRoot, "sized.txt");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(policyRoot, { recursive: true });
    await writeFile(textPath, "small\n");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Project configuration" }).click();
      await page.getByRole("button", { name: /project.*Project Root/i }).click();
      await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();
      await page.getByText("sized.txt", { exact: true }).click();
      const editor = page.getByRole("textbox", { name: "Artifact content" });
      const reviewSave = page.getByRole("button", { name: "Review save" });

      const oversized = "é".repeat(524_289);
      await editor.fill(oversized);
      assert.equal(await editor.inputValue(), oversized);
      assert.equal(await reviewSave.isDisabled(), true);
      assert.match(await page.getByTestId("editor-status").innerText(), /Pending Edit too large/);
      assert.equal(await readFile(textPath, "utf8"), "small\n");

      const exact = "é".repeat(524_288);
      await editor.fill(exact);
      assert.equal(await reviewSave.isEnabled(), true);
      assert.match(await page.getByTestId("editor-status").innerText(), /Unsaved changes/);
      await reviewSave.click();
      assert.equal(await page.getByTestId("save-validation").innerText(), "No validation required");
      assert.equal(await readFile(textPath, "utf8"), "small\n");
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("mixed CRLF and LF separators remain byte-exact when editing line content", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-mixed-newlines-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const projectRoot = join(workspace, "project");
  const artifactPath = join(projectRoot, "AGENTS.md");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await writeFile(artifactPath, "alpha\r\nbeta\ngamma\r\n");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Project configuration" }).click();
      await page.getByRole("button", { name: /project.*Project Root/i }).click();
      await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();
      await page.getByText("AGENTS.md", { exact: true }).click();
      assert.equal(await page.getByTestId("editor-status").innerText(), "Saved");
      const editor = page.getByRole("textbox", { name: "Artifact content" });
      assert.equal(await editor.inputValue(), "alpha\nbeta\ngamma\n");
      await editor.fill("ALPHA\nBETA\nGAMMA\n");
      const reviewResponse = page.waitForResponse((candidate) => candidate.url().endsWith("/api/management/saves/review"));
      await page.getByRole("button", { name: "Review save" }).click();
      assert.equal((await reviewResponse).status(), 200);
      await page.getByRole("dialog", { name: "Save Review" }).getByRole("button", { name: "Confirm save" }).click();
      await page.getByTestId("editor-status").getByText("Saved", { exact: true }).waitFor();
      assert.deepEqual(await readFile(artifactPath), Buffer.from("ALPHA\r\nBETA\nGAMMA\r\n"));
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("mixed newline Pending Edit size uses the exact encoded byte count in the browser", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-mixed-size-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const projectRoot = join(workspace, "project");
  const policyRoot = join(projectRoot, ".agents", "skills", "policy");
  const artifactPath = join(policyRoot, "mixed.txt");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(policyRoot, { recursive: true });
    await writeFile(artifactPath, "\r\n".repeat(300_000) + "\n");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Project configuration" }).click();
      await page.getByRole("button", { name: /project.*Project Root/i }).click();
      await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();
      await page.getByText("mixed.txt", { exact: true }).click();
      const editor = page.getByRole("textbox", { name: "Artifact content" });
      const encodedLimit = "x".repeat(448_575) + "\n".repeat(300_001);
      const setEditorContent = async (content: string) => editor.evaluate((element, value) => {
        const textarea = element as HTMLTextAreaElement;
        textarea.value = value;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }, content);
      await setEditorContent(`x${encodedLimit}`);
      assert.equal(await page.getByRole("button", { name: "Review save" }).isDisabled(), true);
      assert.match(await page.getByTestId("editor-status").innerText(), /Pending Edit too large/);
      await setEditorContent(encodedLimit);
      assert.equal(await page.getByRole("button", { name: "Review save" }).isEnabled(), true);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("visible identity controls symlink format while broken outside and unsupported artifacts expose no content", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-symlink-policy-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const projectRoot = join(workspace, "project");
  const policyRoot = join(projectRoot, ".agents", "skills", "policy");
  const targetA = join(projectRoot, "target-without-extension");
  const targetB = join(projectRoot, "second-target");
  const editableLink = join(policyRoot, "visible.ts");
  const outsideTarget = join(fixtureRoot, "OUTSIDE_SECRET.txt");
  const outsideLink = join(policyRoot, "outside.ts");
  const brokenLink = join(policyRoot, "broken.ts");
  const unsupported = join(policyRoot, "unsupported.bin");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(policyRoot, { recursive: true });
    await writeFile(targetA, "first target\n");
    await writeFile(targetB, "second target\n");
    await writeFile(outsideTarget, "OUTSIDE_SECRET\n");
    await writeFile(unsupported, "UNSUPPORTED_SECRET\n");
    await symlink(targetA, editableLink);
    await symlink(outsideTarget, outsideLink);
    await symlink(join(fixtureRoot, "missing-target"), brokenLink);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Project configuration" }).click();
      await page.getByRole("button", { name: /project.*Project Root/i }).click();
      await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();

      await page.getByText("visible.ts", { exact: true }).click();
      assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).inputValue(), "first target\n");
      assert.match(await page.getByTestId("management-detail").innerText(), /TypeScript/);
      await page.getByRole("textbox", { name: "Artifact content" }).fill("pending\n");
      await rm(editableLink);
      await symlink(targetB, editableLink);
      const retargetResponse = page.waitForResponse((candidate) => candidate.url().endsWith("/api/management/saves/review"));
      await page.getByRole("button", { name: "Review save" }).click();
      const retargetRejected = await retargetResponse;
      assert.equal(retargetRejected.status(), 409);
      assert.equal((await retargetRejected.json()).error.code, "artifact-changed");
      assert.equal(await readFile(targetA, "utf8"), "first target\n");
      assert.equal(await readFile(targetB, "utf8"), "second target\n");
      await page.getByTestId("close-editor").click();
      await page.getByRole("dialog", { name: "Unsaved changes" }).getByRole("button", { name: "Discard" }).click();

      for (const [name, status, code, secret] of [
        ["outside.ts", 403, "artifact-outside-boundary", "OUTSIDE_SECRET"],
        ["broken.ts", 422, "artifact-not-editable", "OUTSIDE_SECRET"],
        ["unsupported.bin", 415, "format-unsupported", "UNSUPPORTED_SECRET"],
      ] as const) {
        const openResponse = page.waitForResponse((candidate) => candidate.url().endsWith("/api/management/artifacts/open"));
        await page.getByText(name, { exact: true }).click();
        const rejected = await openResponse;
        const body = await rejected.text();
        assert.equal(rejected.status(), status);
        assert.equal(JSON.parse(body).error.code, code);
        if (code === "format-unsupported") assert.match(JSON.parse(body).error.message, /Supported extensions:.*\.rules.*\.py.*\.ts/);
        assert.doesNotMatch(body, new RegExp(secret));
        assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).count(), 0);
        assert.equal(await page.getByRole("button", { name: `Reveal ${name} in Finder` }).isEnabled(), true);
      }
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("Save Review rejects artifacts whose bytes, existence, type, or permissions changed after Open", async () => {
  const cases = ["bytes", "missing", "type", "permissions"] as const;
  for (const changed of cases) {
    const fixtureRoot = await mkdtemp(join(tmpdir(), `harness-config-save-conflict-${changed}-`));
    const home = join(fixtureRoot, "home");
    const workspace = join(fixtureRoot, "workspace");
    const agentsPath = join(home, ".codex", "AGENTS.md");
    const original = "# Original\n";
    const pending = "# Pending edit must not win\n";
    const external = "EXTERNAL_SECRET_CHANGE\n";

    try {
      await mkdir(join(home, ".codex"), { recursive: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(agentsPath, original, { mode: 0o640 });
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

        if (changed === "bytes") await writeFile(agentsPath, external);
        if (changed === "missing") await rm(agentsPath);
        if (changed === "type") {
          await rm(agentsPath);
          await mkdir(agentsPath);
        }
        if (changed === "permissions") await chmod(agentsPath, 0o600);

        const reviewResponse = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/review"));
        await page.getByRole("button", { name: "Review save" }).click();
        const response = await reviewResponse;
        const responseBody = await response.text();
        assert.equal(response.status(), 409);
        assert.equal(JSON.parse(responseBody).error.code, "artifact-changed");
        assert.doesNotMatch(responseBody, /Pending edit must not win|EXTERNAL_SECRET_CHANGE|# Original/);
        await page.getByText("artifact-changed", { exact: true }).waitFor();

        if (changed === "bytes") assert.equal(await readFile(agentsPath, "utf8"), external);
        if (changed === "missing") await assert.rejects(stat(agentsPath));
        if (changed === "type") assert.equal((await stat(agentsPath)).isDirectory(), true);
        if (changed === "permissions") {
          assert.equal(await readFile(agentsPath, "utf8"), original);
          assert.equal((await stat(agentsPath)).mode & 0o7777, 0o600);
        }
        await assert.rejects(stat(join(home, ".harness_config_studio")));
      } finally {
        await browser.close();
        await running.close();
      }
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }
});

test("dirty guards offer Save, Discard, and Cancel before switching, closing, or refreshing", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-dirty-guards-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const globalPath = join(home, ".codex", "AGENTS.md");
  const projectRoot = join(workspace, "project");
  const original = "# Original\n";
  const saved = "# Saved through guard\n";

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await writeFile(globalPath, original);
    await writeFile(join(projectRoot, "AGENTS.md"), "# Project\n");
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
      await editor.fill("# Pending\n");
      assert.equal(await page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        return window.dispatchEvent(event);
      }), false);

      await page.getByRole("heading", { name: "Project configuration" }).click();
      await page.getByRole("button", { name: /project.*Project Root/i }).click();
      const dirtyGuard = page.getByRole("dialog", { name: "Unsaved changes" });
      await dirtyGuard.waitFor();
      await dirtyGuard.getByRole("button", { name: "Cancel" }).click();
      assert.equal(await editor.inputValue(), "# Pending\n");
      assert.equal(await readFile(globalPath, "utf8"), original);

      await page.getByTestId("close-editor").click();
      await dirtyGuard.getByRole("button", { name: "Discard" }).click();
      assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).count(), 0);
      assert.equal(await readFile(globalPath, "utf8"), original);

      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).click();
      await page.getByRole("textbox", { name: "Artifact content" }).fill(saved);
      await page.getByTestId("refresh").click();
      await dirtyGuard.getByRole("button", { name: "Save changes" }).click();
      const review = page.getByRole("dialog", { name: "Save Review" });
      const saveResponse = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      await review.getByRole("button", { name: "Confirm save" }).click();
      assert.equal((await saveResponse).status(), 200);
      await page.locator('#app[data-state="ready"]').waitFor();
      assert.equal(await readFile(globalPath, "utf8"), saved);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("saving a Markdown symlink preserves the link, target mode, CRLF bytes, and exact backup", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-save-crlf-link-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const artifactPath = join(home, ".codex", "AGENTS.md");
  const targetPath = join(home, ".codex", "shared.md");
  const original = Buffer.from("# Original\r\nSecond\r\n", "utf8");
  const saved = Buffer.from("# Updated\r\nSecond\r\n", "utf8");

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(targetPath, original, { mode: 0o640 });
    await symlink(targetPath, artifactPath);
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
      assert.equal(await editor.inputValue(), "# Original\nSecond\n");
      const reviewSave = page.getByRole("button", { name: "Review save" });
      assert.equal(await reviewSave.isDisabled(), true);
      await editor.click();
      assert.equal(await reviewSave.isDisabled(), true);
      assert.match(await page.getByTestId("editor-status").innerText(), /Saved/);
      await editor.press("Meta+S");
      assert.equal(await page.getByRole("dialog", { name: "Save Review" }).count(), 0);
      await editor.fill("# Updated\nSecond\n");
      await reviewSave.click();
      assert.match(await page.getByRole("dialog", { name: "Save Review" }).innerText(), /CRLF/);
      const saveResponse = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      await page.getByRole("button", { name: "Confirm save" }).click();
      assert.equal((await saveResponse).status(), 200);

      assert.equal((await lstat(artifactPath)).isSymbolicLink(), true);
      assert.deepEqual(await readFile(targetPath), saved);
      assert.equal((await stat(targetPath)).mode & 0o7777, 0o640);
      const backupRoot = join(home, ".harness_config_studio", "backups");
      const backupEntries = await readdir(backupRoot, { recursive: true });
      const backup = backupEntries.find((entry) => entry.endsWith(".bak"));
      assert.ok(backup);
      assert.deepEqual(await readFile(join(backupRoot, backup)), original);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("save rejects a symbolic-link Application Data Root without touching the artifact or link target", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-unsafe-backup-root-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const outside = join(fixtureRoot, "outside");
  const agentsPath = join(home, ".codex", "AGENTS.md");
  const original = "# Original\n";

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(outside);
    await writeFile(agentsPath, original);
    await symlink(outside, join(home, ".harness_config_studio"));
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).click();
      await page.getByRole("textbox", { name: "Artifact content" }).fill("# Must not save\n");
      await page.getByRole("button", { name: "Review save" }).click();

      const saveResponse = page.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      await page.getByRole("button", { name: "Confirm save" }).click();
      const rejected = await saveResponse;
      const body = await rejected.text();
      assert.equal(rejected.status(), 409);
      assert.equal(JSON.parse(body).error.code, "application-data-unsafe");
      assert.doesNotMatch(body, /Original|Must not save/);
      assert.equal(await readFile(agentsPath, "utf8"), original);
      assert.deepEqual(await readdir(outside), []);
      assert.equal((await lstat(join(home, ".harness_config_studio"))).isSymbolicLink(), true);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("Save Review accepts the one MiB boundary and returns content-free 413 errors above it", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-save-limit-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const agentsPath = join(home, ".codex", "AGENTS.md");

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(agentsPath, "# Small\n");
    const artifactIdentity = join(await realpath(home), ".codex", "AGENTS.md");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
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
      const openedResponse = await api.post(`${running.url}/api/management/artifacts/open`, { data: { artifactIdentity } });
      assert.equal(openedResponse.status(), 200);
      const opened = await openedResponse.json() as { editHandle: string; editRevision: string };
      const exactLimit = "x".repeat(1_048_576);
      const accepted = await api.post(`${running.url}/api/management/saves/review`, {
        data: { editHandle: opened.editHandle, editRevision: opened.editRevision, content: exactLimit },
      });
      assert.equal(accepted.status(), 200);

      const escapedAtLimit = "\u0001".repeat(1_048_576);
      const escapedAccepted = await api.post(`${running.url}/api/management/saves/review`, {
        data: { editHandle: opened.editHandle, editRevision: opened.editRevision, content: escapedAtLimit },
      });
      assert.equal(escapedAccepted.status(), 200);

      const secret = "OVERSIZE_SECRET";
      const rejected = await api.post(`${running.url}/api/management/saves/review`, {
        data: { editHandle: opened.editHandle, editRevision: opened.editRevision, content: secret + "x".repeat(1_048_576) },
      });
      const rejectedBody = await rejected.text();
      assert.equal(rejected.status(), 413);
      assert.equal(JSON.parse(rejectedBody).error.code, "edited-content-too-large");
      assert.doesNotMatch(rejectedBody, new RegExp(secret));

      const transportRejected = await api.post(`${running.url}/api/management/saves/review`, {
        data: { editHandle: opened.editHandle, editRevision: opened.editRevision, content: secret + "\u0001".repeat(1_420_000) },
      });
      const transportBody = await transportRejected.text();
      assert.equal(transportRejected.status(), 413);
      assert.equal(JSON.parse(transportBody).error.code, "request-too-large");
      assert.doesNotMatch(transportBody, new RegExp(secret));
    } finally {
      await api.dispose();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("a reviewed save becomes stale when another page commits the same Edit Revision first", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-save-race-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const agentsPath = join(home, ".codex", "AGENTS.md");

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(agentsPath, "# Original\n");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const pages = await Promise.all([browser.newPage(), browser.newPage()]);
      for (const [index, page] of pages.entries()) {
        await page.goto(running.url);
        await page.locator('#app[data-state="ready"]').waitFor();
        await page.getByRole("heading", { name: "Global configuration" }).click();
        await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
        await page.getByRole("button", { name: /AGENTS\.md.*instructions/i }).click();
        await page.getByRole("textbox", { name: "Artifact content" }).fill(`# Page ${index + 1}\n`);
        await page.getByRole("button", { name: "Review save" }).click();
        await page.getByRole("dialog", { name: "Save Review" }).waitFor();
      }

      const firstResponse = pages[0]!.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      await pages[0]!.getByRole("button", { name: "Confirm save" }).click();
      assert.equal((await firstResponse).status(), 200);

      const secondResponse = pages[1]!.waitForResponse((response) => response.url().endsWith("/api/management/saves/apply"));
      await pages[1]!.getByRole("button", { name: "Confirm save" }).click();
      const rejected = await secondResponse;
      assert.equal(rejected.status(), 409);
      assert.equal((await rejected.json()).error.code, "artifact-changed");
      assert.equal(await readFile(agentsPath, "utf8"), "# Page 1\n");
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("two Save Reviews for one open handle cannot both commit", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-save-review-race-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const agentsPath = join(home, ".codex", "AGENTS.md");

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(agentsPath, "# Original\n");
    const artifactIdentity = join(await realpath(home), ".codex", "AGENTS.md");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
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
      const review = async (content: string) => (await api.post(`${running.url}/api/management/saves/review`, {
        data: { editHandle: opened.editHandle, editRevision: opened.editRevision, content },
      })).json() as Promise<{ reviewId: string }>;
      const first = await review("# First\n");
      const second = await review("# Second\n");

      const firstSave = await api.post(`${running.url}/api/management/saves/apply`, { data: { reviewId: first.reviewId } });
      assert.equal(firstSave.status(), 200);
      const secondSave = await api.post(`${running.url}/api/management/saves/apply`, { data: { reviewId: second.reviewId } });
      assert.equal(secondSave.status(), 409);
      assert.equal((await secondSave.json()).error.code, "save-review-stale");
      assert.equal(await readFile(agentsPath, "utf8"), "# First\n");
    } finally {
      await api.dispose();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("Artifact Explorer exposes complete truncated directory and file names on hover", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-artifact-tooltip-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const directoryName = 'skill-"quoted"-&-very-long-configuration-directory-name';
  const fileName = 'guide-"quoted"-&-very-long-configuration-file-name.md';
  const skillDirectory = join(home, ".agents", "skills", directoryName);

  try {
    await mkdir(skillDirectory, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(skillDirectory, "SKILL.md"), "# Skill\n");
    await writeFile(join(skillDirectory, fileName), "# Guide\n");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByTestId("toggle-sections").click();
      await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();
      const explorer = page.getByRole("tree", { name: "Agent Configuration Artifacts" });
      for (const name of [directoryName, fileName]) {
        const label = explorer.getByText(name, { exact: true });
        assert.ok(await label.evaluate((element) => element.scrollWidth > element.clientWidth));
        await label.hover();
        assert.equal(await label.getAttribute("title"), name);
      }
      assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).count(), 0);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("the Artifact Explorer groups roots, sorts directory children, identifies file types, and keeps linked directories as leaves", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-artifact-tree-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const linkedSkillTarget = join(fixtureRoot, "shared-skill-target");

  try {
    await mkdir(join(home, ".codex", "rules"), { recursive: true });
    await mkdir(join(home, ".agents", "skills", "Alpha"), { recursive: true });
    await mkdir(join(home, ".agents", "skills", "zulu"), { recursive: true });
    await mkdir(join(home, ".claude"), { recursive: true });
    await mkdir(linkedSkillTarget, { recursive: true });
    await mkdir(join(workspace, "project", ".git"), { recursive: true });
    await writeFile(join(home, ".codex", "AGENTS.md"), "# Global\n");
    await writeFile(join(home, ".codex", "config.toml"), "model = 'test'\n");
    await writeFile(join(home, ".codex", "rules", "default.rules"), "allow\n");
    await writeFile(join(home, ".agents", "skills", "Alpha", "SKILL.md"), "# Alpha\n");
    await writeFile(join(home, ".agents", "skills", "Alpha", "config.yaml"), "enabled: true\n");
    await writeFile(join(home, ".agents", "skills", "zulu", "SKILL.md"), "# Zulu\n");
    await writeFile(join(home, ".claude", "settings.json"), "{}\n");
    await writeFile(join(linkedSkillTarget, "TARGET_ONLY.md"), "# Must stay outside the tree\n");
    await writeFile(join(workspace, "project", "AGENTS.md"), "# Project\n");
    await symlink(linkedSkillTarget, join(home, ".agents", "skills", "shared"));

    const canonicalHome = await realpath(home);
    const canonicalWorkspace = await realpath(workspace);
    const codexRoot = join(canonicalHome, ".codex");
    const agentsRoot = join(canonicalHome, ".agents");
    const skillsRoot = join(agentsRoot, "skills");
    const alphaSkill = join(skillsRoot, "Alpha");
    const linkedSkill = join(skillsRoot, "shared");
    const projectRoot = join(canonicalWorkspace, "project");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByTestId("toggle-sections").click();

      const explorer = page.getByRole("tree", { name: "Agent Configuration Artifacts" });
      await explorer.waitFor();
      assert.equal(await explorer.locator(`[data-tree-path="${agentsRoot}"]`).count(), 1);
      assert.equal(await explorer.locator(`[data-tree-path="${codexRoot}"]`).count(), 1);
      assert.equal(await explorer.locator(`[data-tree-path="${projectRoot}"]`).count(), 1);

      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      const codexNode = explorer.locator(`[data-tree-path="${codexRoot}"]`);
      const codexChildren = await codexNode.locator(":scope > [role=group] > [role=treeitem] > .artifact-row-main .artifact-name-text").allTextContents();
      const codexDirectChildren = codexNode.locator(":scope > [role=group] > [role=treeitem]");
      assert.deepEqual(codexChildren, ["rules", "AGENTS.md", "config.toml"]);
      assert.equal(await codexDirectChildren.locator(':scope > .artifact-row-main [data-icon-kind="directory"]').count(), 1);
      assert.equal(await codexDirectChildren.locator(':scope > .artifact-row-main [data-icon-kind="markdown"]').count(), 1);
      assert.equal(await codexDirectChildren.locator(':scope > .artifact-row-main [data-icon-kind="toml"]').count(), 1);

      await page.getByRole("button", { name: /\.claude.*Global Root/i }).click();
      const claudeNode = explorer.locator(`[data-tree-path="${join(canonicalHome, ".claude")}"]`);
      assert.equal(await claudeNode.locator(':scope > [role=group] > [role=treeitem] > .artifact-row-main [data-icon-kind="json"]').count(), 1);

      await page.getByRole("button", { name: /\.agents.*Global Root/i }).click();
      const skillsNode = explorer.locator(`[data-tree-path="${skillsRoot}"]`);
      await skillsNode.locator(":scope > .artifact-row-main").click();
      const skillChildren = await skillsNode.locator(":scope > [role=group] > [role=treeitem] > .artifact-row-main .artifact-name-text").allTextContents();
      assert.deepEqual(skillChildren, ["Alpha", "shared", "zulu"]);

      const alphaNode = explorer.locator(`[data-tree-path="${alphaSkill}"]`);
      assert.equal(await alphaNode.getAttribute("aria-expanded"), "false");
      await alphaNode.locator(":scope > .artifact-row-main").click();
      assert.equal(await alphaNode.getAttribute("aria-expanded"), "true");
      assert.equal(await alphaNode.locator(':scope > [role=group] > [role=treeitem] > .artifact-row-main [data-icon-kind="yaml"]').count(), 1);
      await alphaNode.locator(":scope > .artifact-row-main").click();
      assert.equal(await alphaNode.getAttribute("aria-expanded"), "false");
      assert.equal(await alphaNode.getByText("SKILL.md", { exact: true }).count(), 0);
      await alphaNode.locator(":scope > .artifact-row-main").click();
      await alphaNode.getByRole("button", { name: /SKILL\.md.*skills/i }).click();
      assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).inputValue(), "# Alpha\n");

      const linkedNode = explorer.locator(`[data-tree-path="${linkedSkill}"]`);
      assert.equal(await linkedNode.getAttribute("aria-expanded"), null);
      assert.match(await linkedNode.innerText(), new RegExp((await realpath(linkedSkillTarget)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.equal(await explorer.getByText("TARGET_ONLY.md", { exact: true }).count(), 0);
      await linkedNode.locator(":scope > .artifact-row-main").click();
      assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).inputValue(), "# Alpha\n");
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("the browser shows loading, filters harnesses, presents symlinks, and refreshes the snapshot", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-browser-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const target = join(fixtureRoot, "config-target.toml");
  const piRootTarget = join(fixtureRoot, "pi-root-target");

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(join(home, ".claude"), { recursive: true });
    await mkdir(join(home, ".agents", "skills"), { recursive: true });
    await mkdir(join(home, ".pi"), { recursive: true });
    await mkdir(piRootTarget, { recursive: true });
    await symlink(piRootTarget, join(home, ".pi", "agent"));
    await mkdir(join(workspace, "empty-project", ".git"), { recursive: true });
    await mkdir(join(workspace, "group", "too-deep"), { recursive: true });
    await writeFile(target, "model = 'test'");
    await symlink(target, join(home, ".codex", "config.toml"));
    await symlink(join(fixtureRoot, "missing-target"), join(home, ".agents", "skills", "missing"));
    await writeFile(join(home, ".claude", "settings.json"), "{}");
    const running = await startServer({ home, workspace, maxDepth: 1, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      let releaseInventory!: () => void;
      const inventoryGate = new Promise<void>((resolveGate) => { releaseInventory = resolveGate; });
      await page.route("**/api/inventory", async (route) => {
        await inventoryGate;
        await route.continue();
      });
      await page.goto(running.url, { waitUntil: "domcontentloaded" });
      await page.locator('#app[data-state="loading"]').waitFor();
      assert.match(await page.locator("#app").innerText(), /Loading/i);
      releaseInventory();
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("button", { name: "Expand all sections" }).click();
      await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();
      await page.getByRole("button", { name: "Show projects without artifacts" }).click();

      assert.match(await page.locator("body").innerText(), /Harness Config Studio/);
      assert.equal(await page.getByTestId("symlink-icon").count(), 3);
      assert.equal(await page.getByTestId("symlink-target").filter({ hasText: await realpath(target) }).count(), 1);
      assert.equal(await page.getByTestId("symlink-target").filter({ hasText: await realpath(piRootTarget) }).count(), 1);
      assert.equal(await page.getByTestId("symlink-target").filter({ hasText: "Broken target" }).count(), 1);
      assert.match(await page.locator("body").innerText(), /settings\.json/);
      assert.match(await page.locator("body").innerText(), /Scan warnings/);
      assert.match(await page.locator("body").innerText(), /depth-limit/);
      assert.match(await page.locator("body").innerText(), /empty-project/);

      await page.getByTestId("filter-codex").click();
      assert.equal(await page.getByText("config.toml", { exact: true }).count(), 0);
      assert.equal(await page.getByText("settings.json", { exact: true }).count(), 1);

      const projectRoot = join(workspace, "new-project");
      await mkdir(join(projectRoot, ".git"), { recursive: true });
      await writeFile(join(projectRoot, "AGENTS.md"), "new snapshot");
      await page.getByTestId("refresh").click();
      await page.getByText("AGENTS.md", { exact: true }).waitFor();
      assert.match(await page.locator("body").innerText(), /new-project/);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("the browser exposes inventory failures and recovers with Retry", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-browser-error-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(workspace, { recursive: true });
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    await rm(workspace, { recursive: true, force: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="error"]').waitFor();
      assert.match(await page.locator("#app").innerText(), /could not load|unable to load/i);

      await mkdir(workspace, { recursive: true });
      await page.getByTestId("retry").click();
      await page.locator('#app[data-state="ready"]').waitFor();
      assert.equal(await page.getByTestId("artifact-count").innerText(), "0");
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("the browser starts compact and lets the user expand or collapse every section", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-browser-collapse-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(join(workspace, "project", ".git"), { recursive: true });
    await mkdir(join(workspace, "group", "too-deep"), { recursive: true });
    await writeFile(join(home, ".codex", "config.toml"), "model = 'test'");
    await writeFile(join(workspace, "project", "AGENTS.md"), "project instructions");
    const running = await startServer({ home, workspace, maxDepth: 1, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();

      const sections = page.locator("[data-collapsible]");
      assert.equal(await sections.count() >= 4, true);
      assert.equal(await sections.evaluateAll((nodes) => nodes.every((node) => !(node as HTMLDetailsElement).open)), true);
      assert.equal(await page.getByText("config.toml", { exact: true }).isVisible(), false);
      const compactText = await page.locator("#app").innerText();
      assert.equal(compactText.lastIndexOf("Scan warnings") > compactText.indexOf("Project configuration"), true);
      assert.equal(await page.locator("details.warnings[data-collapsible]").count(), 1);

      await page.getByRole("button", { name: "Expand all sections" }).click();
      assert.equal(await sections.evaluateAll((nodes) => nodes.every((node) => (node as HTMLDetailsElement).open)), true);
      assert.equal(await page.getByText("config.toml", { exact: true }).isVisible(), true);

      await page.getByRole("button", { name: "Collapse all sections" }).click();
      assert.equal(await sections.evaluateAll((nodes) => nodes.every((node) => !(node as HTMLDetailsElement).open)), true);
      assert.equal(await page.getByText("config.toml", { exact: true }).isVisible(), false);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("Project configuration can show or hide Project Roots without artifacts", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-browser-empty-projects-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");

  try {
    await mkdir(home, { recursive: true });
    await mkdir(join(workspace, "empty", ".git"), { recursive: true });
    await mkdir(join(workspace, "configured", ".git"), { recursive: true });
    await writeFile(join(workspace, "configured", "AGENTS.md"), "project instructions");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      const projectSection = page.locator("details.collection").nth(1);
      await page.getByRole("heading", { name: "Project configuration" }).click();

      assert.equal(await page.getByText("configured", { exact: true }).count(), 1);
      assert.equal(await page.getByText("empty", { exact: true }).count(), 0);
      const toggle = page.getByRole("button", { name: "Show projects without artifacts" });
      assert.equal(await toggle.getAttribute("aria-pressed"), "false");

      await toggle.click();
      assert.equal(await page.getByText("empty", { exact: true }).count(), 1);
      const hideToggle = page.getByRole("button", { name: "Hide projects without artifacts" });
      assert.equal(await hideToggle.getAttribute("aria-pressed"), "true");
      assert.equal(await hideToggle.isVisible(), true);
      assert.equal(await projectSection.getAttribute("open"), "");

      await hideToggle.click();
      assert.equal(await page.getByText("empty", { exact: true }).count(), 0);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
