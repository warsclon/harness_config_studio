import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium, request as playwrightRequest } from "playwright";
import { startServer } from "../src/server.ts";
import { FinderGatewayError } from "../src/system-gateway.ts";

type RecordedRevealIntent = Readonly<{
  disposition: "select-item" | "open-directory";
  path: string;
}>;

test("System Reveal selects an inventoried file at its visible Artifact Identity", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-finder-file-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const artifactPath = join(home, ".codex", "config.toml");
  const intents: RecordedRevealIntent[] = [];
  const systemGateway = {
    async reveal(intent: RecordedRevealIntent): Promise<void> {
      intents.push(structuredClone(intent));
    },
  };

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(artifactPath, "model = 'test'");
    const artifactIdentity = join(await realpath(home), ".codex", "config.toml");
    const running = await startServer({
      home,
      workspace,
      preferredPort: 0,
      strictPort: true,
      systemGateway,
    });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      assert.equal(await page.getByTestId("reveal-application-data").count(), 0);
      await assert.rejects(lstat(join(await realpath(home), ".harness_config_studio")));
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();

      const reveal = page.getByRole("button", { name: "Reveal config.toml in Finder" });
      assert.equal(await reveal.count(), 1);
      await reveal.locator("..").hover();
      await reveal.click();
      await page.getByText("Asked Finder to select config.toml.", { exact: true }).waitFor();
      assert.deepEqual(intents, [{ disposition: "select-item", path: artifactIdentity }]);

      await rm(artifactPath);
      await reveal.locator("..").hover();
      await reveal.click();
      await page.getByText(/reveal-target-not-found: The selected location is not in the current Inventory\./).waitFor();
      assert.deepEqual(intents, [{ disposition: "select-item", path: artifactIdentity }]);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("System Reveal opens real artifact directories and selects every symbolic link at its visible path", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-finder-links-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const linkTarget = join(fixtureRoot, "shared-config.toml");
  const directoryTarget = join(fixtureRoot, "shared-prompts");
  const intents: RecordedRevealIntent[] = [];
  const systemGateway = { async reveal(intent: RecordedRevealIntent) { intents.push(structuredClone(intent)); } };

  try {
    await mkdir(join(home, ".codex", "rules"), { recursive: true });
    await mkdir(directoryTarget, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(linkTarget, "model = 'shared'");
    await writeFile(join(home, ".codex", "rules", "default.rules"), "allow");
    await symlink(linkTarget, join(home, ".codex", "config.toml"));
    await symlink(directoryTarget, join(home, ".codex", "prompts"));
    await symlink(join(fixtureRoot, "missing-instructions"), join(home, ".codex", "AGENTS.md"));
    const canonicalRoot = join(await realpath(home), ".codex");
    const canonicalLinkTarget = await realpath(linkTarget);
    const canonicalDirectoryTarget = await realpath(directoryTarget);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();

      for (const name of ["rules", "config.toml", "prompts", "AGENTS.md"]) {
        const reveal = page.getByRole("button", { name: `Reveal ${name} in Finder` });
        await reveal.locator("..").hover();
        await reveal.click();
      }
      await page.getByText("Asked Finder to select AGENTS.md.", { exact: true }).waitFor();
      assert.deepEqual(intents, [
        { disposition: "open-directory", path: join(canonicalRoot, "rules") },
        { disposition: "select-item", path: join(canonicalRoot, "config.toml") },
        { disposition: "select-item", path: join(canonicalRoot, "prompts") },
        { disposition: "select-item", path: join(canonicalRoot, "AGENTS.md") },
      ]);
      assert.equal(intents.some((intent) => intent.path === canonicalLinkTarget), false);
      assert.equal(intents.some((intent) => intent.path === canonicalDirectoryTarget), false);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("System Reveal opens Managed Skill Directories and an existing Application Data Root", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-finder-managed-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const intents: RecordedRevealIntent[] = [];
  const systemGateway = { async reveal(intent: RecordedRevealIntent) { intents.push(structuredClone(intent)); } };

  try {
    await mkdir(join(home, ".agents", "skills", "my-skill", "assets"), { recursive: true });
    await mkdir(join(home, ".agents", "skills", ".hidden"), { recursive: true });
    await mkdir(join(home, ".harness_config_studio"), { recursive: true, mode: 0o700 });
    await mkdir(join(workspace, "too", "deep"), { recursive: true });
    await writeFile(join(home, ".agents", "skills", "my-skill", "SKILL.md"), "# Test skill");
    const canonicalHome = await realpath(home);
    const skillPath = join(canonicalHome, ".agents", "skills", "my-skill");
    const appDataPath = join(canonicalHome, ".harness_config_studio");
    const running = await startServer({
      home,
      workspace,
      maxDepth: 0,
      preferredPort: 0,
      strictPort: true,
      systemGateway,
    });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.agents.*Global Root/i }).click();
      await page.getByRole("button", { name: "Expand all artifact directories", exact: true }).click();
      const revealSkill = page.getByRole("button", { name: "Reveal my-skill in Finder" });
      await revealSkill.locator("..").hover();
      await revealSkill.click();
      await page.getByText("Asked Finder to open my-skill.", { exact: true }).waitFor();

      await rm(workspace, { recursive: true, force: true });
      await page.getByTestId("reveal-application-data").click();
      await page.getByText("Asked Finder to open .harness_config_studio.", { exact: true }).waitFor();
      await mkdir(workspace, { recursive: true });

      const managedResponses = await page.evaluate(async ({ skillPath }) => {
        const capability = document.querySelector('meta[name="hcs-session-capability"]')?.getAttribute("content") || "";
        const call = async (target: unknown) => {
          const response = await fetch("/api/management/reveal", {
            method: "POST",
            headers: { "content-type": "application/json", "x-harness-config-capability": capability },
            body: JSON.stringify({ target }),
          });
          return { status: response.status, payload: await response.json() };
        };
        return Promise.all([
          call({ kind: "managed-skill-directory", path: skillPath }),
          call({ kind: "managed-skill-directory", path: skillPath + "/assets" }),
          call({ kind: "warning", path: skillPath }),
        ]);
      }, { skillPath });

      assert.equal(managedResponses[0]?.status, 200);
      assert.equal(managedResponses[1]?.status, 422);
      assert.equal(managedResponses[1]?.payload.error.code, "reveal-target-not-eligible");
      assert.equal(managedResponses[2]?.status, 422);
      assert.equal(managedResponses[2]?.payload.error.code, "reveal-target-not-eligible");
      const warnings = page.locator("details.warnings");
      assert.equal(await warnings.getByRole("button", { name: /Reveal/i }).count(), 0);
      assert.deepEqual(intents, [
        { disposition: "open-directory", path: skillPath },
        { disposition: "open-directory", path: appDataPath },
        { disposition: "open-directory", path: skillPath },
      ]);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("System Reveal opens inventoried Global Roots and Project Roots", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-finder-roots-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const project = join(workspace, "project");
  const intents: RecordedRevealIntent[] = [];
  const systemGateway = {
    async reveal(intent: RecordedRevealIntent): Promise<void> {
      intents.push(structuredClone(intent));
    },
  };

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(join(project, ".git"), { recursive: true });
    await writeFile(join(project, "AGENTS.md"), "project instructions");
    const canonicalHome = await realpath(home);
    const canonicalWorkspace = await realpath(workspace);
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();

      const revealGlobal = page.getByRole("button", { name: "Reveal .codex in Finder" });
      assert.equal(await revealGlobal.count(), 1);
      await revealGlobal.click();
      await page.getByText("Asked Finder to open .codex.", { exact: true }).waitFor();

      await page.getByRole("heading", { name: "Project configuration" }).click();
      const revealProject = page.getByRole("button", { name: "Reveal project in Finder" });
      assert.equal(await revealProject.count(), 1);
      await revealProject.click();
      await page.getByText("Asked Finder to open project.", { exact: true }).waitFor();

      assert.deepEqual(intents, [
        { disposition: "open-directory", path: join(canonicalHome, ".codex") },
        { disposition: "open-directory", path: join(canonicalWorkspace, "project") },
      ]);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("System Reveal requires the session capability plus exact Origin and Host", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-finder-security-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const intents: RecordedRevealIntent[] = [];
  const systemGateway = { async reveal(intent: RecordedRevealIntent) { intents.push(structuredClone(intent)); } };

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(home, ".codex", "config.toml"), "SECRET_CONFIG_TEXT");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      const capability = await page.locator('meta[name="hcs-session-capability"]').getAttribute("content");
      assert.ok(capability);
      const host = new URL(running.url).host;
      const validHeaders = {
        Host: host,
        Origin: running.url,
        "x-harness-config-capability": capability,
      };
      const defaultTarget = { kind: "artifact", artifactIdentity: join(await realpath(home), ".codex", "config.toml") };
      const callReveal = async (
        headers: Record<string, string>,
        target: unknown = defaultTarget,
        method = "POST",
      ) => {
        const api = await playwrightRequest.newContext({ extraHTTPHeaders: headers });
        try {
          const response = await api.fetch(`${running.url}/api/management/reveal`, { method, data: { target } });
          return { status: response.status(), payload: JSON.parse(await response.text()) };
        } finally {
          await api.dispose();
        }
      };
      const expectSafeError = (response: Awaited<ReturnType<typeof callReveal>>, status: number, code: string) => {
        assert.equal(response.status, status);
        assert.equal(response.payload.error.code, code);
        assert.equal(response.payload.error.action, "system-reveal");
        assert.doesNotMatch(JSON.stringify(response.payload), /SECRET_CONFIG_TEXT/);
      };

      expectSafeError(await callReveal({ Host: host, Origin: running.url }), 401, "capability-required");
      expectSafeError(await callReveal({ ...validHeaders, "x-harness-config-capability": "wrong" }), 401, "capability-invalid");
      expectSafeError(await callReveal({ ...validHeaders, Origin: "https://example.test" }), 403, "origin-invalid");
      expectSafeError(await callReveal({ ...validHeaders, Host: "example.test" }), 403, "host-invalid");
      expectSafeError(await callReveal(validHeaders, undefined, "GET"), 405, "method-not-allowed");
      expectSafeError(await callReveal(validHeaders, { kind: "artifact", artifactIdentity: 42 }), 400, "request-invalid");
      expectSafeError(await callReveal(validHeaders, { kind: "warning", path: workspace }), 422, "reveal-target-not-eligible");
      expectSafeError(await callReveal(validHeaders, { kind: "artifact", artifactIdentity: join(workspace, "arbitrary.txt") }), 404, "reveal-target-not-found");
      assert.deepEqual(intents, []);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("System Reveal reports a named Finder failure with safe path context", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-finder-failure-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  let calls = 0;
  const systemGateway = {
    async reveal(): Promise<void> {
      calls += 1;
      throw new FinderGatewayError("finder-unavailable", "Finder is unavailable for this test.", { osCode: "TEST_UNAVAILABLE" });
    },
  };

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(home, ".codex", "config.toml"), "SECRET_FAILURE_TEXT");
    const artifactIdentity = join(await realpath(home), ".codex", "config.toml");
    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true, systemGateway });
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await page.goto(running.url);
      await page.locator('#app[data-state="ready"]').waitFor();
      await page.getByRole("heading", { name: "Global configuration" }).click();
      await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
      const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/management/reveal"));
      const reveal = page.getByRole("button", { name: "Reveal config.toml in Finder" });
      await reveal.locator("..").hover();
      await reveal.click();
      const response = await responsePromise;
      const payload = await response.json();

      assert.equal(response.status(), 503);
      assert.deepEqual(payload.error, {
        code: "finder-unavailable",
        message: "Finder is unavailable for this test.",
        action: "system-reveal",
        path: artifactIdentity,
        technicalDetails: { osCode: "TEST_UNAVAILABLE" },
      });
      assert.doesNotMatch(JSON.stringify(payload), /SECRET_FAILURE_TEXT/);
      await page.getByText("finder-unavailable: Finder is unavailable for this test.", { exact: true }).waitFor();
      assert.equal(calls, 1);
    } finally {
      await browser.close();
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
