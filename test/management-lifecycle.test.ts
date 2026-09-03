import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startServer } from "../src/server.ts";

test("in-memory Open, Save Review, and Removal Preview state stays bounded", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-management-lifecycle-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const artifactPath = join(home, ".codex", "AGENTS.md");
  const skillPaths = Array.from({ length: 33 }, (_, index) => join(home, ".agents", "skills", `skill-${String(index).padStart(2, "0")}`));
  let trashCalls = 0;

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(artifactPath, "# Original\n");
    for (const skillPath of skillPaths) {
      await mkdir(skillPath, { recursive: true });
      await writeFile(join(skillPath, "SKILL.md"), "# Skill\n");
    }
    const canonicalHome = await realpath(home);
    const artifactIdentity = join(canonicalHome, ".codex", "AGENTS.md");
    const canonicalSkills = skillPaths.map((path) => join(canonicalHome, ".agents", "skills", path.split("/").at(-1)!));
    const running = await startServer({
      home,
      workspace,
      preferredPort: 0,
      strictPort: true,
      platform: "darwin",
      systemGateway: { async moveToTrash() { trashCalls += 1; return {}; } },
    });
    try {
      const shell = await (await fetch(running.url)).text();
      const capability = shell.match(/name="hcs-session-capability" content="([^"]+)"/)?.[1];
      assert.ok(capability);
      const call = async (path: string, body: object) => {
        const response = await fetch(`${running.url}${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: running.url,
            "x-harness-config-capability": capability,
          },
          body: JSON.stringify(body),
        });
        return { status: response.status, payload: await response.json() as Record<string, unknown> };
      };

      const opened = [];
      for (let index = 0; index < 33; index += 1) {
        const response = await call("/api/management/artifacts/open", { artifactIdentity });
        assert.equal(response.status, 200);
        opened.push(response.payload);
      }
      const evictedHandle = await call("/api/management/saves/review", {
        editHandle: opened[0]!.editHandle,
        editRevision: opened[0]!.editRevision,
        content: "# Evicted handle\n",
      });
      assert.equal(evictedHandle.status, 409);
      assert.equal((evictedHandle.payload.error as Record<string, unknown>).code, "edit-revision-invalid");

      const saveReviews = [];
      for (let index = 0; index < 33; index += 1) {
        const response = await call("/api/management/saves/review", {
          editHandle: opened.at(-1)!.editHandle,
          editRevision: opened.at(-1)!.editRevision,
          content: `# Pending ${index}\n`,
        });
        assert.equal(response.status, 200);
        saveReviews.push(response.payload);
      }
      const evictedSaveReview = await call("/api/management/saves/apply", { reviewId: saveReviews[0]!.reviewId });
      assert.equal(evictedSaveReview.status, 409);
      assert.equal((evictedSaveReview.payload.error as Record<string, unknown>).code, "save-review-invalid");

      const removalReviews = [];
      for (const skillPath of canonicalSkills) {
        const response = await call("/api/management/removals/preview", { artifactIdentity: skillPath });
        assert.equal(response.status, 200);
        removalReviews.push(response.payload);
      }
      const evictedRemoval = await call("/api/management/removals/apply", {
        removalReviewId: removalReviews[0]!.removalReviewId,
        confirmationName: "skill-00",
      });
      assert.equal(evictedRemoval.status, 409);
      assert.equal((evictedRemoval.payload.error as Record<string, unknown>).code, "removal-review-invalid");
      assert.equal(trashCalls, 0);
    } finally {
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
