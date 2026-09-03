import { lstat } from "node:fs/promises";

export type WarningCode = "depth-limit" | "unreadable-path";

export type InventoryWarning = {
  code: WarningCode;
  path: string;
  message: string;
};

export type PathPresence = "present" | "missing" | "unreadable";

export async function pathPresence(path: string): Promise<PathPresence> {
  try {
    await lstat(path);
    return "present";
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unreadable";
  }
}

export function addUniqueWarning(warnings: InventoryWarning[], warning: InventoryWarning): void {
  if (!warnings.some((candidate) => candidate.code === warning.code && candidate.path === warning.path)) {
    warnings.push(warning);
  }
}
