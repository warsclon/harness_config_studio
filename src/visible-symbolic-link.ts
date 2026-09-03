import type { BigIntStats } from "node:fs";
import { lstat, readlink, realpath } from "node:fs/promises";

export type VisibleSymbolicLinkRevision = Readonly<{
  artifactIdentity: string;
  rawLinkTargetBase64: string;
  device: string;
  inode: string;
  size: string;
  mode: number;
  uid: number;
  gid: number;
  modifiedNs: string;
  changedNs: string;
  resolvedPath: string | null;
}>;

function revisionFromStats(
  artifactIdentity: string,
  rawLinkTargetBase64: string,
  resolvedPath: string | null,
  info: BigIntStats,
): VisibleSymbolicLinkRevision {
  return {
    artifactIdentity,
    rawLinkTargetBase64,
    device: info.dev.toString(),
    inode: info.ino.toString(),
    size: info.size.toString(),
    mode: Number(info.mode & 0o7777n),
    uid: Number(info.uid),
    gid: Number(info.gid),
    modifiedNs: info.mtimeNs.toString(),
    changedNs: info.ctimeNs.toString(),
    resolvedPath,
  };
}

export function sameVisibleSymbolicLink(
  left: VisibleSymbolicLinkRevision,
  right: VisibleSymbolicLinkRevision,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function inspectVisibleSymbolicLink(
  artifactIdentity: string,
): Promise<VisibleSymbolicLinkRevision | undefined> {
  const before = await lstat(artifactIdentity, { bigint: true }).catch(() => undefined);
  if (!before?.isSymbolicLink()) return undefined;
  const rawLinkTarget = await readlink(artifactIdentity, { encoding: "buffer" }).catch(() => undefined);
  if (!rawLinkTarget) return undefined;
  const resolvedPath = await realpath(artifactIdentity).catch(() => null);
  const after = await lstat(artifactIdentity, { bigint: true }).catch(() => undefined);
  if (!after?.isSymbolicLink()) return undefined;
  const rawLinkTargetBase64 = rawLinkTarget.toString("base64");
  const first = revisionFromStats(artifactIdentity, rawLinkTargetBase64, resolvedPath, before);
  const second = revisionFromStats(artifactIdentity, rawLinkTargetBase64, resolvedPath, after);
  return sameVisibleSymbolicLink(first, second) ? second : undefined;
}
