import { createHash, randomBytes } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { access, link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, unlink } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import {
  inventory,
  type InventoryArtifact,
  type InventoryRequest,
} from "./index.ts";
import {
  FinderGatewayError,
  type FinderRevealIntent,
  type MacOsSystemGateway,
} from "./system-gateway.ts";
import {
  EditableArtifactError,
  decodeEditableBytes,
  encodePendingEdit,
  formatPolicyFor,
  MAX_EDITABLE_BYTES,
  readEditableBytes,
  validatePendingEdit,
  type EditValidation,
  type FormatPolicy,
  type LineEnding,
  type NewlineStyle,
  type EditableTargetRevision,
} from "./editable-artifact.ts";
import type { MutationCoordinator } from "./mutation-coordinator.ts";
import { classifyManagedSkillDirectory } from "./managed-skill-policy.ts";
import {
  inspectVisibleSymbolicLink,
  sameVisibleSymbolicLink,
  type VisibleSymbolicLinkRevision,
} from "./visible-symbolic-link.ts";

export const MAX_EDIT_BYTES = MAX_EDITABLE_BYTES;
const ABANDONED_TEMPORARY_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_IN_MEMORY_EDIT_HANDLES = 32;
const MAX_IN_MEMORY_SAVE_REVIEWS = 32;

type ArtifactEditability = "editable" | "view-only";

type LinkRevision = Omit<VisibleSymbolicLinkRevision, "resolvedPath"> & Readonly<{ resolvedPath: string }>;

type TargetRevision = EditableTargetRevision & Readonly<{
  editRevision: string;
}>;

type ArtifactState = {
  artifactIdentity: string;
  content: string;
  contentPath: string;
  editability: ArtifactEditability;
  editRevision: string;
  mode: number;
  originalBytes: Buffer;
  lineEndings: LineEnding[];
  newlineStyle: NewlineStyle;
  hasUtf8Bom: boolean;
  format: FormatPolicy;
  scope: InventoryArtifact["scope"];
  harnesses: InventoryArtifact["harnesses"];
  isSymbolicLink: boolean;
  linkRevision: LinkRevision | null;
  resolvedPath: string | null;
  targetRevision: TargetRevision;
};

type PendingReview = {
  handle: string;
  editRevision: string;
  proposedContent: string;
  proposedBytes: Buffer;
};

export type OpenedArtifact = {
  artifactIdentity: string;
  content: string;
  editHandle: string;
  editRevision: string;
  format: string;
  editability: ArtifactEditability;
  editabilityReason: "not-writable" | null;
  hasUtf8Bom: boolean;
  newlineByteOverheadMap: string;
  newlineStyle: NewlineStyle;
  scope: InventoryArtifact["scope"];
  harnesses: InventoryArtifact["harnesses"];
  symbolicLink: {
    isSymbolicLink: boolean;
    resolvedPath: string | null;
    brokenLink: boolean;
  };
  writable: boolean;
};

export type SaveReview = {
  reviewId: string;
  artifactIdentity: string;
  editRevision: string;
  symbolicLink: {
    isSymbolicLink: boolean;
    resolvedPath: string | null;
  };
  scope: InventoryArtifact["scope"];
  harnesses: InventoryArtifact["harnesses"];
  validation: EditValidation;
  metadata: {
    format: FormatPolicy["label"];
    newline: "LF" | "CRLF" | "Mixed";
    permissions: string;
    originalBytes: number;
    proposedBytes: number;
  };
  diff: { before: string; after: string };
};

export type SaveResult = {
  artifactIdentity: string;
  backupPath: string;
  backupReference: {
    relativePath: string;
    editRevision: string;
    createdAt: string;
    reused: boolean;
  };
  editRevision: string;
  savedAt: string;
  warning?: {
    code: "save-reconciliation-required";
    message: string;
  };
};

export type ManagementService = {
  openArtifact(artifactIdentity: string): Promise<OpenedArtifact>;
  reviewSave(input: { editHandle: string; editRevision: string; content: string }): Promise<SaveReview>;
  applySave(reviewId: string): Promise<SaveResult>;
};

export class ManagementError extends Error {
  readonly status: number;
  readonly code: string;
  readonly path?: string;
  readonly technicalDetails?: Readonly<Record<string, string | number>>;

  constructor(
    status: number,
    code: string,
    message: string,
    context: {
      path?: string;
      technicalDetails?: Readonly<Record<string, string | number>>;
    } = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.path = context.path;
    this.technicalDetails = context.technicalDetails;
  }
}

export type RevealTargetRef =
  | { kind: "artifact"; artifactIdentity: string }
  | { kind: "latest-artifact-backup"; artifactIdentity: string }
  | { kind: "global-root"; path: string }
  | { kind: "project-root"; path: string }
  | { kind: "managed-skill-directory"; path: string }
  | { kind: "application-data-root" };

export type SystemRevealResult = FinderRevealIntent & {
  ok: true;
  action: "system-reveal";
};

function finderStatus(code: FinderGatewayError["code"]): number {
  if (code === "finder-unavailable") return 503;
  if (code === "finder-reveal-timeout") return 504;
  return 502;
}

