import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { terminateChild } from "./process-lifecycle.mjs";

const root = process.cwd();
const temporaryRoot = await mkdtemp(join(tmpdir(), "harness-config-package-smoke-"));
const sourceManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const expectedVersion = sourceManifest.version;

function runNpm(args, options = {}) {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : "npm";
  const commandArgs = npmCli ? [npmCli, ...args] : args;
  return spawnSync(command, commandArgs, { cwd: root, encoding: "utf8", ...options });
}

function assertSuccessful(execution, label) {
  assert.equal(
    execution.status,
    0,
    `${label} failed\nstdout:\n${execution.stdout ?? ""}\nstderr:\n${execution.stderr ?? ""}`,
  );
}

function runInstalledCli(cliPath, args, env) {
  const execution = spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env,
  });
  assertSuccessful(execution, `installed harness-config ${args.join(" ")}`);
  assert.equal(execution.stderr, "");
  return execution.stdout;
}

async function waitForUrl(child) {
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for packaged web server\n${stdout}\n${stderr}`)), 10_000);
    const inspect = () => {
      const match = stdout.match(/URL: (http:\/\/127\.0\.0\.1:\d+)/);
      if (!match?.[1]) return;
      clearTimeout(timeout);
      resolve({ url: match[1], stderr: () => stderr });
    };
    child.stdout.on("data", inspect);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Packaged web server exited before startup (${code})\n${stderr}`));
    });
  });
}

