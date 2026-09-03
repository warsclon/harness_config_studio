import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { PROJECT_ARTIFACTS, type ProjectArtifactPattern } from "./adapters.ts";
import { addUniqueWarning, pathPresence, type InventoryWarning } from "./path-probe.ts";

export type DiscoveredProjectRoot = {
  name: string;
  path: string;
  detectedBy: string[];
  scopes: string[];
};

export type DiscoveredProjectArtifact = {
  pattern: ProjectArtifactPattern;
  projectRoot: string;
  directory: string;
  path: string;
};

export type ProjectDiscovery = {
  projectRoots: DiscoveredProjectRoot[];
  artifacts: DiscoveredProjectArtifact[];
  warnings: InventoryWarning[];
};

export async function discoverProjectConfiguration(
  workspace: string,
  maxDepth: number,
): Promise<ProjectDiscovery> {
  const projectRoots: DiscoveredProjectRoot[] = [];
  const artifacts: DiscoveredProjectArtifact[] = [];
  const warnings: InventoryWarning[] = [];
  const projectRootByPath = new Map<string, DiscoveredProjectRoot>();

  function addWarning(warning: InventoryWarning): void {
    addUniqueWarning(warnings, warning);
  }

  async function visit(directory: string, depth: number, inheritedProjectRoot?: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      addWarning({ code: "unreadable-path", path: directory, message: "Unable to read directory" });
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    const names = new Set(entries.map((entry) => entry.name));
    const recognizedMarkers: string[] = [];
    for (const pattern of PROJECT_ARTIFACTS) {
      if (recognizedMarkers.includes(pattern.relativePath)) continue;
      const path = join(directory, pattern.relativePath);
      const presence = await pathPresence(path);
      if (presence === "present") recognizedMarkers.push(pattern.relativePath);
      if (presence === "unreadable") {
        addWarning({ code: "unreadable-path", path, message: "Unable to inspect path" });
      }
    }

    const startsProject = names.has(".git") || (!inheritedProjectRoot && recognizedMarkers.length > 0);
    const projectRoot = startsProject ? directory : inheritedProjectRoot;
    if (startsProject && !projectRootByPath.has(directory)) {
      const detectedBy = [names.has(".git") ? ".git" : undefined, ...recognizedMarkers]
        .filter((value): value is string => value !== undefined);
      const entry = { name: basename(directory), path: directory, detectedBy, scopes: [] };
      projectRootByPath.set(directory, entry);
      projectRoots.push(entry);
    }

    if (projectRoot) {
      let foundScopeArtifact = false;
      for (const pattern of PROJECT_ARTIFACTS) {
        const path = join(directory, pattern.relativePath);
        const presence = await pathPresence(path);
        if (presence === "unreadable") {
          addWarning({ code: "unreadable-path", path, message: "Unable to inspect path" });
          continue;
        }
        if (presence === "missing") continue;
        artifacts.push({ pattern, projectRoot, directory, path });
        foundScopeArtifact = true;
      }
      if (foundScopeArtifact && directory !== projectRoot) {
        const scopes = projectRootByPath.get(projectRoot)?.scopes;
        if (scopes && !scopes.includes(directory)) scopes.push(directory);
      }
    }

    if (depth >= maxDepth) {
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === ".git") continue;
        addWarning({
          code: "depth-limit",
          path: join(directory, entry.name),
          message: `Skipped directory beyond max depth ${maxDepth}`,
        });
      }
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".git") continue;
      await visit(join(directory, entry.name), depth + 1, projectRoot);
    }
  }

  await visit(workspace, 0);
  projectRoots.sort((left, right) => left.path.localeCompare(right.path));
  for (const projectRoot of projectRoots) projectRoot.scopes.sort((left, right) => left.localeCompare(right));
  warnings.sort((left, right) => left.path.localeCompare(right.path));
  return { projectRoots, artifacts, warnings };
}

export type { InventoryWarning } from "./path-probe.ts";
