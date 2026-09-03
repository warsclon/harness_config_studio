import { createHash, randomBytes } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const ACTIVITY_LIMIT = 1_000;
const ACTIVITY_READ_LIMIT = 4 * 1024 * 1024;

export type ActivityAction = "save" | "system-reveal" | "recoverable-removal";
export type ActivitySubject = Readonly<{
  kind: "artifact" | "global-root" | "project-root" | "application-data-root";
  path: string;
  artifactIdentity: string | null;
}>;
export type BackupReference = Readonly<{
  relativePath: string;
  editRevision: string;
  createdAt: string;
  reused: boolean;
}>;
export type ActivityRecord = Readonly<{
  time: string;
  action: ActivityAction;
  subject: ActivitySubject;
  result: Readonly<{ status: "success" | "failure"; code: string }>;
  targetKind?: "file" | "symbolic-link" | "managed-skill-directory";
  backupReference?: BackupReference;
}>;
export type ActivityWarning = Readonly<{
  code: "activity-record-failed";
  message: string;
  action: ActivityAction;
  artifactIdentity?: string;
}>;
export type LatestBackup = Omit<BackupReference, "reused"> & Readonly<{ artifactIdentity: string }>;

type ActivityDocument = Readonly<{ schemaVersion: 1; records: ActivityRecord[] }>;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function entry(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return undefined;
    throw error;
  }
}

function ownerOnly(info: Stats, kind: "directory" | "file"): boolean {
  const expectedMode = kind === "directory" ? 0o700 : 0o600;
  const expectedType = kind === "directory" ? info.isDirectory() : info.isFile();
  const expectedOwner = typeof process.getuid !== "function" || info.uid === process.getuid();
  return expectedType && !info.isSymbolicLink() && expectedOwner && (info.mode & 0o7777) === expectedMode;
}

function hasExactKeys(value: object, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  let info = await entry(path);
  if (!info) {
    await mkdir(path, { mode: 0o700 });
    info = await entry(path);
  }
  if (!info || !ownerOnly(info, "directory")) throw new Error("unsafe-application-data-directory");
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    if (!ownerOnly(await handle.stat(), "directory")) throw new Error("unsafe-application-data-directory");
  } finally {
    await handle?.close();
  }
}

function isSubject(value: unknown): value is ActivitySubject {
  if (!value || typeof value !== "object") return false;
  const kind = Reflect.get(value, "kind");
  const identity = Reflect.get(value, "artifactIdentity");
  return hasExactKeys(value, ["kind", "path", "artifactIdentity"])
    && ["artifact", "global-root", "project-root", "application-data-root"].includes(String(kind))
    && typeof Reflect.get(value, "path") === "string"
    && (typeof identity === "string" || identity === null);
}

function isBackupReference(value: unknown): value is BackupReference {
  if (!value || typeof value !== "object") return false;
  const relativePath = Reflect.get(value, "relativePath");
  return hasExactKeys(value, ["relativePath", "editRevision", "createdAt", "reused"])
    && typeof relativePath === "string"
    && relativePath !== ""
    && !relativePath.startsWith("/")
    && !relativePath.split("/").includes("..")
    && /^[a-f0-9]{64}$/.test(String(Reflect.get(value, "editRevision")))
    && validIsoTime(Reflect.get(value, "createdAt"))
    && typeof Reflect.get(value, "reused") === "boolean";
}

function isRecord(value: unknown): value is ActivityRecord {
  if (!value || typeof value !== "object") return false;
  const result = Reflect.get(value, "result");
  const targetKind = Reflect.get(value, "targetKind");
  const backup = Reflect.get(value, "backupReference");
  const expectedKeys = ["time", "action", "subject", "result"];
  if (targetKind !== undefined) expectedKeys.push("targetKind");
  if (backup !== undefined) expectedKeys.push("backupReference");
  return hasExactKeys(value, expectedKeys)
    && validIsoTime(Reflect.get(value, "time"))
    && ["save", "system-reveal", "recoverable-removal"].includes(String(Reflect.get(value, "action")))
    && isSubject(Reflect.get(value, "subject"))
    && Boolean(result && typeof result === "object"
      && hasExactKeys(result, ["status", "code"])
      && ["success", "failure"].includes(String(Reflect.get(result, "status")))
      && typeof Reflect.get(result, "code") === "string")
    && (targetKind === undefined || ["file", "symbolic-link", "managed-skill-directory"].includes(String(targetKind)))
    && (backup === undefined || isBackupReference(backup));
}

function parseDocument(raw: Buffer): ActivityDocument {
  if (raw.length > ACTIVITY_READ_LIMIT) throw new Error("activity-document-too-large");
  const value: unknown = JSON.parse(raw.toString("utf8"));
  if (!value || typeof value !== "object" || !hasExactKeys(value, ["schemaVersion", "records"]) || Reflect.get(value, "schemaVersion") !== 1) {
    throw new Error("activity-schema-invalid");
  }
  const records = Reflect.get(value, "records");
  if (!Array.isArray(records) || !records.every(isRecord)) throw new Error("activity-record-invalid");
  return { schemaVersion: 1, records };
}

