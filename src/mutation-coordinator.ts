import { relative, resolve } from "node:path";

export type MutationScope = Readonly<
  | { kind: "exact"; path: string }
  | { kind: "subtree"; path: string }
>;

export type MutationCoordinator = Readonly<{
  withMutation<T>(scopes: readonly MutationScope[], operation: () => Promise<T>): Promise<T>;
}>;

type Waiter = {
  token: symbol;
  scopes: MutationScope[];
  start(): void;
};

function normalized(scope: MutationScope): MutationScope {
  return { kind: scope.kind, path: resolve(scope.path) };
}

function contains(parent: string, candidate: string): boolean {
  const offset = relative(parent, candidate);
  return offset === "" || (!offset.startsWith("..") && !offset.startsWith("/"));
}

function scopeConflict(left: MutationScope, right: MutationScope): boolean {
  if (left.kind === "exact" && right.kind === "exact") return left.path === right.path;
  if (left.kind === "subtree" && right.kind === "subtree") {
    return contains(left.path, right.path) || contains(right.path, left.path);
  }
  const subtree = left.kind === "subtree" ? left : right;
  const exact = left.kind === "exact" ? left : right;
  return contains(subtree.path, exact.path);
}

function scopesConflict(left: readonly MutationScope[], right: readonly MutationScope[]): boolean {
  return left.some((leftScope) => right.some((rightScope) => scopeConflict(leftScope, rightScope)));
}

export function createMutationCoordinator(): MutationCoordinator {
  const active = new Map<symbol, MutationScope[]>();
  const waiting: Waiter[] = [];

  function drain(): void {
    for (let index = 0; index < waiting.length;) {
      const waiter = waiting[index]!;
      const conflictsWithActive = [...active.values()].some((scopes) => scopesConflict(waiter.scopes, scopes));
      const conflictsWithEarlier = waiting.slice(0, index).some((earlier) => scopesConflict(waiter.scopes, earlier.scopes));
      if (conflictsWithActive || conflictsWithEarlier) {
        index += 1;
        continue;
      }
      waiting.splice(index, 1);
      active.set(waiter.token, waiter.scopes);
      waiter.start();
    }
  }

  async function withMutation<T>(scopes: readonly MutationScope[], operation: () => Promise<T>): Promise<T> {
    if (scopes.length === 0) throw new Error("A mutation must declare at least one scope.");
    const token = Symbol("mutation");
    const prepared = scopes.map(normalized);
    await new Promise<void>((start) => {
      waiting.push({ token, scopes: prepared, start });
      drain();
    });
    try {
      return await operation();
    } finally {
      active.delete(token);
      drain();
    }
  }

  return {
    withMutation,
  };
}
