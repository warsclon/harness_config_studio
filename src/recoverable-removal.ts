import { createHash, randomBytes } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { access, lstat, opendir, readlink, realpath } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { HARNESS_ADAPTERS, PROJECT_ARTIFACTS } from "./adapters.ts";
import { inventory, type HarnessId, type InventoryArtifact, type InventoryRequest, type InventoryResult } from "./index.ts";
import { classifyManagedSkillDirectory } from "./managed-skill-policy.ts";
import { ManagementError } from "./management.ts";
import type { MutationCoordinator, MutationScope } from "./mutation-coordinator.ts";
import {
  TrashGatewayError,
  type MacOsSystemGateway,
  type TrashIntent,
} from "./system-gateway.ts";
import { inspectVisibleSymbolicLink } from "./visible-symbolic-link.ts";

export const MAX_REMOVAL_ENTRIES = 5_000 as const;
export const MAX_REMOVAL_BYTES = 104_857_600 as const;
const MAX_TREE_SUMMARY_ENTRIES = 200;
const MAX_TREE_SUMMARY_UTF8_BYTES = 64 * 1024;
const MAX_IN_MEMORY_REMOVAL_REVIEWS = 32;
const HARNESS_ORDER: HarnessId[] = ["codex", "claude", "opencode", "pi"];

type EntryType = "file" | "directory" | "symbolic-link" | "other";

type EntryRevision = Readonly<{
  relativePath: string;
  type: EntryType;
  device: string;
  inode: string;
  mode: number;
  uid: number;
  gid: number;
  linkCount: string;
  size: string;
  modifiedNs: string;
  changedNs: string;
  rawLinkTarget?: string;
}>;

type ParentRevision = Readonly<{
  canonicalPath: string;
  device: string;
  inode: string;
  mode: number;
  modifiedNs: string;
  changedNs: string;
}>;

type LinkParentRevision = Readonly<{
  canonicalPath: string;
  device: string;
  inode: string;
  mode: number;
}>;

type FileRemovalRevision = Readonly<{
  schemaVersion: 1;
  targetKind: "file";
  artifactIdentity: string;
  inventory: {
    category: InventoryArtifact["category"];
    scope: InventoryArtifact["scope"];
    harnesses: InventoryArtifact["harnesses"];
  };
  entry: EntryRevision;
  parent: ParentRevision;
}>;

type DirectoryRemovalRevision = Readonly<{
  schemaVersion: 1;
  targetKind: "managed-skill-directory";
  artifactIdentity: string;
  skillName: string;
  parentSkillsRoot: ParentRevision;
  inventory: {
    scope: InventoryArtifact["scope"];
    harnesses: HarnessId[];
  };
  entries: EntryRevision[];
}>;

type SymbolicLinkRemovalRevision = Readonly<{
  schemaVersion: 1;
  targetKind: "symbolic-link";
  artifactIdentity: string;
  inventory: {
    category: InventoryArtifact["category"];
    scope: InventoryArtifact["scope"];
    harnesses: InventoryArtifact["harnesses"];
  };
  entry: {
    type: "symbolic-link";
    rawLinkTargetBase64: string;
    device: string;
    inode: string;
    size: string;
    mode: number;
    uid: number;
    gid: number;
    modifiedNs: string;
    changedNs: string;
  };
  parent: LinkParentRevision;
}>;

type RemovalRevision = FileRemovalRevision | DirectoryRemovalRevision | SymbolicLinkRemovalRevision;

type StoredRemovalReview = Readonly<{
  removalReviewId: string;
  revision: RemovalRevision;
  removalRevision: string;
}>;

type RemovalSummary = Readonly<{
  entries: number;
  files: number;
  directories: number;
  symbolicLinks: number;
  other: number;
  totalBytes: number;
}>;

export type FileRemovalPreview = Readonly<{
  removalReviewId: string;
  removalRevision: string;
  targetKind: "file";
  artifactIdentity: string;
  name: string;
  parentDirectory: string;
  category: InventoryArtifact["category"];
  scope: InventoryArtifact["scope"];
  harnesses: InventoryArtifact["harnesses"];
  summary: Omit<RemovalSummary, "other">;
  hardLinkCount?: number;
  skillWarning?: {
    code: "skill-may-be-disabled";
    directory: string;
    harnesses: InventoryArtifact["harnesses"];
  };
}>;