export async function applicationDataRootAvailable(home: string): Promise<boolean> {
  const canonicalHome = await realpath(home).catch(() => undefined);
  if (!canonicalHome) return false;
  const info = await lstat(join(canonicalHome, ".harness_config_studio")).catch(() => undefined);
  return Boolean(info?.isDirectory()
    && !info.isSymbolicLink()
    && (info.mode & 0o7777) === 0o700
    && (typeof process.getuid !== "function" || info.uid === process.getuid()));
}

export async function revealManagedLocation(
  request: InventoryRequest,
  target: RevealTargetRef,
  systemGateway: MacOsSystemGateway,
): Promise<SystemRevealResult> {
  if (target.kind === "latest-artifact-backup") {
    throw new ManagementError(422, "reveal-target-not-eligible", "Artifact Backups are resolved by Recovery Wayfinding.");
  }
  let visiblePath: string | undefined;
  if (target.kind === "application-data-root") {
    const canonicalHome = await realpath(request.home).catch(() => undefined);
    if (!canonicalHome) {
      throw new ManagementError(404, "reveal-target-not-found", "The Application Data Root does not exist.");
    }
    const path = join(canonicalHome, ".harness_config_studio");
    const info = await lstat(path).catch(() => undefined);
    if (!info) {
      throw new ManagementError(404, "reveal-target-not-found", "The Application Data Root does not exist.", { path });
    }
    if (info.isSymbolicLink()
      || !info.isDirectory()
      || (info.mode & 0o7777) !== 0o700
      || (typeof process.getuid === "function" && info.uid !== process.getuid())) {
      throw new ManagementError(422, "reveal-target-not-eligible", "The Application Data Root is not a real directory.", { path });
    }
    visiblePath = path;
  } else {
    const snapshot = await inventory(request);
    if (target.kind === "artifact") {
      visiblePath = snapshot.artifacts.find((candidate) => candidate.path === target.artifactIdentity)?.path;
    } else if (target.kind === "global-root") {
      visiblePath = snapshot.globalRoots.find((candidate) => candidate.path === target.path)?.path;
    } else if (target.kind === "project-root") {
      visiblePath = snapshot.projectRoots.find((candidate) => candidate.path === target.path)?.path;
    } else if (target.kind === "managed-skill-directory") {
      const artifact = snapshot.artifacts.find((candidate) => candidate.path === target.path);
      if (!artifact) {
        throw new ManagementError(404, "reveal-target-not-found", "The selected location is not in the current Inventory.", { path: target.path });
      }
      if (!classifyManagedSkillDirectory(snapshot, artifact.path)) {
        throw new ManagementError(422, "reveal-target-not-eligible", "The selected location is not a Managed Skill Directory.", { path: target.path });
      }
      visiblePath = artifact.path;
    }
  }
  if (!visiblePath) {
    const requestedPath = target.kind === "artifact" ? target.artifactIdentity : "path" in target ? target.path : undefined;
    throw new ManagementError(
      404,
      "reveal-target-not-found",
      "The selected location is not in the current Inventory.",
      { ...(typeof requestedPath === "string" ? { path: requestedPath } : {}) },
    );
  }
  const visibleInfo = await lstat(visiblePath).catch(() => undefined);
  if (!visibleInfo) {
    throw new ManagementError(404, "reveal-target-not-found", "The selected location no longer exists.", { path: visiblePath });
  }
  const intent: FinderRevealIntent = {
    disposition: visibleInfo.isSymbolicLink() || !visibleInfo.isDirectory() ? "select-item" : "open-directory",
    path: visiblePath,
  };
  try {
    await systemGateway.reveal(intent);
  } catch (error) {
    if (error instanceof FinderGatewayError) {
      throw new ManagementError(finderStatus(error.code), error.code, error.message, {
        path: visiblePath,
        technicalDetails: error.technicalDetails,
      });
    }
    throw new ManagementError(
      502,
      "finder-reveal-failed",
      "Finder could not reveal the managed location.",
      { path: visiblePath },
    );
  }
  return { ok: true, action: "system-reveal", ...intent };
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sameRevision(left: object, right: object): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function inspectLinkRevision(artifactIdentity: string): Promise<LinkRevision | undefined> {
  const revision = await inspectVisibleSymbolicLink(artifactIdentity);
  return revision?.resolvedPath ? { ...revision, resolvedPath: revision.resolvedPath } : undefined;
}

function targetRevision(revision: EditableTargetRevision, editRevision: string): TargetRevision {
  return { ...revision, editRevision };
}

function replacementTemporaryPrefix(artifactIdentity: string): string {
  return `.harness-config-studio-${sha256(artifactIdentity)}-`;
}

function replacementTemporaryName(artifactIdentity: string): string {
  return `${replacementTemporaryPrefix(artifactIdentity)}${randomBytes(8).toString("hex")}.tmp`;
}

async function cleanupAbandonedReplacementTemporaries(state: ArtifactState): Promise<void> {
  const parent = dirname(state.contentPath);
  let names: string[];
  try {
    names = await readdir(parent);
  } catch {
    throw new ManagementError(403, "temporary-cleanup-failed", "Application-owned temporary files could not be inspected.", {
      path: state.artifactIdentity,
    });
  }
  const prefix = replacementTemporaryPrefix(state.artifactIdentity);
  for (const name of names) {
    if (!name.startsWith(prefix) || !/^[a-f0-9]{16}\.tmp$/.test(name.slice(prefix.length))) continue;
    const path = join(parent, name);
    let info: Stats;
    try {
      info = await lstat(path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw new ManagementError(403, "temporary-cleanup-failed", "An application-owned temporary file could not be inspected.", {
        path: state.artifactIdentity,
      });
    }
    if (!info.isFile() || info.isSymbolicLink() || Date.now() - info.mtimeMs <= ABANDONED_TEMPORARY_AGE_MS) continue;
    try {
      await unlink(path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw new ManagementError(403, "temporary-cleanup-failed", "An abandoned application-owned temporary file could not be removed.", {
        path: state.artifactIdentity,
      });
    }
  }
}

function isInside(path: string, boundary: string): boolean {
  const offset = relative(boundary, path);
  return offset === "" || (!offset.startsWith("..") && !offset.startsWith("/"));
}

async function canonicalBoundaries(request: InventoryRequest, globalRootPaths: string[]): Promise<string[]> {
  const boundaries = [request.workspace, ...globalRootPaths];
  const resolved = await Promise.all(boundaries.map((path) => realpath(path).catch(() => undefined)));
  return resolved.filter((path): path is string => path !== undefined);
}

async function isWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function assertOpenedEditable(state: ArtifactState): void {
  if (state.editability !== "editable") {
    throw new ManagementError(403, "artifact-view-only", "The opened artifact is view-only.");
  }
}

async function assertStillWritable(state: ArtifactState): Promise<void> {
  if (!(await isWritable(state.contentPath))) {
    throw new ManagementError(403, "artifact-view-only", "The opened artifact is no longer writable.");
  }
}

function encodeProposedContent(content: string, state: ArtifactState): Buffer {
  try {
    return encodePendingEdit(content, state);
  } catch (error) {
    if (error instanceof EditableArtifactError) {
      throw new ManagementError(error.status, error.code, error.message, { technicalDetails: error.technicalDetails });
    }
    throw error;
  }
}

async function inspectArtifact(
  request: InventoryRequest,
  artifactIdentity: string,
): Promise<{ opened: Omit<OpenedArtifact, "editHandle">; state: ArtifactState }> {
  const snapshot = await inventory(request);
  const artifact = snapshot.artifacts.find((candidate) => candidate.path === artifactIdentity);
  if (!artifact) throw new ManagementError(404, "artifact-not-found", "The selected artifact is not in the current Inventory.");
  if (artifact.kind !== "file" || artifact.brokenLink) {
    throw new ManagementError(422, "artifact-not-editable", "The selected artifact cannot be opened as text.");
  }

  const format = formatPolicyFor(artifact.path);
  if (!format) throw new ManagementError(415, "format-unsupported", "The selected artifact format is not supported.");

  const visibleInfo = await lstat(artifact.path).catch(() => undefined);
  if (!visibleInfo || visibleInfo.isSymbolicLink() !== artifact.isSymbolicLink) {
    throw new ManagementError(409, "artifact-changed", "The selected artifact changed after Inventory.");
  }
  const openedLinkRevision = artifact.isSymbolicLink ? (await inspectLinkRevision(artifact.path) ?? null) : null;
  const contentPath = artifact.isSymbolicLink ? openedLinkRevision?.resolvedPath : artifact.path;
  if (!contentPath || (artifact.isSymbolicLink && contentPath !== artifact.resolvedPath)) {
    throw new ManagementError(409, "artifact-changed", "The selected symbolic link changed after Inventory.");
  }

  const boundaries = await canonicalBoundaries(request, snapshot.globalRoots.map((root) => root.path));
  const canonicalContentPath = await realpath(contentPath).catch(() => undefined);
  if (!canonicalContentPath || !boundaries.some((boundary) => isInside(canonicalContentPath, boundary))) {
    throw new ManagementError(403, "artifact-outside-boundary", "The selected artifact is outside the Management Boundary.");
  }

  let openedBytes;
  try {
    openedBytes = await readEditableBytes(canonicalContentPath);
  } catch (error) {
    if (error instanceof EditableArtifactError) {
      throw new ManagementError(error.status, error.code, error.message, { technicalDetails: error.technicalDetails });
    }
    throw error;
  }
  const currentVisibleInfo = await lstat(artifact.path).catch(() => undefined);
  const currentLinkRevision = artifact.isSymbolicLink ? (await inspectLinkRevision(artifact.path) ?? null) : null;
  const currentContentPath = artifact.isSymbolicLink ? currentLinkRevision?.resolvedPath : artifact.path;
  const currentBoundaries = await canonicalBoundaries(request, snapshot.globalRoots.map((root) => root.path));
  const currentInfo = await lstat(canonicalContentPath, { bigint: true }).catch(() => undefined);
  if (
    !currentVisibleInfo
    || currentVisibleInfo.isSymbolicLink() !== artifact.isSymbolicLink
    || currentContentPath !== canonicalContentPath
    || !currentBoundaries.some((boundary) => isInside(canonicalContentPath, boundary))
    || !currentInfo?.isFile()
    || currentInfo.dev.toString() !== openedBytes.revision.device
    || currentInfo.ino.toString() !== openedBytes.revision.inode
    || (openedLinkRevision !== null && (currentLinkRevision === null || !sameVisibleSymbolicLink(openedLinkRevision, currentLinkRevision)))
  ) {
    throw new ManagementError(409, "artifact-changed", "The selected artifact changed while it was being opened.");
  }
  let decoded;
  try {
    decoded = decodeEditableBytes(openedBytes.bytes);
  } catch (error) {
    if (error instanceof EditableArtifactError) {
      throw new ManagementError(error.status, error.code, error.message);
    }
    throw error;
  }
  const editRevision = sha256(openedBytes.bytes);
  const openedTargetRevision = targetRevision(openedBytes.revision, editRevision);
  const writable = await isWritable(contentPath);
  return {
    opened: {
      artifactIdentity: artifact.path,
      content: decoded.editorContent,
      editRevision,
      format: format.label,
      editability: writable ? "editable" : "view-only",
      editabilityReason: writable ? null : "not-writable",
      hasUtf8Bom: decoded.hasUtf8Bom,
      newlineByteOverheadMap: decoded.newlineByteOverheadMap,
      newlineStyle: decoded.newlineStyle,
      scope: artifact.scope,
      harnesses: artifact.harnesses,
      symbolicLink: {
        isSymbolicLink: artifact.isSymbolicLink,
        resolvedPath: artifact.resolvedPath,
        brokenLink: artifact.brokenLink,
      },
      writable,
    },
    state: {
      artifactIdentity: artifact.path,
      content: decoded.editorContent,
      contentPath: canonicalContentPath,
      editability: writable ? "editable" : "view-only",
      editRevision,
      mode: openedBytes.revision.mode,
      originalBytes: openedBytes.bytes,
      lineEndings: decoded.lineEndings,
      newlineStyle: decoded.newlineStyle,
      hasUtf8Bom: decoded.hasUtf8Bom,
      format,
      scope: artifact.scope,
      harnesses: artifact.harnesses,
      isSymbolicLink: artifact.isSymbolicLink,
      linkRevision: openedLinkRevision,
      resolvedPath: artifact.resolvedPath,
      targetRevision: openedTargetRevision,
    },
  };
}

async function assertUnchanged(request: InventoryRequest, state: ArtifactState): Promise<void> {
  const snapshot = await inventory(request);
  const artifact = snapshot.artifacts.find((candidate) => candidate.path === state.artifactIdentity);
  if (
    !artifact
    || artifact.kind !== "file"
    || artifact.brokenLink
    || artifact.isSymbolicLink !== state.isSymbolicLink
    || !sameRevision(artifact.scope, state.scope)
    || !sameRevision(artifact.harnesses, state.harnesses)
  ) {
    throw new ManagementError(409, "artifact-changed", "The artifact changed after it was opened.");
  }
  const linkRevision = state.isSymbolicLink ? (await inspectLinkRevision(state.artifactIdentity) ?? null) : null;
  const currentPath = state.isSymbolicLink ? linkRevision?.resolvedPath : state.artifactIdentity;
  const boundaries = await canonicalBoundaries(request, snapshot.globalRoots.map((root) => root.path));
  const canonicalCurrentPath = currentPath ? await realpath(currentPath).catch(() => undefined) : undefined;
  if (
    !canonicalCurrentPath
    || canonicalCurrentPath !== state.contentPath
    || artifact.resolvedPath !== state.resolvedPath
    || !boundaries.some((boundary) => isInside(canonicalCurrentPath, boundary))
    || (state.linkRevision !== null && (linkRevision === null || !sameVisibleSymbolicLink(state.linkRevision, linkRevision)))
  ) {
    throw new ManagementError(409, "artifact-changed", "The artifact changed after it was opened.");
  }
  let openedBytes;
  try {
    openedBytes = await readEditableBytes(canonicalCurrentPath);
  } catch {
    throw new ManagementError(409, "artifact-changed", "The artifact changed after it was opened.");
  }
  const afterLinkRevision = state.isSymbolicLink ? (await inspectLinkRevision(state.artifactIdentity) ?? null) : null;
  const afterPath = state.isSymbolicLink ? afterLinkRevision?.resolvedPath : state.artifactIdentity;
  const afterCanonicalPath = afterPath ? await realpath(afterPath).catch(() => undefined) : undefined;
  const afterBoundaries = await canonicalBoundaries(request, snapshot.globalRoots.map((root) => root.path));
  if (
    afterCanonicalPath !== state.contentPath
    || !sameRevision(targetRevision(openedBytes.revision, sha256(openedBytes.bytes)), state.targetRevision)
    || (state.linkRevision !== null && (afterLinkRevision === null || !sameVisibleSymbolicLink(state.linkRevision, afterLinkRevision)))
    || !afterBoundaries.some((boundary) => afterCanonicalPath !== undefined && isInside(afterCanonicalPath, boundary))
  ) {
    throw new ManagementError(409, "artifact-changed", "The artifact changed after it was opened.");
  }
}

async function inspectSavedTarget(
  request: InventoryRequest,
  state: ArtifactState,
  expectedBytes: Buffer,
): Promise<TargetRevision> {
  const snapshot = await inventory(request);
  const artifact = snapshot.artifacts.find((candidate) => candidate.path === state.artifactIdentity);
  const currentLinkRevision = state.isSymbolicLink ? (await inspectLinkRevision(state.artifactIdentity) ?? null) : null;
  const currentPath = state.isSymbolicLink ? currentLinkRevision?.resolvedPath : state.artifactIdentity;
  const boundaries = await canonicalBoundaries(request, snapshot.globalRoots.map((root) => root.path));
  if (
    !artifact
    || artifact.kind !== "file"
    || artifact.brokenLink
    || artifact.isSymbolicLink !== state.isSymbolicLink
    || !sameRevision(artifact.scope, state.scope)
    || !sameRevision(artifact.harnesses, state.harnesses)
    || !currentPath
    || currentPath !== state.contentPath
    || !boundaries.some((boundary) => isInside(currentPath, boundary))
    || (state.linkRevision !== null && (currentLinkRevision === null || !sameVisibleSymbolicLink(state.linkRevision, currentLinkRevision)))
  ) {
    throw new ManagementError(409, "save-reconciliation-required", "The target was saved but its symbolic-link state now requires review.");
  }
  let savedBytes;
  try {
    savedBytes = await readEditableBytes(currentPath);
  } catch {
    throw new ManagementError(409, "save-reconciliation-required", "The target was saved but its resulting state could not be verified.");
  }
  if (!savedBytes.bytes.equals(expectedBytes) || savedBytes.revision.mode !== state.mode) {
    throw new ManagementError(409, "save-reconciliation-required", "The target was saved but its resulting bytes require review.");
  }
  const afterLinkRevision = state.isSymbolicLink ? (await inspectLinkRevision(state.artifactIdentity) ?? null) : null;
  const afterPath = state.isSymbolicLink ? afterLinkRevision?.resolvedPath : state.artifactIdentity;
  const afterBoundaries = await canonicalBoundaries(request, snapshot.globalRoots.map((root) => root.path));
  if (
    afterPath !== currentPath
    || !afterBoundaries.some((boundary) => isInside(currentPath, boundary))
    || (state.linkRevision !== null && (afterLinkRevision === null || !sameVisibleSymbolicLink(state.linkRevision, afterLinkRevision)))
  ) {
    throw new ManagementError(409, "save-reconciliation-required", "The target was saved but its Management Boundary changed.");
  }
  return targetRevision(savedBytes.revision, sha256(savedBytes.bytes));
}

async function writeDurableFile(path: string, bytes: Buffer, mode: number): Promise<void> {
  const file = await open(path, "wx", mode);
  try {
    await file.writeFile(bytes);
    await file.sync();
    await file.chmod(mode);
  } finally {
    await file.close();
  }
}

async function applicationDataEntry(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new ManagementError(403, "application-data-unavailable", "The Application Data Root could not be inspected.");
  }
}

async function ensurePrivateApplicationDirectory(path: string): Promise<void> {
  const existing = await applicationDataEntry(path);
  if (!existing) {
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw new ManagementError(403, "application-data-unavailable", "The Application Data Root could not be created.");
      }
    }
  }
  const info = await applicationDataEntry(path);
  if (!info?.isDirectory() || info.isSymbolicLink()) {
    throw new ManagementError(409, "application-data-unsafe", "An Application Data Root component is not a real directory.");
  }
  let directory;
  try {
    directory = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const openedInfo = await directory.stat();
    if (!openedInfo.isDirectory()) throw new Error("not-directory");
    await directory.chmod(0o700);
  } catch {
    throw new ManagementError(409, "application-data-unsafe", "An Application Data Root component could not be opened safely.");
  } finally {
    await directory?.close().catch(() => undefined);
  }
}

