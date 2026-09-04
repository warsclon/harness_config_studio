import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

try {
  const [directory, commit, approvedHash, ...extra] = process.argv.slice(2);
  assert.ok(directory && /^[a-f0-9]{40}$/.test(commit ?? "") && extra.length === 0,
    "Usage: verify-release.mjs DIRECTORY COMMIT [APPROVED_SHA256]");
  if (approvedHash !== undefined) assert.match(approvedHash, /^[a-f0-9]{64}$/, "Invalid approved SHA-256");
  const evidence = JSON.parse(await readFile(join(directory, "evidence.json"), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(evidence.schemaVersion, 1);
  assert.deepEqual(evidence.package, { name: manifest.name, version: manifest.version });
  assert.equal(evidence.source.commit, commit, "Candidate source does not match the selected commit");
  assert.equal(evidence.source.clean, true, "Candidate was built from an uncommitted working tree");
  for (const check of ["installedExecutable", "offlineExec", "installedBrowser"]) {
    assert.equal(evidence.checks[check], true, `Missing successful check: ${check}`);
  }
  assert.equal(evidence.runtime.platform, "darwin");
  assert.match(evidence.runtime.node, /^v(?:22|24)\./);
  assert.match(evidence.tarball.file, /^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/);
  assert.match(evidence.tarball.sha256, /^[a-f0-9]{64}$/);
  const tarball = resolve(directory, evidence.tarball.file);
  assert.equal((await lstat(tarball)).isFile(), true, "Candidate must be a regular file");
  const actualHash = createHash("sha256").update(await readFile(tarball)).digest("hex");
  assert.equal(actualHash, evidence.tarball.sha256, "Candidate bytes differ from installed-package evidence");
  if (approvedHash !== undefined) assert.equal(actualHash, approvedHash, "Candidate differs from the approved artifact");
  process.stdout.write(`${tarball}\n`);
} catch (error) {
  process.stderr.write(`Release verification failed: ${error.message}\n`);
  process.exitCode = 1;
}