export type ManagedSkillDirectoryPreview = Readonly<{
  status: "ready";
  removalReviewId: string;
  removalRevision: string;
  targetKind: "managed-skill-directory";
  artifactIdentity: string;
  skillName: string;
  parentSkillsRoot: string;
  scope: InventoryArtifact["scope"];
  harnesses: HarnessId[];
  summary: RemovalSummary;
  tree: {
    entries: Array<{
      relativePath: string;
      depth: number;
      type: EntryType;
      bytes?: number;
    }>;
    truncated: boolean;
  };
}>;

export type RemovalPreviewRefusal = Readonly<{
  status: "refused";
  code: "removal-preview-too-large";
  targetKind: "managed-skill-directory";
  artifactIdentity: string;
  skillName: string;
  parentSkillsRoot: string;
  reason: "entries" | "bytes";
  observedAtLeast: string;
  limits: { entries: 5_000; bytes: 104_857_600 };
  canReveal: true;
}>;

export type SymbolicLinkRemovalPreview = Readonly<{
  removalReviewId: string;
  removalRevision: string;
  targetKind: "symbolic-link";
  artifactIdentity: string;
  name: string;
  parentDirectory: string;
  category: InventoryArtifact["category"];
  scope: InventoryArtifact["scope"];
  harnesses: InventoryArtifact["harnesses"];
  linkState: "healthy" | "broken";
  resolvedPath: string | null;
  targetBoundary: "inside" | "outside" | "unknown";
  summary: {
    entries: 1;
    files: 0;
    directories: 0;
    symbolicLinks: 1;
    totalBytes: number;
  };
  consequence: "link-only";
}>;

export type RemovalPreviewResult = FileRemovalPreview | ManagedSkillDirectoryPreview | RemovalPreviewRefusal | SymbolicLinkRemovalPreview;

export type RemovalResult = Readonly<{
  action: "recoverable-removal";
  artifactIdentity: string;
  targetKind: "file" | "managed-skill-directory" | "symbolic-link";
  result: "moved-to-trash";
  occurredAt: string;
}>;

export type RecoverableRemoval = Readonly<{
  preview(artifactIdentity: string): Promise<RemovalPreviewResult>;
  apply(input: { removalReviewId: string; confirmationName?: string }): Promise<RemovalResult>;
  openTrash(): Promise<{ ok: true; action: "open-trash" }>;
}>;