async function readDocument(path: string): Promise<ActivityDocument> {
  const info = await entry(path);
  if (!info) return { schemaVersion: 1, records: [] };
  if (!ownerOnly(info, "file") || info.nlink !== 1) throw new Error("activity-file-unsafe");
  return parseDocument(await readFile(path));
}

async function publishDocument(root: string, path: string, document: ActivityDocument): Promise<void> {
  const temporary = join(root, `.activity-${randomBytes(12).toString("hex")}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(Buffer.from(`${JSON.stringify(document)}\n`, "utf8"));
    await handle.sync();
    if (!ownerOnly(await handle.stat(), "file")) throw new Error("activity-temporary-unsafe");
    await handle.close();
    handle = undefined;
    const beforeRename = await entry(path);
    if (beforeRename && (!ownerOnly(beforeRename, "file") || beforeRename.nlink !== 1)) {
      throw new Error("activity-file-unsafe");
    }
    await rename(temporary, path);
    const directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function warningFor(record: ActivityRecord): ActivityWarning {
  return {
    code: "activity-record-failed",
    message: "The Activity Record could not be updated. Recovery history may be incomplete.",
    action: record.action,
    ...(record.subject.artifactIdentity ? { artifactIdentity: record.subject.artifactIdentity } : {}),
  };
}

function validIsoTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function createActivityRecovery(home: string) {
  let queue: Promise<void> = Promise.resolve();

  async function canonicalRoot(create: boolean): Promise<string | null> {
    const canonicalHome = await realpath(home);
    const root = join(canonicalHome, "harness_config_studio");
    if (!create && !(await entry(root))) return null;
    await ensurePrivateDirectory(root);
    return root;
  }

  async function append(record: ActivityRecord): Promise<ActivityWarning | undefined> {
    let answer: ActivityWarning | undefined;
    const operation = queue.then(async () => {
      try {
        const root = await canonicalRoot(true);
        if (!root) throw new Error("application-data-unavailable");
        const path = join(root, "activity.json");
        const current = await readDocument(path);
        const records = [...current.records, record].slice(-ACTIVITY_LIMIT);
        await publishDocument(root, path, { schemaVersion: 1, records });
      } catch {
        answer = warningFor(record);
      }
    });
    queue = operation.catch(() => undefined);
    await operation;
    return answer;
  }

  async function latestBackup(artifactIdentity: string): Promise<LatestBackup | null> {
    const root = await canonicalRoot(false);
    if (!root) return null;
    const backupRoot = join(root, "backups");
    const identityRoot = join(backupRoot, sha256(artifactIdentity));
    const backupRootInfo = await entry(backupRoot);
    const identityInfo = await entry(identityRoot);
    if (!backupRootInfo || !identityInfo) return null;
    if (!ownerOnly(backupRootInfo, "directory") || !ownerOnly(identityInfo, "directory")) throw new Error("backup-catalog-unsafe");
    const candidates: LatestBackup[] = [];
    for (const name of await readdir(identityRoot)) {
      if (!/^[a-f0-9]{64}\.bak$/.test(name)) continue;
      const path = join(identityRoot, name);
      const info = await entry(path);
      if (!info || !ownerOnly(info, "file") || info.nlink !== 1) continue;
      const editRevision = basename(name, ".bak");
      const bytes = await readFile(path).catch(() => undefined);
      if (!bytes || sha256(bytes) !== editRevision) continue;
      const metadataPath = join(identityRoot, `${editRevision}.json`);
      let createdAt = info.mtime.toISOString();
      const metadataInfo = await entry(metadataPath);
      if (!metadataInfo || !ownerOnly(metadataInfo, "file") || metadataInfo.nlink !== 1) continue;
      try {
        const metadata: unknown = JSON.parse(await readFile(metadataPath, "utf8"));
        const candidateCreatedAt = metadata && typeof metadata === "object" ? Reflect.get(metadata, "createdAt") : undefined;
        const candidateIdentity = metadata && typeof metadata === "object" ? Reflect.get(metadata, "artifactIdentity") : undefined;
        const candidateRevision = metadata && typeof metadata === "object" ? Reflect.get(metadata, "editRevision") : undefined;
        if (!validIsoTime(candidateCreatedAt) || candidateRevision !== editRevision || candidateIdentity !== artifactIdentity) continue;
        createdAt = candidateCreatedAt;
      } catch {
        continue;
      }
      candidates.push({ artifactIdentity, relativePath: relative(root, path), editRevision, createdAt });
    }
    candidates.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)
      || left.editRevision.localeCompare(right.editRevision)
      || left.relativePath.localeCompare(right.relativePath));
    return candidates.at(-1) ?? null;
  }

  return { record: append, latestBackup, canonicalRoot };
}