type RetainedBackup = {
  path: string;
  metadataPath?: string;
  mtimeMs: number;
};

type ArtifactBackupMetadata = Readonly<{
  schemaVersion: 1;
  artifactIdentity: string;
  editRevision: string;
  createdAt: string;
  resolvedPath?: string;
  linkRevision?: string;
  target?: {
    device: string;
    inode: string;
    mode: number;
    byteLength: string;
  };
}>;

function backupMetadata(state: ArtifactState): ArtifactBackupMetadata {
  return {
    schemaVersion: 1,
    artifactIdentity: state.artifactIdentity,
    editRevision: state.editRevision,
    createdAt: new Date().toISOString(),
    ...(state.linkRevision && state.resolvedPath ? {
      resolvedPath: state.resolvedPath,
      linkRevision: sha256(JSON.stringify(state.linkRevision)),
      target: {
        device: state.targetRevision.device,
        inode: state.targetRevision.inode,
        mode: state.targetRevision.mode,
        byteLength: state.targetRevision.size,
      },
    } : {}),
  };
}

function metadataMatches(actual: unknown, expected: ArtifactBackupMetadata): boolean {
  if (typeof actual !== "object" || actual === null) return false;
  const target = Reflect.get(actual, "target");
  return Reflect.get(actual, "schemaVersion") === expected.schemaVersion
    && Reflect.get(actual, "artifactIdentity") === expected.artifactIdentity
    && Reflect.get(actual, "editRevision") === expected.editRevision
    && typeof Reflect.get(actual, "createdAt") === "string"
    && (!expected.resolvedPath
      ? Reflect.get(actual, "resolvedPath") === undefined && Reflect.get(actual, "linkRevision") === undefined && target === undefined
      : Boolean(Reflect.get(actual, "resolvedPath") === expected.resolvedPath
        && Reflect.get(actual, "linkRevision") === expected.linkRevision
        && target && typeof target === "object"
        && Reflect.get(target, "device") === expected.target?.device
        && Reflect.get(target, "inode") === expected.target?.inode
        && Reflect.get(target, "mode") === expected.target?.mode
        && Reflect.get(target, "byteLength") === expected.target?.byteLength));
}