type DirectoryScan = Readonly<{
  status: "ready";
  entries: EntryRevision[];
  summary: RemovalSummary;
  tree: ManagedSkillDirectoryPreview["tree"];
}> | Readonly<{
  status: "refused";
  reason: "entries" | "bytes";
  observedAtLeast: string;
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isInside(path: string, boundary: string): boolean {
  const offset = relative(boundary, path);
  return offset === "" || (!offset.startsWith("..") && !offset.startsWith("/"));
}

function recognizedSkillsRootPaths(snapshot: InventoryResult): Set<string> {
  const roots = new Set<string>();
  for (const artifact of snapshot.artifacts) {
    if (artifact.category !== "skills") continue;
    if (artifact.scope.kind === "project") {
      const scope = artifact.scope;
      if (PROJECT_ARTIFACTS.some((pattern) => (
        pattern.category === "skills"
        && join(scope.directory, pattern.relativePath) === artifact.path
      ))) roots.add(artifact.path);
      continue;
    }
    const scope = artifact.scope;
    for (const adapter of HARNESS_ADAPTERS) {
      for (const root of adapter.globalRoots) {
        if (root.path(snapshot.home) !== scope.root) continue;
        if (root.artifacts.some((pattern) => (
          pattern.category === "skills"
          && join(scope.root, pattern.relativePath) === artifact.path
        ))) roots.add(artifact.path);
      }
    }
  }
  return roots;
}

function isProtectedRoot(snapshot: InventoryResult, artifactIdentity: string): boolean {
  return snapshot.globalRoots.some((root) => root.path === artifactIdentity)
    || snapshot.projectRoots.some((root) => root.path === artifactIdentity)
    || recognizedSkillsRootPaths(snapshot).has(artifactIdentity);
}

function typeOf(info: BigIntStats): EntryType {
  if (info.isSymbolicLink()) return "symbolic-link";
  if (info.isFile()) return "file";
  if (info.isDirectory()) return "directory";
  return "other";
}

function entryRevision(relativePath: string, info: BigIntStats, rawLinkTarget?: string): EntryRevision {
  return {
    relativePath,
    type: typeOf(info),
    device: info.dev.toString(),
    inode: info.ino.toString(),
    mode: Number(info.mode),
    uid: Number(info.uid),
    gid: Number(info.gid),
    linkCount: info.nlink.toString(),
    size: info.size.toString(),
    modifiedNs: info.mtimeNs.toString(),
    changedNs: info.ctimeNs.toString(),
    ...(rawLinkTarget === undefined ? {} : { rawLinkTarget }),
  };
}

function parentRevision(canonicalPath: string, info: BigIntStats): ParentRevision {
  return {
    canonicalPath,
    device: info.dev.toString(),
    inode: info.ino.toString(),
    mode: Number(info.mode),
    modifiedNs: info.mtimeNs.toString(),
    changedNs: info.ctimeNs.toString(),
  };
}

function sameEntry(left: EntryRevision, right: EntryRevision): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function scanFailure(code: "removal-preview-unreadable" | "removal-preview-unsupported", path: string): ManagementError {
  return new ManagementError(
    code === "removal-preview-unreadable" ? 403 : 422,
    code,
    code === "removal-preview-unreadable"
      ? "The Managed Skill Directory could not be reviewed completely."
      : "The Managed Skill Directory contains an unsupported filesystem boundary.",
    { path },
  );
}

async function stableDirectoryNames(path: string, expected: EntryRevision): Promise<string[]> {
  let directory;
  try {
    directory = await opendir(path);
  } catch {
    throw scanFailure("removal-preview-unreadable", path);
  }
  const afterOpen = await lstat(path, { bigint: true }).catch(() => undefined);
  if (!afterOpen || !sameEntry(expected, entryRevision(expected.relativePath, afterOpen))) {
    await directory.close().catch(() => undefined);
    throw scanFailure("removal-preview-unreadable", path);
  }
  const names: string[] = [];
  try {
    for await (const entry of directory) names.push(entry.name);
  } catch {
    throw scanFailure("removal-preview-unreadable", path);
  }
  const afterRead = await lstat(path, { bigint: true }).catch(() => undefined);
  if (!afterRead || !sameEntry(expected, entryRevision(expected.relativePath, afterRead))) {
    throw scanFailure("removal-preview-unreadable", path);
  }
  return names.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

async function scanManagedSkillDirectory(root: string): Promise<DirectoryScan> {
  const firstRootInfo = await lstat(root, { bigint: true }).catch(() => undefined);
  if (!firstRootInfo?.isDirectory() || firstRootInfo.isSymbolicLink()) {
    throw scanFailure("removal-preview-unreadable", root);
  }
  const rootDevice = firstRootInfo.dev;
  const entries: EntryRevision[] = [];
  const treeEntries: ManagedSkillDirectoryPreview["tree"]["entries"] = [];
  let treeBytes = 2;
  let descendantCount = 0;
  let fileCount = 0;
  let directoryCount = 0;
  let symbolicLinkCount = 0;
  let otherCount = 0;
  let totalBytes = 0n;
  const stack: Array<{ phase: "enter" | "exit"; path: string; relativePath: string; depth: number; expected?: EntryRevision }> = [
    { phase: "enter", path: root, relativePath: ".", depth: 0 },
  ];

  while (stack.length > 0) {
    const item = stack.pop()!;
    if (item.phase === "exit") {
      const current = await lstat(item.path, { bigint: true }).catch(() => undefined);
      if (!current || !item.expected || !sameEntry(item.expected, entryRevision(item.relativePath, current))) {
        throw scanFailure("removal-preview-unreadable", item.path);
      }
      continue;
    }

    const info = await lstat(item.path, { bigint: true }).catch(() => undefined);
    if (!info) throw scanFailure("removal-preview-unreadable", item.path);
    const entryType = typeOf(info);
    if (entryType === "directory" && info.dev !== rootDevice) {
      throw scanFailure("removal-preview-unsupported", item.path);
    }
    let rawLinkTarget: string | undefined;
    if (entryType === "symbolic-link") {
      rawLinkTarget = await readlink(item.path).catch(() => undefined);
      if (rawLinkTarget === undefined) throw scanFailure("removal-preview-unreadable", item.path);
    }
    const revision = entryRevision(item.relativePath, info, rawLinkTarget);
    entries.push(revision);

    if (item.relativePath !== ".") {
      descendantCount += 1;
      if (descendantCount > MAX_REMOVAL_ENTRIES) {
        return { status: "refused", reason: "entries", observedAtLeast: String(descendantCount) };
      }
      if (entryType === "file") fileCount += 1;
      else if (entryType === "directory") directoryCount += 1;
      else if (entryType === "symbolic-link") symbolicLinkCount += 1;
      else otherCount += 1;
      if (entryType !== "directory") totalBytes += info.size;
      if (totalBytes > BigInt(MAX_REMOVAL_BYTES)) {
        return { status: "refused", reason: "bytes", observedAtLeast: totalBytes.toString() };
      }
      const treeEntry = {
        relativePath: item.relativePath,
        depth: item.depth,
        type: entryType,
        ...(entryType === "directory" ? {} : { bytes: Number(info.size) }),
      };
      const encodedBytes = Buffer.byteLength(JSON.stringify(treeEntry), "utf8") + (treeEntries.length === 0 ? 0 : 1);
      if (treeEntries.length < MAX_TREE_SUMMARY_ENTRIES && treeBytes + encodedBytes <= MAX_TREE_SUMMARY_UTF8_BYTES) {
        treeEntries.push(treeEntry);
        treeBytes += encodedBytes;
      }
    }

    if (entryType === "directory") {
      const names = await stableDirectoryNames(item.path, revision);
      stack.push({ phase: "exit", path: item.path, relativePath: item.relativePath, depth: item.depth, expected: revision });
      for (let index = names.length - 1; index >= 0; index -= 1) {
        const name = names[index]!;
        stack.push({
          phase: "enter",
          path: join(item.path, name),
          relativePath: item.relativePath === "." ? name : join(item.relativePath, name),
          depth: item.depth + 1,
        });
      }
    }
  }

  for (const expected of entries) {
    const path = expected.relativePath === "." ? root : join(root, expected.relativePath);
    const current = await lstat(path, { bigint: true }).catch(() => undefined);
    if (!current) throw scanFailure("removal-preview-unreadable", path);
    const rawTarget = expected.type === "symbolic-link" ? await readlink(path).catch(() => undefined) : undefined;
    if (!sameEntry(expected, entryRevision(expected.relativePath, current, rawTarget))) {
      throw scanFailure("removal-preview-unreadable", path);
    }
  }

  return {
    status: "ready",
    entries,
    summary: {
      entries: descendantCount,
      files: fileCount,
      directories: directoryCount,
      symbolicLinks: symbolicLinkCount,
      other: otherCount,
      totalBytes: Number(totalBytes),
    },
    tree: { entries: treeEntries, truncated: treeEntries.length < descendantCount },
  };
}

async function managementBoundaries(request: InventoryRequest, globalRoots: string[]): Promise<string[]> {
  return (await Promise.all([request.workspace, ...globalRoots].map((path) => realpath(path).catch(() => undefined))))
    .filter((path): path is string => Boolean(path));
}

async function inspectSymbolicLinkRemoval(
  request: InventoryRequest,
  artifactIdentity: string,
): Promise<{
  artifact: InventoryArtifact;
  revision: SymbolicLinkRemovalRevision;
  resolvedPath: string | null;
  targetBoundary: SymbolicLinkRemovalPreview["targetBoundary"];
}> {
  const snapshot = await inventory(request);
  const artifact = snapshot.artifacts.find((candidate) => candidate.path === artifactIdentity);
  if (!artifact) {
    throw new ManagementError(404, "removal-target-not-found", "The selected symbolic link is not in the current Inventory.");
  }
  if (!artifact.isSymbolicLink || isProtectedRoot(snapshot, artifact.path)) {
    throw new ManagementError(422, "removal-not-eligible", "The selected artifact is not an eligible symbolic link.", {
      path: artifact.path,
    });
  }

  const link = await inspectVisibleSymbolicLink(artifact.path);
  if (!link) {
    throw new ManagementError(422, "removal-not-eligible", "The selected artifact is no longer a symbolic link.", {
      path: artifact.path,
    });
  }
  const canonicalParent = await realpath(dirname(artifact.path)).catch(() => undefined);
  const boundaries = await managementBoundaries(request, snapshot.globalRoots.map((root) => root.path));
  if (!canonicalParent || !boundaries.some((boundary) => isInside(canonicalParent, boundary))) {
    throw new ManagementError(422, "removal-not-eligible", "The selected symbolic link is outside the Management Boundary.", {
      path: artifact.path,
    });
  }
  const parentInfo = await lstat(canonicalParent, { bigint: true }).catch(() => undefined);
  if (!parentInfo?.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new ManagementError(422, "removal-not-eligible", "The selected symbolic link parent is not a real managed directory.", {
      path: artifact.path,
    });
  }
  try {
    await access(canonicalParent, constants.W_OK | constants.X_OK);
  } catch {
    throw new ManagementError(403, "removal-permission-denied", "The parent directory does not allow moving this symbolic link to Trash.", {
      path: artifact.path,
    });
  }

  const targetBoundary = link.resolvedPath === null
    ? "unknown"
    : boundaries.some((boundary) => isInside(link.resolvedPath!, boundary)) ? "inside" : "outside";
  return {
    artifact,
    resolvedPath: link.resolvedPath,
    targetBoundary,
    revision: {
      schemaVersion: 1,
      targetKind: "symbolic-link",
      artifactIdentity: artifact.path,
      inventory: { category: artifact.category, scope: artifact.scope, harnesses: artifact.harnesses },
      entry: {
        type: "symbolic-link",
        rawLinkTargetBase64: link.rawLinkTargetBase64,
        device: link.device,
        inode: link.inode,
        size: link.size,
        mode: link.mode,
        uid: link.uid,
        gid: link.gid,
        modifiedNs: link.modifiedNs,
        changedNs: link.changedNs,
      },
      parent: {
        canonicalPath: canonicalParent,
        device: parentInfo.dev.toString(),
        inode: parentInfo.ino.toString(),
        mode: Number(parentInfo.mode),
      },
    },
  };
}

async function inspectFileRemoval(
  request: InventoryRequest,
  artifactIdentity: string,
): Promise<{ artifact: InventoryArtifact; revision: FileRemovalRevision; info: BigIntStats }> {
  const snapshot = await inventory(request);
  const artifact = snapshot.artifacts.find((candidate) => candidate.path === artifactIdentity);
  if (!artifact) throw new ManagementError(404, "removal-target-not-found", "The selected file is not in the current Inventory.");
  if (artifact.isSymbolicLink || artifact.kind !== "file") {
    throw new ManagementError(422, "removal-not-eligible", "Only a real inventoried file is eligible for this removal.", { path: artifact.path });
  }
  const info = await lstat(artifact.path, { bigint: true }).catch(() => undefined);
  if (!info) throw new ManagementError(404, "removal-target-not-found", "The selected file no longer exists.", { path: artifact.path });
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new ManagementError(422, "removal-not-eligible", "Only a real inventoried file is eligible for this removal.", { path: artifact.path });
  }
  const parentDirectory = dirname(artifact.path);
  const canonicalParent = await realpath(parentDirectory).catch(() => undefined);
  const boundaries = await managementBoundaries(request, snapshot.globalRoots.map((root) => root.path));
  if (!canonicalParent || !boundaries.some((boundary) => isInside(canonicalParent, boundary))) {
    throw new ManagementError(422, "removal-not-eligible", "The selected file is outside the Management Boundary.", { path: artifact.path });
  }
  const parentInfo = await lstat(canonicalParent, { bigint: true }).catch(() => undefined);
  if (!parentInfo?.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new ManagementError(422, "removal-not-eligible", "The selected file parent is not a real managed directory.", { path: artifact.path });
  }
  try {
    await access(canonicalParent, constants.W_OK | constants.X_OK);
  } catch {
    throw new ManagementError(403, "removal-permission-denied", "The parent directory does not allow moving this file to Trash.", { path: artifact.path });
  }
  return {
    artifact,
    info,
    revision: {
      schemaVersion: 1,
      targetKind: "file",
      artifactIdentity: artifact.path,
      inventory: { category: artifact.category, scope: artifact.scope, harnesses: artifact.harnesses },
      entry: entryRevision(".", info),
      parent: parentRevision(canonicalParent, parentInfo),
    },
  };
}

async function inspectDirectoryRemoval(request: InventoryRequest, artifactIdentity: string): Promise<{
  artifact: InventoryArtifact;
  skillName: string;
  parentSkillsRoot: string;
  harnesses: HarnessId[];
  parentInfo: BigIntStats;
  scan: DirectoryScan;
  revision?: DirectoryRemovalRevision;
}> {
  const snapshot = await inventory(request);
  const inventoryArtifact = snapshot.artifacts.find((candidate) => candidate.path === artifactIdentity);
  if (!inventoryArtifact) {
    throw new ManagementError(404, "removal-target-not-found", "The selected location is not in the current Inventory.", { path: artifactIdentity });
  }
  const managed = classifyManagedSkillDirectory(snapshot, artifactIdentity);
  if (!managed) {
    throw new ManagementError(422, "removal-not-eligible", "The selected location is not a Managed Skill Directory.", { path: artifactIdentity });
  }
  const rootInfo = await lstat(managed.artifact.path, { bigint: true }).catch(() => undefined);
  const parentInfo = await lstat(managed.parentSkillsRoot.path, { bigint: true }).catch(() => undefined);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink() || !parentInfo?.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new ManagementError(422, "removal-not-eligible", "The selected location is not a real Managed Skill Directory.", { path: artifactIdentity });
  }
  if (rootInfo.dev !== parentInfo.dev) {
    throw scanFailure("removal-preview-unsupported", managed.artifact.path);
  }
  const canonicalParent = await realpath(managed.parentSkillsRoot.path).catch(() => undefined);
  const boundaries = await managementBoundaries(request, snapshot.globalRoots.map((root) => root.path));
  if (!canonicalParent || !boundaries.some((boundary) => isInside(canonicalParent, boundary))) {
    throw new ManagementError(422, "removal-not-eligible", "The Managed Skill Directory is outside the Management Boundary.", { path: artifactIdentity });
  }
  try {
    await access(managed.parentSkillsRoot.path, constants.W_OK | constants.X_OK);
  } catch {
    throw new ManagementError(403, "removal-permission-denied", "The skills root does not allow moving this directory to Trash.", { path: artifactIdentity });
  }
  const harnesses = HARNESS_ORDER.filter((harness) => (
    managed.artifact.harnesses.includes(harness)
    || managed.parentSkillsRoot.harnesses.includes(harness)
    || snapshot.artifacts.some((artifact) => isInside(artifact.path, managed.artifact.path) && artifact.harnesses.includes(harness))
  ));
  const scan = await scanManagedSkillDirectory(managed.artifact.path);
  const parentAfter = await lstat(managed.parentSkillsRoot.path, { bigint: true }).catch(() => undefined);
  if (!parentAfter || JSON.stringify(parentRevision(canonicalParent, parentAfter)) !== JSON.stringify(parentRevision(canonicalParent, parentInfo))) {
    throw scanFailure("removal-preview-unreadable", managed.parentSkillsRoot.path);
  }
  const base = {
    artifact: managed.artifact,
    skillName: basename(managed.artifact.path),
    parentSkillsRoot: managed.parentSkillsRoot.path,
    harnesses,
    parentInfo,
    scan,
  };
  if (scan.status === "refused") return base;
  return {
    ...base,
    revision: {
      schemaVersion: 1,
      targetKind: "managed-skill-directory",
      artifactIdentity: managed.artifact.path,
      skillName: basename(managed.artifact.path),
      parentSkillsRoot: parentRevision(canonicalParent, parentInfo),
      inventory: { scope: managed.artifact.scope, harnesses },
      entries: scan.entries,
    },
  };
}

