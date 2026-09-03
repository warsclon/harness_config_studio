import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const SYSTEM_TIMEOUT_MS = 5_000;
const MAX_TECHNICAL_OUTPUT_BYTES = 4_096;

export type FinderRevealIntent = Readonly<{
  disposition: "select-item" | "open-directory";
  path: string;
}>;

export type TrashIntent = Readonly<{
  path: string;
  targetKind: "file" | "symbolic-link" | "managed-skill-directory";
}>;

export type MacOsSystemGateway = {
  reveal(intent: FinderRevealIntent): Promise<void>;
  moveToTrash(intent: TrashIntent): Promise<{ resultingPath?: string }>;
  openTrash(): Promise<void>;
};

type SafeTechnicalDetails = Readonly<{
  osCode?: string;
  exitCode?: number;
  signal?: string;
}>;

export type FinderFailureCode =
  | "finder-unavailable"
  | "finder-reveal-failed"
  | "finder-reveal-timeout";

export class FinderGatewayError extends Error {
  readonly code: FinderFailureCode;
  readonly technicalDetails?: SafeTechnicalDetails;

  constructor(code: FinderFailureCode, message: string, technicalDetails?: SafeTechnicalDetails) {
    super(message);
    this.code = code;
    this.technicalDetails = technicalDetails;
  }
}

export type TrashFailureCode =
  | "trash-unavailable"
  | "trash-permission-denied"
  | "trash-timeout"
  | "trash-failed";

export class TrashGatewayError extends Error {
  readonly code: TrashFailureCode;
  readonly technicalDetails?: SafeTechnicalDetails;

  constructor(code: TrashFailureCode, message: string, technicalDetails?: SafeTechnicalDetails) {
    super(message);
    this.code = code;
    this.technicalDetails = technicalDetails;
  }
}

class UnavailableMacOsSystemGateway implements MacOsSystemGateway {
  async reveal(): Promise<void> {
    throw new FinderGatewayError("finder-unavailable", "Finder reveal is available only on macOS.");
  }

  async moveToTrash(): Promise<never> {
    throw new TrashGatewayError("trash-unavailable", "Recoverable Removal is available only on macOS.");
  }

  async openTrash(): Promise<void> {
    throw new TrashGatewayError("trash-unavailable", "macOS Trash is unavailable on this platform.");
  }
}

function safeProcessDetails(code: number | null, signal: NodeJS.Signals | null): SafeTechnicalDetails | undefined {
  const details: Record<string, string | number> = {};
  if (code !== null) details.exitCode = code;
  if (signal) details.signal = signal;
  return Object.keys(details).length > 0 ? details : undefined;
}

function permissionFailure(stderr: Buffer): boolean {
  return /not permitted|permission|privilege|not authorized/i.test(stderr.toString("utf8"));
}

const TRASH_JXA = `
ObjC.import("Foundation");
function run(argv) {
  const source = $.NSURL.fileURLWithPath(argv[0]);
  const resulting = Ref();
  const failure = Ref();
  const moved = $.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError(source, resulting, failure);
  if (!moved) {
    const problem = failure[0];
    throw new Error(problem ? ObjC.unwrap(problem.localizedDescription) : "Trash operation failed");
  }
  return resulting[0] ? ObjC.unwrap(resulting[0].path) : "";
}
`;