function isArtifactBackupMetadata(value: unknown, editRevision: string): value is ArtifactBackupMetadata {
  if (typeof value !== "object" || value === null) return false;
  const resolvedPath = Reflect.get(value, "resolvedPath");
  const linkRevision = Reflect.get(value, "linkRevision");
  const target = Reflect.get(value, "target");
  return Reflect.get(value, "schemaVersion") === 1
    && typeof Reflect.get(value, "artifactIdentity") === "string"
    && Reflect.get(value, "editRevision") === editRevision
    && typeof Reflect.get(value, "createdAt") === "string"
    && (resolvedPath === undefined
      ? linkRevision === undefined && target === undefined
      : Boolean(typeof resolvedPath === "string"
      && /^[a-f0-9]{64}$/.test(String(linkRevision))
      && target && typeof target === "object"
      && typeof Reflect.get(target, "device") === "string"
      && typeof Reflect.get(target, "inode") === "string"
      && typeof Reflect.get(target, "mode") === "number"
      && typeof Reflect.get(target, "byteLength") === "string"));
}

async function readBackupMetadata(path: string): Promise<unknown | undefined> {
  const info = await applicationDataEntry(path);
  if (!info) return undefined;
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o7777) !== 0o600) {
    throw new ManagementError(500, "backup-retention-failed", "Artifact Backup metadata is unsafe.");
  }
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    const editRevision = basename(path, ".json");
    if (!isArtifactBackupMetadata(parsed, editRevision)) throw new Error("invalid-metadata");
    return parsed;
  } catch {
    throw new ManagementError(500, "backup-retention-failed", "Artifact Backup metadata is corrupt.");
  }
}

