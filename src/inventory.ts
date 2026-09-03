import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  HARNESS_ADAPTERS,
  type ArtifactCategory,
  type HarnessId,
} from "./adapters.ts";
import {
  discoverProjectConfiguration,
  type DiscoveredProjectRoot,
  type InventoryWarning,
} from "./discovery.ts";
import { addUniqueWarning, pathPresence } from "./path-probe.ts";

export type InventoryRequest = {
  home: string;
  workspace: string;
  maxDepth?: number;
};

export type InventoryEnvironment = {
  now?: () => string;
};

export type PathMetadata = {
  kind: "file" | "directory" | "other";
  isSymbolicLink: boolean;
  resolvedPath: string | null;
  brokenLink: boolean;
};

export type InventoryGlobalRoot = PathMetadata & {
  harnesses: HarnessId[];
  path: string;
};

export type InventoryArtifact = PathMetadata & {
  harnesses: HarnessId[];
  category: ArtifactCategory;
  scope:
    | { kind: "global"; root: string }
    | { kind: "project"; projectRoot: string; directory: string };
  path: string;
};

export type InventoryResult = {
  schemaVersion: 1;
  generatedAt: string;
  home: string;
  workspace: string;
  harnesses: Array<{ id: HarnessId; status: "found" | "not-found" }>;
  globalRoots: InventoryGlobalRoot[];
  artifacts: InventoryArtifact[];
  projectRoots: DiscoveredProjectRoot[];
  warnings: InventoryWarning[];
};

async function canonicalDirectory(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isDirectory()) throw new Error(`Not a directory: ${path}`);
  return realpath(path);
}

async function inspectPath(path: string): Promise<PathMetadata> {
  const linkInfo = await lstat(path);
  if (!linkInfo.isSymbolicLink()) {
    return {
      kind: linkInfo.isFile() ? "file" : linkInfo.isDirectory() ? "directory" : "other",
      isSymbolicLink: false,
      resolvedPath: null,
      brokenLink: false,
    };
  }
  try {
    const [targetInfo, resolvedPath] = await Promise.all([stat(path), realpath(path)]);
    return {
      kind: targetInfo.isFile() ? "file" : targetInfo.isDirectory() ? "directory" : "other",
      isSymbolicLink: true,
      resolvedPath,
      brokenLink: false,
    };
  } catch {
    return { kind: "other", isSymbolicLink: true, resolvedPath: null, brokenLink: true };
  }
}

export async function inventory(
  request: InventoryRequest,
  environment: InventoryEnvironment = {},
): Promise<InventoryResult> {
  const home = await canonicalDirectory(request.home);
  const workspace = await canonicalDirectory(request.workspace);
  const harnessOrder: HarnessId[] = ["codex", "claude", "opencode", "pi"];
  const globalRoots: InventoryGlobalRoot[] = [];
  const artifacts: InventoryArtifact[] = [];
  const warnings: InventoryWarning[] = [];

  function sortHarnesses(harnesses: HarnessId[]): void {
    harnesses.sort((left, right) => harnessOrder.indexOf(left) - harnessOrder.indexOf(right));
  }

  function addWarning(warning: InventoryWarning): void {
    addUniqueWarning(warnings, warning);
  }

  function addByPath<T extends { path: string; harnesses: HarnessId[] }>(collection: T[], item: T): void {
    const existing = collection.find((candidate) => candidate.path === item.path);
    if (!existing) {
      collection.push(item);
      return;
    }
    for (const harness of item.harnesses) {
      if (!existing.harnesses.includes(harness)) existing.harnesses.push(harness);
    }
    sortHarnesses(existing.harnesses);
  }

  async function collectArtifactTree(
    path: string,
    category: ArtifactCategory,
    harnesses: HarnessId[],
    scope: InventoryArtifact["scope"],
    recursive: boolean,
  ): Promise<void> {
    const metadata = await inspectPath(path);
    addByPath(artifacts, { harnesses: [...harnesses], category, scope, path, ...metadata });
    if (!recursive || metadata.kind !== "directory" || metadata.isSymbolicLink) return;
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      addWarning({ code: "unreadable-path", path, message: "Unable to read directory" });
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      await collectArtifactTree(join(path, entry.name), category, harnesses, scope, true);
    }
  }

  for (const adapter of HARNESS_ADAPTERS) {
    for (const rootDefinition of adapter.globalRoots) {
      const rootPath = rootDefinition.path(home);
      const rootPresence = await pathPresence(rootPath);
      if (rootPresence === "unreadable") {
        addWarning({ code: "unreadable-path", path: rootPath, message: "Unable to inspect path" });
        continue;
      }
      if (rootPresence === "missing") continue;
      const rootMetadata = await inspectPath(rootPath);
      addByPath(globalRoots, { harnesses: [adapter.id], path: rootPath, ...rootMetadata });
      if (rootMetadata.kind !== "directory" || rootMetadata.isSymbolicLink) continue;
      try {
        await readdir(rootPath);
      } catch {
        addWarning({ code: "unreadable-path", path: rootPath, message: "Unable to read directory" });
        continue;
      }

      for (const pattern of rootDefinition.artifacts) {
        const path = join(rootPath, pattern.relativePath);
        const presence = await pathPresence(path);
        if (presence === "unreadable") {
          addWarning({ code: "unreadable-path", path, message: "Unable to inspect path" });
          continue;
        }
        if (presence === "missing") continue;
        await collectArtifactTree(
          path,
          pattern.category,
          [adapter.id],
          { kind: "global", root: rootPath },
          pattern.recursive ?? false,
        );
      }
    }
  }

  const discovery = await discoverProjectConfiguration(workspace, request.maxDepth ?? 4);
  for (const warning of discovery.warnings) addWarning(warning);
  for (const discovered of discovery.artifacts) {
    await collectArtifactTree(
      discovered.path,
      discovered.pattern.category,
      discovered.pattern.harnesses,
      { kind: "project", projectRoot: discovered.projectRoot, directory: discovered.directory },
      discovered.pattern.recursive ?? false,
    );
  }

  globalRoots.sort((left, right) => left.path.localeCompare(right.path));
  artifacts.sort((left, right) => left.path.localeCompare(right.path));
  warnings.sort((left, right) => left.path.localeCompare(right.path));
  const harnesses = harnessOrder.map((id) => ({
    id,
    status: globalRoots.some((root) => root.harnesses.includes(id))
      || artifacts.some((artifact) => artifact.harnesses.includes(id))
      ? "found" as const
      : "not-found" as const,
  }));

  return {
    schemaVersion: 1,
    generatedAt: environment.now?.() ?? new Date().toISOString(),
    home,
    workspace,
    harnesses,
    globalRoots,
    artifacts,
    projectRoots: discovery.projectRoots,
    warnings,
  };
}

export type { HarnessId } from "./adapters.ts";
export type { DiscoveredProjectRoot as InventoryProjectRoot, InventoryWarning } from "./discovery.ts";