class NativeMacOsSystemGateway implements MacOsSystemGateway {
  async reveal(intent: FinderRevealIntent): Promise<void> {
    const args = intent.disposition === "select-item" ? ["-R", intent.path] : [intent.path];
    await new Promise<void>((resolve, reject) => {
      const child = spawn("/usr/bin/open", args, { stdio: ["ignore", "ignore", "pipe"] });
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error); else resolve();
      };
      const timeout = setTimeout(() => {
        child.kill();
        finish(new FinderGatewayError("finder-reveal-timeout", "Finder did not accept the reveal request in time."));
      }, SYSTEM_TIMEOUT_MS);
      child.stderr?.resume();
      child.once("error", (error: NodeJS.ErrnoException) => {
        finish(new FinderGatewayError(
          error.code === "ENOENT" ? "finder-unavailable" : "finder-reveal-failed",
          error.code === "ENOENT" ? "Finder could not be launched." : "Finder could not reveal the managed location.",
          error.code ? { osCode: error.code } : undefined,
        ));
      });
      child.once("close", (code, signal) => {
        if (code === 0) finish();
        else finish(new FinderGatewayError(
          "finder-reveal-failed",
          "Finder could not reveal the managed location.",
          safeProcessDetails(code, signal),
        ));
      });
    });
  }

  async moveToTrash(intent: TrashIntent): Promise<{ resultingPath?: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        "/usr/bin/osascript",
        ["-l", "JavaScript", "-e", TRASH_JXA, intent.path],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout: Buffer = Buffer.alloc(0);
      let stderr: Buffer = Buffer.alloc(0);
      let settled = false;
      const append = (current: Buffer, chunk: Buffer | string): Buffer => {
        const remaining = MAX_TECHNICAL_OUTPUT_BYTES - current.length;
        if (remaining <= 0) return current;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        return Buffer.concat([current, bytes.subarray(0, remaining)]);
      };
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else {
          const resultingPath = stdout.toString("utf8").trim();
          resolve(resultingPath ? { resultingPath } : {});
        }
      };
      const timeout = setTimeout(() => {
        child.kill();
        finish(new TrashGatewayError("trash-timeout", "macOS Trash did not accept the removal request in time."));
      }, SYSTEM_TIMEOUT_MS);
      child.stdout?.on("data", (chunk: Buffer | string) => { stdout = append(stdout, chunk); });
      child.stderr?.on("data", (chunk: Buffer | string) => { stderr = append(stderr, chunk); });
      child.once("error", (error: NodeJS.ErrnoException) => {
        const code = error.code === "ENOENT" ? "trash-unavailable"
          : error.code === "EACCES" || error.code === "EPERM" ? "trash-permission-denied"
          : "trash-failed";
        finish(new TrashGatewayError(
          code,
          code === "trash-unavailable" ? "macOS Trash could not be launched."
            : code === "trash-permission-denied" ? "macOS denied permission to move this file to Trash."
            : "macOS could not move this file to Trash.",
          error.code ? { osCode: error.code } : undefined,
        ));
      });
      child.once("close", (code, signal) => {
        if (code === 0) {
          finish();
          return;
        }
        const denied = permissionFailure(stderr);
        finish(new TrashGatewayError(
          denied ? "trash-permission-denied" : "trash-failed",
          denied ? "macOS denied permission to move this file to Trash." : "macOS could not move this file to Trash.",
          safeProcessDetails(code, signal),
        ));
      });
    });
  }

  async openTrash(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("/usr/bin/open", [join(homedir(), ".Trash")], { stdio: ["ignore", "ignore", "pipe"] });
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error); else resolve();
      };
      const timeout = setTimeout(() => {
        child.kill();
        finish(new TrashGatewayError("trash-timeout", "macOS Trash did not open in time."));
      }, SYSTEM_TIMEOUT_MS);
      child.stderr?.resume();
      child.once("error", (error: NodeJS.ErrnoException) => {
        finish(new TrashGatewayError(
          error.code === "ENOENT" ? "trash-unavailable" : "trash-failed",
          error.code === "ENOENT" ? "macOS Trash could not be opened." : "macOS could not open Trash.",
          error.code ? { osCode: error.code } : undefined,
        ));
      });
      child.once("close", (code, signal) => {
        if (code === 0) finish();
        else finish(new TrashGatewayError("trash-failed", "macOS could not open Trash.", safeProcessDetails(code, signal)));
      });
    });
  }
}

export function createSystemGateway(platform = process.platform): MacOsSystemGateway {
  return platform === "darwin" ? new NativeMacOsSystemGateway() : new UnavailableMacOsSystemGateway();
}