async function readMatchingBackupMetadata(path: string): Promise<unknown | undefined> {
  try {
    return await readBackupMetadata(path);
  } catch {
    throw new ManagementError(500, "backup-conflict", "The existing backup metadata does not match the opened artifact.");
  }
}

async function retainedBackups(artifactRoot: string): Promise<RetainedBackup[]> {
  let names: string[];
  try {
    names = await readdir(artifactRoot);
  } catch {
    throw new ManagementError(500, "backup-retention-failed", "Artifact Backup retention could not inspect its private directory.");
  }
  const backups: RetainedBackup[] = [];
  const namesSet = new Set(names);
  for (const name of names) {
    if (/^[a-f0-9]{64}\.json$/.test(name) && !namesSet.has(`${name.slice(0, -5)}.bak`)) {
      throw new ManagementError(500, "backup-retention-failed", "Artifact Backup retention found orphan metadata.");
    }
  }
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.bak$/.test(name)) continue;
    const path = join(artifactRoot, name);
    const info = await applicationDataEntry(path);
    if (!info?.isFile() || info.isSymbolicLink() || (info.mode & 0o7777) !== 0o600) {
      throw new ManagementError(500, "backup-retention-failed", "Artifact Backup retention found an unsafe backup entry.");
    }
    const bytes = await readFile(path).catch(() => undefined);
    if (!bytes || sha256(bytes) !== name.slice(0, -4)) {
      throw new ManagementError(500, "backup-retention-failed", "Artifact Backup retention found a corrupt backup entry.");
    }
    const metadataPath = join(artifactRoot, `${name.slice(0, -4)}.json`);
    const metadataInfo = await applicationDataEntry(metadataPath);
    if (metadataInfo) await readBackupMetadata(metadataPath);
    backups.push({ path, ...(metadataInfo ? { metadataPath } : {}), mtimeMs: info.mtimeMs });
  }
  backups.sort((left, right) => left.mtimeMs - right.mtimeMs || left.path.localeCompare(right.path));
  return backups;
}