function trashStatus(code: TrashGatewayError["code"]): number {
  if (code === "trash-unavailable") return 503;
  if (code === "trash-permission-denied") return 403;
  if (code === "trash-timeout") return 504;
  return 502;
}

function mapTrashError(error: unknown, artifactIdentity?: string): ManagementError {
  if (error instanceof TrashGatewayError) {
    return new ManagementError(trashStatus(error.code), error.code, error.message, {
      ...(artifactIdentity ? { path: artifactIdentity } : {}),
      ...(error.technicalDetails ? { technicalDetails: error.technicalDetails } : {}),
    });
  }
  return new ManagementError(502, "trash-failed", "macOS could not complete the Trash operation.", {
    ...(artifactIdentity ? { path: artifactIdentity } : {}),
  });
}

function mutationScopeFor(revision: RemovalRevision): MutationScope {
  return revision.targetKind === "managed-skill-directory"
    ? { kind: "subtree", path: revision.artifactIdentity }
    : { kind: "exact", path: revision.artifactIdentity };
}

export function createRecoverableRemoval(
  request: InventoryRequest,
  systemGateway: MacOsSystemGateway,
  coordinator: MutationCoordinator,
): RecoverableRemoval {
  const reviews = new Map<string, StoredRemovalReview>();
  const latestByArtifact = new Map<string, string>();

  function invalidateReview(artifactIdentity: string): void {
    const previous = latestByArtifact.get(artifactIdentity);
    if (previous) reviews.delete(previous);
    latestByArtifact.delete(artifactIdentity);
  }

  function storeReview(revision: RemovalRevision): StoredRemovalReview {
    const artifactIdentity = revision.artifactIdentity;
    const removalReviewId = randomBytes(24).toString("base64url");
    const removalRevision = sha256(JSON.stringify(revision));
    invalidateReview(artifactIdentity);
    const review = { removalReviewId, revision, removalRevision };
    reviews.set(removalReviewId, review);
    latestByArtifact.set(artifactIdentity, removalReviewId);
    while (reviews.size > MAX_IN_MEMORY_REMOVAL_REVIEWS) {
      const oldestReviewId = reviews.keys().next().value as string | undefined;
      if (!oldestReviewId) break;
      const oldestReview = reviews.get(oldestReviewId);
      reviews.delete(oldestReviewId);
      if (oldestReview && latestByArtifact.get(oldestReview.revision.artifactIdentity) === oldestReviewId) {
        latestByArtifact.delete(oldestReview.revision.artifactIdentity);
      }
    }
    return review;
  }

  return {
    async preview(artifactIdentity) {
      const snapshot = await inventory(request);
      const candidate = snapshot.artifacts.find((artifact) => artifact.path === artifactIdentity);
      if (candidate?.isSymbolicLink) {
        const inspected = await inspectSymbolicLinkRemoval(request, artifactIdentity);
        const review = storeReview(inspected.revision);
        return {
          removalReviewId: review.removalReviewId,
          removalRevision: review.removalRevision,
          targetKind: "symbolic-link",
          artifactIdentity: inspected.artifact.path,
          name: basename(inspected.artifact.path),
          parentDirectory: dirname(inspected.artifact.path),
          category: inspected.artifact.category,
          scope: inspected.artifact.scope,
          harnesses: inspected.artifact.harnesses,
          linkState: inspected.resolvedPath === null ? "broken" : "healthy",
          resolvedPath: inspected.resolvedPath,
          targetBoundary: inspected.targetBoundary,
          summary: {
            entries: 1,
            files: 0,
            directories: 0,
            symbolicLinks: 1,
            totalBytes: Number(inspected.revision.entry.size),
          },
          consequence: "link-only",
        };
      }
      if (candidate?.kind === "directory") {
        const inspected = await inspectDirectoryRemoval(request, artifactIdentity);
        if (inspected.scan.status === "refused") {
          invalidateReview(inspected.artifact.path);
          return {
            status: "refused",
            code: "removal-preview-too-large",
            targetKind: "managed-skill-directory",
            artifactIdentity: inspected.artifact.path,
            skillName: inspected.skillName,
            parentSkillsRoot: inspected.parentSkillsRoot,
            reason: inspected.scan.reason,
            observedAtLeast: inspected.scan.observedAtLeast,
            limits: { entries: MAX_REMOVAL_ENTRIES, bytes: MAX_REMOVAL_BYTES },
            canReveal: true,
          };
        }
        const revision = inspected.revision!;
        const review = storeReview(revision);
        return {
          status: "ready",
          removalReviewId: review.removalReviewId,
          removalRevision: review.removalRevision,
          targetKind: "managed-skill-directory",
          artifactIdentity: inspected.artifact.path,
          skillName: inspected.skillName,
          parentSkillsRoot: inspected.parentSkillsRoot,
          scope: inspected.artifact.scope,
          harnesses: inspected.harnesses,
          summary: inspected.scan.summary,
          tree: inspected.scan.tree,
        };
      }

      const inspected = await inspectFileRemoval(request, artifactIdentity);
      const review = storeReview(inspected.revision);
      const hardLinkCount = Number(inspected.info.nlink);
      return {
        removalReviewId: review.removalReviewId,
        removalRevision: review.removalRevision,
        targetKind: "file",
        artifactIdentity: inspected.artifact.path,
        name: basename(inspected.artifact.path),
        parentDirectory: dirname(inspected.artifact.path),
        category: inspected.artifact.category,
        scope: inspected.artifact.scope,
        harnesses: inspected.artifact.harnesses,
        summary: {
          entries: 1,
          files: 1,
          directories: 0,
          symbolicLinks: 0,
          totalBytes: Number(inspected.info.size),
        },
        ...(hardLinkCount > 1 ? { hardLinkCount } : {}),
        ...(basename(inspected.artifact.path) === "SKILL.md" ? {
          skillWarning: {
            code: "skill-may-be-disabled" as const,
            directory: dirname(inspected.artifact.path),
            harnesses: inspected.artifact.harnesses,
          },
        } : {}),
      };
    },

    async apply(input) {
      const review = reviews.get(input.removalReviewId);
      if (!review) throw new ManagementError(409, "removal-review-invalid", "The Removal Preview is no longer valid.");
      reviews.delete(input.removalReviewId);
      if (latestByArtifact.get(review.revision.artifactIdentity) === input.removalReviewId) {
        latestByArtifact.delete(review.revision.artifactIdentity);
      }
      if (review.revision.targetKind === "managed-skill-directory" && input.confirmationName !== review.revision.skillName) {
        throw new ManagementError(422, "removal-confirmation-invalid", "The confirmation must exactly match the Managed Skill Directory name.", {
          path: review.revision.artifactIdentity,
        });
      }

      return coordinator.withMutation([mutationScopeFor(review.revision)], async () => {
        let currentRevision: RemovalRevision;
        try {
          if (review.revision.targetKind === "managed-skill-directory") {
            const current = await inspectDirectoryRemoval(request, review.revision.artifactIdentity);
            if (current.scan.status === "refused" || !current.revision || input.confirmationName !== current.skillName) throw new Error("changed");
            currentRevision = current.revision;
          } else if (review.revision.targetKind === "symbolic-link") {
            currentRevision = (await inspectSymbolicLinkRemoval(request, review.revision.artifactIdentity)).revision;
          } else {
            currentRevision = (await inspectFileRemoval(request, review.revision.artifactIdentity)).revision;
          }
        } catch {
          throw new ManagementError(409, "removal-changed", "The selected target changed after Removal Preview.", {
            path: review.revision.artifactIdentity,
          });
        }
        if (JSON.stringify(currentRevision) !== JSON.stringify(review.revision)) {
          throw new ManagementError(409, "removal-changed", "The selected target changed after Removal Preview.", {
            path: review.revision.artifactIdentity,
          });
        }
        const parent = review.revision.targetKind === "managed-skill-directory"
          ? review.revision.parentSkillsRoot.canonicalPath
          : review.revision.parent.canonicalPath;
        try {
          await access(parent, constants.W_OK | constants.X_OK);
        } catch {
          throw new ManagementError(409, "removal-changed", "The selected target permissions changed after Removal Preview.", {
            path: review.revision.artifactIdentity,
          });
        }
        const intent: TrashIntent = { path: review.revision.artifactIdentity, targetKind: review.revision.targetKind };
        try {
          await systemGateway.moveToTrash(intent);
        } catch (error) {
          throw mapTrashError(error, review.revision.artifactIdentity);
        }
        return {
          action: "recoverable-removal",
          artifactIdentity: review.revision.artifactIdentity,
          targetKind: review.revision.targetKind,
          result: "moved-to-trash",
          occurredAt: new Date().toISOString(),
        };
      });
    },

    async openTrash() {
      try {
        await systemGateway.openTrash();
      } catch (error) {
        throw mapTrashError(error);
      }
      return { ok: true, action: "open-trash" };
    },
  };
}
