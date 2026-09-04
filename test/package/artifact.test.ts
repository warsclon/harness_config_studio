import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("release smoke retains the exact installed artifact and its launch evidence", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "hcs-retained-package-"));
  const output = join(fixture, "candidate");
  try {
    const child = spawn(process.execPath, ["scripts/package-smoke.mjs", "--retain-dir", output], {
      env: { ...process.env, npm_config_cache: join(fixture, "npm-cache") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let diagnostics = "";
    child.stdout.on("data", (chunk) => { diagnostics += chunk; });
    child.stderr.on("data", (chunk) => { diagnostics += chunk; });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(code, 0, diagnostics);
    const evidence = JSON.parse(await readFile(join(output, "evidence.json"), "utf8"));
    const manifest = JSON.parse(await readFile("package.json", "utf8"));
    const tarball = await readFile(join(output, evidence.tarball.file));
    assert.equal(evidence.package.name, manifest.name);
    assert.equal(evidence.package.version, manifest.version);
    assert.match(evidence.source.commit, /^[a-f0-9]{40}$/);
    assert.equal(evidence.tarball.sha256, createHash("sha256").update(tarball).digest("hex"));
    assert.equal(evidence.checks.installedExecutable, true);
    assert.equal(evidence.checks.offlineExec, true);
    assert.equal(evidence.checks.installedBrowser, true);
    assert.equal(evidence.checks.realFinderTrash, false);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
