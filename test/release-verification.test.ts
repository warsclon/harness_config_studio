import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("the publication verifier binds approval to the tested commit and exact artifact bytes", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "hcs-release-verify-"));
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const commit = "a".repeat(40);
  const bytes = Buffer.from("fixture representing already tested artifact bytes");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const evidence = {
    schemaVersion: 1, package: { name: manifest.name, version: manifest.version },
    source: { commit, clean: true }, tarball: { file: "candidate.tgz", sha256: hash },
    runtime: { node: "v24.20.0", platform: "darwin", arch: "arm64" },
    checks: { installedExecutable: true, offlineExec: true, installedBrowser: true, realFinderTrash: false },
  };
  const verify = (revision = commit, approvedHash = hash) => spawnSync(process.execPath,
    ["scripts/verify-release.mjs", fixture, revision, approvedHash], { encoding: "utf8" });
  try {
    await writeFile(join(fixture, "candidate.tgz"), bytes);
    await writeFile(join(fixture, "evidence.json"), JSON.stringify(evidence));
    const valid = verify();
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(valid.stdout.trim(), join(fixture, "candidate.tgz"));
    assert.notEqual(verify("b".repeat(40)).status, 0);
    assert.notEqual(verify(commit, "b".repeat(64)).status, 0);
    await writeFile(join(fixture, "evidence.json"), JSON.stringify({ ...evidence, source: { commit, clean: false } }));
    assert.notEqual(verify().status, 0);
    await writeFile(join(fixture, "evidence.json"), JSON.stringify(evidence));
    await writeFile(join(fixture, "candidate.tgz"), "substituted artifact");
    assert.notEqual(verify().status, 0);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
