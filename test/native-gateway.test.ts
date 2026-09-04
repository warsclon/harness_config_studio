import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createSystemGateway, TrashGatewayError } from "../src/system-gateway.ts";

test("native Trash rejects a missing fixture without crashing the Objective-C bridge", {
  skip: process.platform !== "darwin",
}, async () => {
  const fixture = await mkdtemp(join(tmpdir(), "hcs-native-error-"));
  try {
    await assert.rejects(createSystemGateway("darwin").moveToTrash({
      path: join(fixture, "does-not-exist.md"), targetKind: "file",
    }), (error: unknown) => {
      assert.ok(error instanceof TrashGatewayError);
      assert.equal(error.code, "trash-failed");
      assert.equal(error.technicalDetails?.exitCode, 1);
      assert.equal(error.technicalDetails?.signal, undefined);
      return true;
    });
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
