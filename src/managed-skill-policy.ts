import { basename, dirname, join } from "node:path";
import { HARNESS_ADAPTERS, PROJECT_ARTIFACTS } from "./adapters.ts";
import type { InventoryArtifact, InventoryResult } from "./index.ts";

export type ManagedSkillDirectory = Readonly<{
  artifact: InventoryArtifact;
  parentSkillsRoot: InventoryArtifact;
}>;

export function recognizedSkillsRoots(snapshot: InventoryResult): Map<string, InventoryArtifact> {
  const roots = new Map<string, InventoryArtifact>();
  for (const artifact of snapshot.artifacts) {
    if (artifact.category !== "skills" || artifact.kind !== "directory" || artifact.isSymbolicLink) continue;
    if (artifact.scope.kind === "project") {
      const scope = artifact.scope;
      if (PROJECT_ARTIFACTS.some((pattern) => (
        pattern.category === "skills"
        && join(scope.directory, pattern.relativePath) === artifact.path
      ))) roots.set(artifact.path, artifact);
      continue;
    }
    const scope = artifact.scope;
    for (const adapter of HARNESS_ADAPTERS) {
      for (const root of adapter.globalRoots) {
        if (root.path(snapshot.home) !== scope.root) continue;
        if (root.artifacts.some((pattern) => (
          pattern.category === "skills"
          && join(scope.root, pattern.relativePath) === artifact.path
        ))) roots.set(artifact.path, artifact);
      }
    }
  }
  return roots;
}

export function classifyManagedSkillDirectory(
  snapshot: InventoryResult,
  artifactIdentity: string,
): ManagedSkillDirectory | undefined {
  const artifact = snapshot.artifacts.find((candidate) => candidate.path === artifactIdentity);
  if (!artifact || artifact.category !== "skills" || artifact.kind !== "directory" || artifact.isSymbolicLink) {
    return undefined;
  }
  const name = basename(artifact.path);
  if (!name || name === "." || name === ".." || name.startsWith(".")) return undefined;
  const parentSkillsRoot = recognizedSkillsRoots(snapshot).get(dirname(artifact.path));
  if (!parentSkillsRoot) return undefined;
  if (snapshot.globalRoots.some((root) => root.path === artifact.path)) return undefined;
  if (snapshot.projectRoots.some((root) => root.path === artifact.path)) return undefined;
  return { artifact, parentSkillsRoot };
}