try {
  const packRoot = join(temporaryRoot, "pack");
  const installRoot = join(temporaryRoot, "install");
  const extractedRoot = join(temporaryRoot, "extracted");
  const home = join(temporaryRoot, "home");
  const workspace = join(temporaryRoot, "workspace");
  const unavailableWorkspace = join(temporaryRoot, "workspace-unavailable");
  const trash = join(temporaryRoot, "Trash");
  const longSkillName = "a-very-long-installed-package-skill-name";
  const freshSkillName = "fresh-installed-package-skill";
  const longFileName = "a-very-long-installed-package-guide-name.md";
  const skillDirectory = join(home, ".agents", "skills", longSkillName);
  const freshSkillDirectory = join(home, ".agents", "skills", freshSkillName);
  const linkTarget = join(temporaryRoot, "linked-skill-target");
  await mkdir(packRoot, { recursive: true });
  await mkdir(installRoot, { recursive: true });
  await mkdir(extractedRoot, { recursive: true });
  await mkdir(join(home, ".codex"), { recursive: true });
  await mkdir(skillDirectory, { recursive: true });
  await mkdir(freshSkillDirectory, { recursive: true });
  await mkdir(linkTarget, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await mkdir(trash, { recursive: true });
  await writeFile(join(home, ".codex", "config.toml"), "model = 'package-smoke'\n");
  await writeFile(join(skillDirectory, "SKILL.md"), "# Installed package skill\n");
  await writeFile(join(freshSkillDirectory, "SKILL.md"), "# Fresh installed package skill\n");
  await writeFile(join(skillDirectory, longFileName), "# Installed package guide\n");
  await writeFile(join(linkTarget, "TARGET_ONLY.md"), "# Never traverse\n");
  await symlink(linkTarget, join(home, ".agents", "skills", "linked-skill"));
  const canonicalSkillDirectory = await realpath(skillDirectory);
  const canonicalFreshSkillDirectory = await realpath(freshSkillDirectory);

  const packed = runNpm(["pack", "--json", "--pack-destination", packRoot]);
  assertSuccessful(packed, "npm pack");
  const packReport = JSON.parse(packed.stdout);
  assert.equal(packReport.length, 1);
  assert.equal(packReport[0].version, expectedVersion);
  const packedFiles = packReport[0].files.map((entry) => entry.path).sort();
  assert.ok(packedFiles.includes("package.json"));
  assert.ok(packedFiles.includes("LICENSE"));
  assert.ok(packedFiles.includes("README.md"));
  assert.ok(packedFiles.includes("docs/CLI.md"));
  assert.ok(packedFiles.includes("VERSIONS.md"));
  assert.ok(packedFiles.includes("RELEASE_NOTES.md"));
  assert.ok(packedFiles.some((path) => path.endsWith(".js.map")), "compiled source maps must be packaged");
  for (const path of packedFiles) {
    assert.match(
      path,
      /^(?:package\.json|LICENSE|README\.md|VERSIONS\.md|RELEASE_NOTES\.md|docs\/CLI\.md|dist\/.*\.(?:js|d\.ts|js\.map))$/,
      `unexpected packaged path: ${path}`,
    );
  }

  const tarball = join(packRoot, packReport[0].filename);
  const tarballSha256 = createHash("sha256").update(await readFile(tarball)).digest("hex");
  const extracted = spawnSync("tar", ["-xzf", tarball, "-C", extractedRoot], { encoding: "utf8" });
  assertSuccessful(extracted, "extract packed tarball for content review");
  for (const path of packedFiles.filter((entry) => /\.(?:js|map|json|md|ts)$/.test(entry))) {
    const content = await readFile(join(extractedRoot, "package", path), "utf8");
    assert.doesNotMatch(content, /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bnpm_[A-Za-z0-9]{30,}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b/, `possible credential in ${path}`);
    assert.doesNotMatch(content, /\/(?:Users|home)\/[A-Za-z0-9._-]+\//, `possible private home path in ${path}`);
  }
  const installed = runNpm([
    "install",
    "--prefix",
    installRoot,
    tarball,
    "--ignore-scripts",
    "--omit=dev",
    "--no-audit",
    "--no-fund",
  ]);
  assertSuccessful(installed, "tarball install");
  const installedManifest = JSON.parse(await readFile(join(installRoot, "node_modules", "harness-config-studio", "package.json"), "utf8"));
  assert.equal("private" in installedManifest, false);
  assert.equal(installedManifest.license, "MIT");
  assert.deepEqual(installedManifest.publishConfig, { access: "public" });
  assert.deepEqual(installedManifest.dependencies ?? {}, {});
  assert.equal(installedManifest.version, expectedVersion);

  const cliPath = join(installRoot, "node_modules", "harness-config-studio", "dist", "cli.js");
  assert.ok((await stat(cliPath)).mode & 0o111, "installed CLI must retain an executable mode");
  const environment = { ...process.env, HOME: home };
  assert.equal(runInstalledCli(cliPath, ["--version"], environment), `${expectedVersion}\n`);
  assert.match(
    runInstalledCli(cliPath, ["--help"], environment),
    new RegExp(`^Harness Config Studio ${expectedVersion.replaceAll(".", "\\.")}`),
  );
  const inventory = JSON.parse(runInstalledCli(cliPath, ["inventory", workspace, "--json"], environment));
  assert.equal(inventory.schemaVersion, 1);
  assert.equal("version" in inventory, false);

  const child = spawn(process.execPath, [cliPath, workspace, "--no-open", "--port", "0"], {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const running = await waitForUrl(child);
    const shellResponse = await fetch(running.url);
    assert.equal(shellResponse.status, 200);
    assert.match(
      await shellResponse.text(),
      new RegExp(`Version ${expectedVersion.replaceAll(".", "\\.")}`),
    );
    const inventoryResponse = await fetch(`${running.url}/api/inventory`);
    assert.equal(inventoryResponse.status, 200);
    assert.equal((await inventoryResponse.json()).schemaVersion, 1);
    assert.equal(running.stderr(), "");
  } finally {
    await terminateChild(child);
  }

  const installedServer = await import(pathToFileURL(join(installRoot, "node_modules", "harness-config-studio", "dist", "server.js")).href);
  const revealIntents = [];
  let trashCalls = 0;
  const managed = await installedServer.startServer({
    home,
    workspace,
    preferredPort: 0,
    strictPort: true,
    platform: "darwin",
    systemGateway: {
      async reveal(intent) { revealIntents.push(structuredClone(intent)); },
      async moveToTrash(intent) {
        trashCalls += 1;
        await rename(intent.path, join(trash, basename(intent.path)));
        return {};
      },
      async openTrash() {},
    },
    async afterPrimaryEffectForTest(effect) {
      if (effect.action === "removal" && effect.artifactIdentity === canonicalSkillDirectory) {
        await rename(workspace, unavailableWorkspace);
      }
    },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(managed.url);
    await page.locator('#app[data-state="ready"]').waitFor();
    const helpButton = page.getByRole("button", { name: "Help and keyboard shortcuts", exact: true });
    await helpButton.click();
    const helpDialog = page.getByRole("dialog", { name: "Harness Config Studio help", exact: true });
    await helpDialog.getByRole("heading", { name: "Keyboard shortcuts", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await helpDialog.count(), 0);
    await page.getByTestId("toggle-sections").click();
    await page.getByRole("button", { name: /\.agents.*Global Root/i }).click();
    assert.equal(await page.getByRole("separator").count(), 2);
    const firstSeparator = page.getByRole("separator", { name: "Resize Configuration and Artifacts" });
    const secondSeparator = page.getByRole("separator", { name: "Resize Artifacts and Editor" });
    await firstSeparator.press("ArrowRight");
    assert.equal(await firstSeparator.getAttribute("aria-valuenow"), "286");
    const secondBefore = Number(await secondSeparator.getAttribute("aria-valuenow"));
    await secondSeparator.press("ArrowRight");
    assert.equal(Number(await secondSeparator.getAttribute("aria-valuenow")), secondBefore + 16);
    await page.getByRole("button", { name: "Expand all artifact directories" }).click();
    assert.ok(await page.locator('[data-icon-kind="directory"]').count() > 0);
    assert.ok(await page.locator('[data-icon-kind="markdown"]').count() > 0);
    const longName = page.getByText(longFileName, { exact: true });
    assert.equal(await longName.getAttribute("title"), longFileName);
    assert.equal(await page.getByText("TARGET_ONLY.md", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: /linked-skill symbolic link directory/i }).getByTestId("symlink-icon").count(), 1);

    await longName.click();
    await page.getByRole("button", { name: `Reveal ${longFileName} in Finder`, exact: true }).click();
    await page.getByText(`Asked Finder to select ${longFileName}.`, { exact: true }).waitFor();
    assert.equal(revealIntents.length, 1);
    assert.equal(revealIntents[0].path, join(canonicalSkillDirectory, longFileName));
    const editor = page.getByRole("textbox", { name: "Artifact content" });
    await editor.fill("# Installed package Pending Edit\n");
    await page.getByTestId("editor-status").getByText("Unsaved changes", { exact: true }).waitFor();
    await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
    await page.getByTestId("dirty-cancel").click();
    assert.equal(await editor.inputValue(), "# Installed package Pending Edit\n");
    await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
    await page.getByTestId("dirty-discard").click();
    await page.getByRole("button", { name: /\.agents.*Global Root/i }).click();
    await page.getByRole("button", { name: "Expand all artifact directories" }).click();

    const freshSkillNode = page.locator(`[data-tree-path="${canonicalFreshSkillDirectory}"]`);
    await freshSkillNode.hover();
    await page.getByRole("button", { name: `Move ${freshSkillName} to Trash`, exact: true }).click();
    const freshRemoval = page.getByRole("dialog", { name: "Move skill directory to Trash" });
    await freshRemoval.getByTestId("removal-confirmation").fill(freshSkillName);
    await freshRemoval.getByRole("button", { name: `Move ${freshSkillName} to Trash`, exact: true }).click();
    await freshSkillNode.waitFor({ state: "detached" });
    assert.equal(await page.getByTestId("stale-inventory").count(), 0);
    assert.equal(trashCalls, 1);

    await page.getByRole("button", { name: "Expand all artifact directories" }).click();

    const skillNode = page.locator(`[data-tree-path="${canonicalSkillDirectory}"]`);
    await skillNode.hover();
    await page.getByRole("button", { name: `Move ${longSkillName} to Trash`, exact: true }).click();
    const removal = page.getByRole("dialog", { name: "Move skill directory to Trash" });
    await removal.getByTestId("removal-confirmation").fill(longSkillName);
    await removal.getByRole("button", { name: `Move ${longSkillName} to Trash`, exact: true }).click();
    await page.getByTestId("stale-inventory").waitFor();
    assert.equal(await page.locator(`[data-tree-path="${canonicalSkillDirectory}"]`).count(), 0);
    assert.equal(await page.getByRole("textbox", { name: "Artifact content" }).count(), 0);
    assert.equal(trashCalls, 2);
    await rename(unavailableWorkspace, workspace);
    await page.getByRole("button", { name: "Retry Inventory" }).click();
    await page.getByTestId("stale-inventory").waitFor({ state: "detached" });
    assert.equal(trashCalls, 2);
  } finally {
    await browser.close();
    await managed.close();
  }

  const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim() || "unavailable";
  process.stdout.write([
    `Package smoke passed: packed, allowlisted, installed, browser-exercised, and isolated (sha256 ${tarballSha256}).`,
    `Candidate evidence: package ${sourceManifest.name}@${expectedVersion}; revision ${revision}; runtime ${process.version} (${process.platform}/${process.arch}).`,
    "Automated checks: actual tarball contents and source maps, installed CLI/server/browser, in-app Help, both resizers, controlled Finder reveal, fresh removal reconciliation, stale removal overlay, and retry without repeated Trash.",
    "External checks: real Finder/Trash integration not performed; CI Node 22/24 result pending for the exact committed candidate.",
  ].join("\n") + "\n");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
