import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { terminateChild } from "../scripts/process-lifecycle.mjs";
import { startServer } from "../src/server.ts";

test("a malformed HTTP URL returns a safe error and the same process remains usable", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "hcs-http-boundary-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  await mkdir(home);
  await mkdir(workspace);
  const child = spawn(process.execPath, [
    "--input-type=module", "-e",
    "import { startServer } from './dist/server.js'; const server = await startServer({home:process.argv[1],workspace:process.argv[2],preferredPort:0}); console.log(server.url);",
    home, workspace,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Server startup timed out")), 5_000);
      child.stdout.once("data", (chunk) => { clearTimeout(timer); resolve(String(chunk).trim()); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Server exited before startup")); });
    });
    const invalid = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      const call = request(url, { path: "//[" }, (response) => {
        let body = "";
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => resolve({ status: response.statusCode, body }));
      });
      call.setTimeout(3_000, () => call.destroy(new Error("Request timed out")));
      call.on("error", reject);
      call.end();
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(JSON.parse(invalid.body), {
      error: { code: "request-invalid", message: "The request URL is invalid.", action: "route" },
    });
    const healthy = await fetch(`${url}/api/inventory`);
    assert.equal(healthy.status, 200);
    assert.equal((await healthy.json()).schemaVersion, 1);
    assert.equal(child.exitCode, null);
    assert.equal(stderr, "");
  } finally {
    await terminateChild(child);
    await rm(fixture, { recursive: true, force: true });
  }
});

test("unexpected Hosts cannot receive the shell, Inventory or management data", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "hcs-host-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  await mkdir(home);
  await mkdir(workspace);
  const running = await startServer({ home, workspace, preferredPort: 0 });
  try {
    for (const path of ["/", "/api/inventory", "/api/management/artifacts/open", "/unknown"]) {
      const rejected = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
        const call = request(running.url + path, {
          method: path.includes("management") ? "POST" : "GET",
          headers: { host: "unrelated.example" },
        }, (response) => {
          let body = "";
          response.on("data", (chunk) => { body += chunk; });
          response.on("end", () => resolve({ status: response.statusCode, body }));
        });
        call.on("error", reject);
        call.end();
      });
      assert.equal(rejected.status, 403, path);
      assert.equal(JSON.parse(rejected.body).error.code, "host-invalid");
      assert.doesNotMatch(rejected.body, /hcs-session-capability|schemaVersion|artifacts|home|workspace/);
    }
    const inventory = await fetch(`${running.url}/api/inventory`);
    assert.equal(inventory.status, 200);
    assert.equal((await inventory.json()).schemaVersion, 1);
    assert.equal((await fetch(running.url)).status, 200);
  } finally {
    await running.close();
    await rm(fixture, { recursive: true, force: true });
  }
});

test("Web Management remains usable in its own page but cannot be embedded by another origin", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "hcs-framing-"));
  const home = join(fixture, "home");
  const workspace = join(fixture, "workspace");
  await mkdir(join(home, ".codex"), { recursive: true });
  await mkdir(workspace);
  await writeFile(join(home, ".codex", "config.toml"), "model = 'fixture'\n");
  const running = await startServer({ home, workspace, preferredPort: 0 });
  const embedding = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(`<iframe src="${running.url}" onload="this.dataset.loaded='true'"></iframe>`);
  });
  const browser = await chromium.launch({ headless: true });
  try {
    await new Promise<void>((resolve) => embedding.listen(0, "127.0.0.1", resolve));
    const page = await browser.newPage();
    await page.goto(running.url);
    await page.locator('#app[data-state="ready"]').waitFor();
    await page.getByRole("button", { name: "Help and keyboard shortcuts", exact: true }).click();
    await page.getByRole("dialog", { name: "Harness Config Studio help", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("heading", { name: "Global configuration" }).click();
    await page.getByRole("button", { name: /\.codex.*Global Root/i }).click();
    await page.locator("[data-artifact]").filter({ hasText: "config.toml" }).click();
    await page.getByLabel("Artifact content").fill("model = 'edited'\n");
    await page.getByTestId("review-save").click();
    await page.getByTestId("confirm-save").waitFor();
    const embeddedPage = await browser.newPage();
    await embeddedPage.goto(`http://127.0.0.1:${(embedding.address() as AddressInfo).port}`);
    await embeddedPage.locator('iframe[data-loaded="true"]').waitFor();
    assert.equal(await embeddedPage.frameLocator("iframe").locator("#app").count(), 0);
    const shell = await fetch(running.url);
    assert.equal(shell.headers.get("content-security-policy"), "frame-ancestors 'none'");
    assert.equal(shell.headers.get("x-frame-options"), "DENY");
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => embedding.close(() => resolve()));
    await running.close();
    await rm(fixture, { recursive: true, force: true });
  }
});
