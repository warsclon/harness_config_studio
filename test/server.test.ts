import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { startServer } from "../src/server.ts";

test("the loopback server serves the web shell and versioned inventory API", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-server-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(home, ".codex", "config.toml"), "model = 'test'");

    const running = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    try {
      assert.equal(running.host, "127.0.0.1");
      const shellResponse = await fetch(running.url);
      const shell = await shellResponse.text();
      assert.equal(shellResponse.status, 200);
      assert.match(shellResponse.headers.get("content-type") ?? "", /^text\/html/);
      assert.match(shell, /<main id="app"/);
      assert.doesNotMatch(shell, /config\.toml/);

      const apiResponse = await fetch(`${running.url}/api/inventory`);
      const payload = await apiResponse.json() as { schemaVersion: number; artifacts: Array<{ path: string }> };
      assert.equal(apiResponse.status, 200);
      assert.match(apiResponse.headers.get("content-type") ?? "", /^application\/json/);
      assert.equal(payload.schemaVersion, 1);
      assert.equal(payload.artifacts.some((artifact) => artifact.path.endsWith("/.codex/config.toml")), true);
    } finally {
      await running.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("automatic ports fall back while an explicit occupied port fails", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-port-fallback-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const blocker = createServer();

  try {
    await mkdir(home, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", resolve);
    });
    const occupiedPort = (blocker.address() as AddressInfo).port;

    const fallback = await startServer({ home, workspace, preferredPort: occupiedPort, strictPort: false });
    try {
      assert.equal(fallback.host, "127.0.0.1");
      assert.equal(fallback.port, occupiedPort + 1);
      await assert.rejects(
        startServer({ home, workspace, preferredPort: occupiedPort, strictPort: true }),
        (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE",
      );
    } finally {
      await fallback.close();
    }
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("a restarted server rejects the previous process capability", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "harness-config-capability-restart-"));
  const home = join(fixtureRoot, "home");
  const workspace = join(fixtureRoot, "workspace");
  const capabilityFrom = (shell: string) => {
    const capability = shell.match(/name="hcs-session-capability" content="([^"]+)"/)?.[1];
    assert.ok(capability);
    return capability;
  };

  try {
    await mkdir(join(home, ".codex"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(home, ".codex", "config.toml"), "model = 'test'");
    const first = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    const firstCapability = capabilityFrom(await (await fetch(first.url)).text());
    await first.close();

    const second = await startServer({ home, workspace, preferredPort: 0, strictPort: true });
    try {
      const secondCapability = capabilityFrom(await (await fetch(second.url)).text());
      assert.notEqual(secondCapability, firstCapability);
      const response = await fetch(`${second.url}/api/management/artifacts/open`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: second.url,
          "x-harness-config-capability": firstCapability,
        },
        body: JSON.stringify({ artifactIdentity: join(home, ".codex", "config.toml") }),
      });
      assert.equal(response.status, 401);
      assert.equal((await response.json() as { error: { code: string } }).error.code, "capability-invalid");
    } finally {
      await second.close();
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