async function enforceBackupLimit(
  artifactRoot: string,
  maximum: number,
  protectedPath?: string,
): Promise<void> {
  const backups = await retainedBackups(artifactRoot);
  const candidates = backups.filter((backup) => backup.path !== protectedPath);
  let excess = backups.length - maximum;
  for (const backup of candidates) {
    if (excess <= 0) break;
    try {
      if (backup.metadataPath) await unlink(backup.metadataPath);
      await unlink(backup.path);
    } catch {
      throw new ManagementError(500, "backup-retention-failed", "The oldest Artifact Backup could not be pruned.");
    }
    excess -= 1;
  }
  if (excess > 0) {
    throw new ManagementError(500, "backup-retention-failed", "Artifact Backup retention could not reach its bounded limit.");
  }
}

async function createBackup(home: string, state: ArtifactState): Promise<{ path: string; reused: boolean; createdAt: string }> {
  const dataRoot = join(home, ".harness_config_studio");
  const backupRoot = join(dataRoot, "backups");
  const artifactRoot = join(backupRoot, sha256(state.artifactIdentity));
  await ensurePrivateApplicationDirectory(dataRoot);
  await ensurePrivateApplicationDirectory(backupRoot);
  await ensurePrivateApplicationDirectory(artifactRoot);
  const backupPath = join(artifactRoot, `${state.editRevision}.bak`);
  const metadataPath = join(artifactRoot, `${state.editRevision}.json`);
  const expectedMetadata = backupMetadata(state);
  const backupInfo = await applicationDataEntry(backupPath);
  if (backupInfo && (!backupInfo.isFile() || backupInfo.isSymbolicLink())) {
    throw new ManagementError(500, "backup-conflict", "The matching Artifact Backup path is not a real file.");
  }
  const originalBytes = state.originalBytes;
  const existing = backupInfo ? await readFile(backupPath).catch(() => undefined) : undefined;
  if (backupInfo && ((backupInfo.mode & 0o7777) !== 0o600 || !existing?.equals(originalBytes))) {
    throw new ManagementError(500, "backup-conflict", "The existing backup does not match the opened revision.");
  }
  const metadataInfo = await applicationDataEntry(metadataPath);
  const existingMetadata = metadataInfo ? await readMatchingBackupMetadata(metadataPath) : undefined;
  if (existingMetadata && !metadataMatches(existingMetadata, expectedMetadata)) {
    throw new ManagementError(500, "backup-conflict", "The existing backup metadata does not match the opened artifact.");
  }
  if (backupInfo && existingMetadata) {
    await enforceBackupLimit(artifactRoot, 10, backupPath);
    return { path: backupPath, reused: true, createdAt: String(Reflect.get(existingMetadata, "createdAt")) };
  }
  const temporaryPath = join(artifactRoot, `.${state.editRevision}.${randomBytes(8).toString("hex")}.backup-stage`);
  const temporaryMetadataPath = `${temporaryPath}.json`;
  let reused = Boolean(backupInfo || existingMetadata);
  try {
    try {
      await writeDurableFile(temporaryPath, originalBytes, 0o600);
      await writeDurableFile(temporaryMetadataPath, Buffer.from(`${JSON.stringify(expectedMetadata)}\n`, "utf8"), 0o600);
    } catch {
      throw new ManagementError(500, "backup-create-failed", "The Artifact Backup could not be created.");
    }
    if (!backupInfo) {
      try {
        await link(temporaryPath, backupPath);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
          throw new ManagementError(500, "backup-create-failed", "The Artifact Backup could not be published.");
        }
        reused = true;
      }
    }
    const publishedInfo = await applicationDataEntry(backupPath);
    const publishedBytes = publishedInfo?.isFile() && !publishedInfo.isSymbolicLink()
      ? await readFile(backupPath).catch(() => undefined)
      : undefined;
    if (!publishedInfo || (publishedInfo.mode & 0o7777) !== 0o600 || !publishedBytes?.equals(originalBytes)) {
      throw new ManagementError(500, "backup-conflict", "The existing backup does not match the opened revision.");
    }
    if (!existingMetadata) {
      try {
        await link(temporaryMetadataPath, metadataPath);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
          throw new ManagementError(500, "backup-create-failed", "The Artifact Backup metadata could not be published.");
        }
        reused = true;
      }
    }
    const publishedMetadata = await readMatchingBackupMetadata(metadataPath);
    if (!publishedMetadata || !metadataMatches(publishedMetadata, expectedMetadata)) {
      throw new ManagementError(500, "backup-conflict", "The published backup metadata does not match the opened artifact.");
    }
    await enforceBackupLimit(artifactRoot, 10, backupPath);
    return { path: backupPath, reused, createdAt: String(Reflect.get(publishedMetadata, "createdAt")) };
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    await rm(temporaryMetadataPath, { force: true }).catch(() => undefined);
  }
}

