import type { InventoryResult } from "./index.ts";

export type InventoryRefreshReason = "initial" | "manual" | "retry" | "post-save" | "post-removal" | "public";

export type PublishedInventory = Readonly<{
  generation: number;
  publishedAt: string;
  snapshot: InventoryResult;
}>;

export type InventoryRefreshError = Readonly<{
  code: "inventory-refresh-failed";
  message: "Inventory could not be refreshed.";
}>;

export type InventoryRefreshOutcome = Readonly<
  | { status: "fresh"; published: PublishedInventory }
  | {
      status: "stale" | "unavailable";
      lastPublished: PublishedInventory | null;
      error: InventoryRefreshError;
    }
>;

export type InventorySnapshotCoordinator = Readonly<{
  refresh(reason: InventoryRefreshReason): Promise<InventoryRefreshOutcome>;
  current(): PublishedInventory | null;
}>;

const SAFE_REFRESH_ERROR: InventoryRefreshError = {
  code: "inventory-refresh-failed",
  message: "Inventory could not be refreshed.",
};

export function createInventorySnapshotCoordinator(
  scan: () => Promise<InventoryResult>,
  now: () => string = () => new Date().toISOString(),
): InventorySnapshotCoordinator {
  let lastPublished: PublishedInventory | null = null;
  let generation = 0;
  let queue: Promise<void> = Promise.resolve();

  async function performRefresh(): Promise<InventoryRefreshOutcome> {
    try {
      const snapshot = await scan();
      const published: PublishedInventory = {
        generation: generation + 1,
        publishedAt: now(),
        snapshot,
      };
      generation = published.generation;
      lastPublished = published;
      return { status: "fresh", published };
    } catch {
      return {
        status: lastPublished ? "stale" : "unavailable",
        lastPublished,
        error: SAFE_REFRESH_ERROR,
      };
    }
  }

  function refresh(_reason: InventoryRefreshReason): Promise<InventoryRefreshOutcome> {
    const outcome = queue.then(performRefresh, performRefresh);
    queue = outcome.then(() => undefined, () => undefined);
    return outcome;
  }

  return {
    refresh,
    current: () => lastPublished,
  };
}

export type ConfirmedMutationEffect = Readonly<
  | { action: "save"; artifactIdentity: string }
  | {
      action: "removal";
      artifactIdentity: string;
      targetKind: "file" | "symbolic-link" | "managed-skill-directory";
    }
>;

export type MutationReconciliation = Readonly<
  | { status: "fresh"; published: PublishedInventory }
  | {
      status: "stale";
      lastPublishedGeneration: number | null;
      error: InventoryRefreshError;
    }
>;

export type ReconciledMutationResult<T> = T & Readonly<{
  warnings: ReadonlyArray<{ code: string; message: string }>;
  reconciliation: MutationReconciliation;
}>;

export type PostActionReconciler = Readonly<{
  settle<T extends object>(primary: T, effect: ConfirmedMutationEffect): Promise<ReconciledMutationResult<T>>;
}>;

export function createPostActionReconciler(
  snapshots: InventorySnapshotCoordinator,
  afterPrimaryEffectForTest?: (effect: ConfirmedMutationEffect) => Promise<void>,
): PostActionReconciler {
  return {
    async settle(primary, effect) {
      await afterPrimaryEffectForTest?.(effect).catch(() => undefined);
      const refreshed = await snapshots.refresh(effect.action === "save" ? "post-save" : "post-removal");
      const legacyWarning = Reflect.get(primary, "warning");
      const warnings = legacyWarning && typeof legacyWarning === "object"
        ? [{
            code: String(Reflect.get(legacyWarning, "code") ?? "management-warning"),
            message: String(Reflect.get(legacyWarning, "message") ?? "The action completed with a warning."),
          }]
        : [];
      const reconciliation: MutationReconciliation = refreshed.status === "fresh"
        ? { status: "fresh", published: refreshed.published }
        : {
            status: "stale",
            lastPublishedGeneration: refreshed.lastPublished?.generation ?? null,
            error: refreshed.error,
          };
      return { ...primary, warnings, reconciliation };
    },
  };
}
