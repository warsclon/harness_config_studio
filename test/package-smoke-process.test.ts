import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { terminateChild } from "../scripts/process-lifecycle.mjs";

test("package smoke cleanup settles when the web child already exited", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));

  await assert.doesNotReject(terminateChild(child, { timeoutMs: 1_000 }));
});

test("package smoke cleanup registers exit observation before terminating a live child", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], {
    stdio: ["ignore", "ignore", "ignore"],
  });

  await assert.doesNotReject(terminateChild(child, { timeoutMs: 1_000 }));
  assert.equal(child.exitCode !== null || child.signalCode !== null, true);
});

test("package smoke cleanup escalates and settles when the web child ignores SIGTERM", async () => {
  const child = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000)"],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));

  await assert.doesNotReject(terminateChild(child, { timeoutMs: 25 }));
  assert.equal(child.signalCode, "SIGKILL");
});