export function createManagement(request: InventoryRequest, coordinator: MutationCoordinator): ManagementService {
  const artifacts = new Map<string, ArtifactState>();
  const reviews = new Map<string, PendingReview>();

  function boundEditHandles(): void {
    while (artifacts.size > MAX_IN_MEMORY_EDIT_HANDLES) {
      const oldestHandle = artifacts.keys().next().value as string | undefined;
      if (!oldestHandle) break;
      artifacts.delete(oldestHandle);
      for (const [reviewId, review] of reviews) {
        if (review.handle === oldestHandle) reviews.delete(reviewId);
      }
    }
  }

  function boundSaveReviews(): void {
    while (reviews.size > MAX_IN_MEMORY_SAVE_REVIEWS) {
      const oldestReviewId = reviews.keys().next().value as string | undefined;
      if (!oldestReviewId) break;
      reviews.delete(oldestReviewId);
    }
  }

  return {
    async openArtifact(artifactIdentity) {
      const inspected = await inspectArtifact(request, artifactIdentity);
      await cleanupAbandonedReplacementTemporaries(inspected.state);
      const editHandle = randomBytes(24).toString("base64url");
      artifacts.set(editHandle, inspected.state);
      boundEditHandles();
      return { ...inspected.opened, editHandle };
    },

    async reviewSave({ editHandle, editRevision, content }) {
      const state = artifacts.get(editHandle);
      if (!state || state.editRevision !== editRevision) {
        throw new ManagementError(409, "edit-revision-invalid", "The opened edit revision is no longer valid.");
      }
      assertOpenedEditable(state);
      const proposedBytes = encodeProposedContent(content, state);
      if (proposedBytes.equals(state.originalBytes)) {
        throw new ManagementError(422, "edit-clean", "There are no pending changes to review.");
      }
      let validation: EditValidation;
      try {
        validation = validatePendingEdit(state.format.id, content);
      } catch (error) {
        if (error instanceof EditableArtifactError) {
          throw new ManagementError(error.status, error.code, error.message, { technicalDetails: error.technicalDetails });
        }
        throw error;
      }
      await assertUnchanged(request, state);
      await assertStillWritable(state);
      const reviewId = randomBytes(24).toString("base64url");
      reviews.set(reviewId, { handle: editHandle, editRevision: state.editRevision, proposedContent: content, proposedBytes });
      boundSaveReviews();
      return {
        reviewId,
        artifactIdentity: state.artifactIdentity,
        editRevision: state.editRevision,
        symbolicLink: {
          isSymbolicLink: state.isSymbolicLink,
          resolvedPath: state.resolvedPath,
        },
        scope: state.scope,
        harnesses: state.harnesses,
        validation,
        metadata: {
          format: state.format.label,
          newline: state.newlineStyle === "crlf" ? "CRLF" : state.newlineStyle === "mixed" ? "Mixed" : "LF",
          permissions: `0${state.mode.toString(8)}`,
          originalBytes: state.originalBytes.length,
          proposedBytes: proposedBytes.length,
        },
        diff: { before: state.content, after: content },
      };
    },

    async applySave(reviewId) {
      const review = reviews.get(reviewId);
      const state = review ? artifacts.get(review.handle) : undefined;
      if (!review || !state) throw new ManagementError(409, "save-review-invalid", "The Save Review is no longer valid.");
      const mutationPaths = state.artifactIdentity === state.contentPath
        ? [state.artifactIdentity]
        : [state.artifactIdentity, state.contentPath];
      try {
        return await coordinator.withMutation(
          mutationPaths.map((path) => ({ kind: "exact" as const, path })),
          async () => {
          if (state.editRevision !== review.editRevision) {
            reviews.delete(reviewId);
            throw new ManagementError(409, "save-review-stale", "The Save Review was superseded by another save.");
          }
          assertOpenedEditable(state);
          try {
            const authoritativeBytes = encodePendingEdit(review.proposedContent, state);
            validatePendingEdit(state.format.id, review.proposedContent);
            if (!authoritativeBytes.equals(review.proposedBytes)) {
              throw new ManagementError(409, "save-review-stale", "The Save Review content changed before Apply.");
            }
          } catch (error) {
            if (error instanceof EditableArtifactError) {
              throw new ManagementError(error.status, error.code, error.message, { technicalDetails: error.technicalDetails });
            }
            throw error;
          }
          await assertUnchanged(request, state);
          await assertStillWritable(state);
          let backup: Awaited<ReturnType<typeof createBackup>>;
          try {
            backup = await createBackup(request.home, state);
          } catch (error) {
            if (error instanceof ManagementError) {
              throw new ManagementError(error.status, error.code, error.message, {
                path: error.path ?? state.artifactIdentity,
                technicalDetails: error.technicalDetails,
              });
            }
            throw new ManagementError(500, "backup-create-failed", "The Artifact Backup could not be created.", {
              path: state.artifactIdentity,
            });
          }
          const temporaryPath = join(dirname(state.contentPath), replacementTemporaryName(state.artifactIdentity));
          try {
            await writeDurableFile(temporaryPath, review.proposedBytes, state.mode);
            await assertUnchanged(request, state);
            await assertStillWritable(state);
            await rename(temporaryPath, state.contentPath);
          } catch (error) {
            if (error instanceof ManagementError) throw error;
            throw new ManagementError(500, "save-replacement-failed", "The reviewed edit could not replace the original artifact.", {
              path: state.artifactIdentity,
            });
          } finally {
            await rm(temporaryPath, { force: true }).catch(() => undefined);
          }
          const nextRevision = sha256(review.proposedBytes);
          let warning: SaveResult["warning"];
          try {
            const savedTargetRevision = await inspectSavedTarget(request, state, review.proposedBytes);
            state.content = review.proposedContent;
            state.editRevision = nextRevision;
            state.originalBytes = review.proposedBytes;
            state.targetRevision = savedTargetRevision;
          } catch (error) {
            if (!(error instanceof ManagementError) || error.code !== "save-reconciliation-required") throw error;
            artifacts.delete(review.handle);
            warning = { code: "save-reconciliation-required", message: error.message };
          }
          reviews.delete(reviewId);
          return {
            artifactIdentity: state.artifactIdentity,
            backupPath: backup.path,
            backupReference: {
              relativePath: relative(join(request.home, ".harness_config_studio"), backup.path),
              editRevision: review.editRevision,
              createdAt: backup.createdAt,
              reused: backup.reused,
            },
            editRevision: nextRevision,
            savedAt: new Date().toISOString(),
            ...(warning ? { warning } : {}),
          };
          },
        );
      } catch (error) {
        if (error instanceof ManagementError && !error.path) {
          throw new ManagementError(error.status, error.code, error.message, {
            path: state.artifactIdentity,
            technicalDetails: error.technicalDetails,
          });
        }
        throw error;
      }
    },
  };
}
