import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type RequestListener, type Server } from "node:http";
import { join } from "node:path";
import { inventory, type InventoryRequest } from "./index.ts";
import {
  applicationDataRootAvailable,
  createManagement,
  ManagementError,
  MAX_EDIT_BYTES,
  revealManagedLocation,
  type RevealTargetRef,
} from "./management.ts";
import { createSystemGateway, FinderGatewayError, type MacOsSystemGateway } from "./system-gateway.ts";
import { createMutationCoordinator } from "./mutation-coordinator.ts";
import { createRecoverableRemoval } from "./recoverable-removal.ts";
import { renderWebShell } from "./web.ts";
import {
  createInventorySnapshotCoordinator,
  createPostActionReconciler,
  type ConfirmedMutationEffect,
  type InventoryRefreshOutcome,
} from "./inventory-snapshot.ts";
import { createActivityRecovery, type ActivityRecord, type ActivityWarning } from "./activity-recovery.ts";
import { PRODUCT_VERSION } from "./product-version.ts";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4173;
const MAX_FALLBACK_ATTEMPTS = 100;
const MAX_MANAGEMENT_BODY_BYTES = 8 * MAX_EDIT_BYTES + 64 * 1024;

export type StartServerOptions = InventoryRequest & {
  preferredPort?: number;
  strictPort?: boolean;
  systemGateway?: MacOsSystemGateway;
  afterPrimaryEffectForTest?: (effect: ConfirmedMutationEffect) => Promise<void>;
  beforeOpenResponseForTest?: (artifactIdentity: string) => Promise<void>;
  platform?: NodeJS.Platform;
};

export type RunningServer = {
  host: typeof HOST;
  port: number;
  url: string;
  close(): Promise<void>;
};

function json(response: Parameters<RequestListener>[1], status: number, payload: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function publicInventory(response: Parameters<RequestListener>[1], outcome: InventoryRefreshOutcome): void {
  if (outcome.status !== "fresh") {
    managementError(response, 500, outcome.error.code, outcome.error.message, "inventory");
    return;
  }
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-harness-config-inventory-generation": String(outcome.published.generation),
  });
  response.end(`${JSON.stringify(outcome.published.snapshot)}\n`);
}

function withActivityWarning<T extends object>(payload: T, warning?: ActivityWarning): T {
  if (!warning) return payload;
  const existing = Reflect.get(payload, "warnings");
  const warnings = Array.isArray(existing) ? [...existing, warning] : [warning];
  return { ...payload, warnings };
}

function finderErrorStatus(code: FinderGatewayError["code"]): number {
  if (code === "finder-unavailable") return 503;
  if (code === "finder-reveal-timeout") return 504;
  return 502;
}

function managementError(
  response: Parameters<RequestListener>[1],
  status: number,
  code: string,
  message: string,
  action = "open-artifact",
  context: { path?: string; technicalDetails?: Readonly<Record<string, string | number>>; warnings?: ActivityWarning[] } = {},
): void {
  const safeTechnicalDetails: Record<string, string | number> = {};
  for (const key of ["osCode", "exitCode", "signal", "line", "column"] as const) {
    const value = context.technicalDetails?.[key];
    if (typeof value === "number" && Number.isFinite(value)) safeTechnicalDetails[key] = value;
    else if (typeof value === "string" && value.length <= 128) safeTechnicalDetails[key] = value;
  }
  json(response, status, {
    error: {
      code,
      message,
      action,
      ...(context.path ? { path: context.path } : {}),
      ...(Object.keys(safeTechnicalDetails).length > 0 ? { technicalDetails: safeTechnicalDetails } : {}),
    },
    ...(context.warnings?.length ? { warnings: context.warnings } : {}),
  });
}

function capabilityMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_MANAGEMENT_BODY_BYTES) {
      tooLarge = true;
      chunks.length = 0;
    } else if (!tooLarge) {
      chunks.push(bytes);
    }
  }
  if (tooLarge) throw new ManagementError(413, "request-too-large", "The request body is too large.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ManagementError(400, "request-invalid", "The request body must be valid JSON.");
  }
}

function parseRevealTarget(value: unknown): RevealTargetRef {
  if (typeof value !== "object" || value === null || typeof Reflect.get(value, "kind") !== "string") {
    throw new ManagementError(400, "request-invalid", "target must identify a managed location.");
  }
  const kind = Reflect.get(value, "kind");
  if (kind === "application-data-root") return { kind };
  if (kind === "artifact") {
    const artifactIdentity = Reflect.get(value, "artifactIdentity");
    if (typeof artifactIdentity !== "string") {
      throw new ManagementError(400, "request-invalid", "target.artifactIdentity must be a string.");
    }
    return { kind, artifactIdentity };
  }
  if (kind === "latest-artifact-backup") {
    const artifactIdentity = Reflect.get(value, "artifactIdentity");
    if (typeof artifactIdentity !== "string") {
      throw new ManagementError(400, "request-invalid", "target.artifactIdentity must be a string.");
    }
    return { kind, artifactIdentity };
  }
  if (kind === "global-root" || kind === "project-root" || kind === "managed-skill-directory") {
    const path = Reflect.get(value, "path");
    if (typeof path !== "string") {
      throw new ManagementError(400, "request-invalid", "target.path must be a string.");
    }
    return { kind, path };
  }
  throw new ManagementError(422, "reveal-target-not-eligible", "The selected location is not eligible for Finder reveal.");
}

function requestHandler(
  options: InventoryRequest,
  sessionCapability: string,
  systemGateway: MacOsSystemGateway,
  platform: NodeJS.Platform,
  afterPrimaryEffectForTest?: (effect: ConfirmedMutationEffect) => Promise<void>,
  beforeOpenResponseForTest?: (artifactIdentity: string) => Promise<void>,
): RequestListener {
  const coordinator = createMutationCoordinator();
  const snapshots = createInventorySnapshotCoordinator(() => inventory(options));
  const reconciler = createPostActionReconciler(snapshots, afterPrimaryEffectForTest);
  const management = createManagement(options, coordinator);
  const recoverableRemoval = createRecoverableRemoval(options, systemGateway, coordinator);
  const activityRecovery = createActivityRecovery(options.home);
  const availableApplicationDataAfter = async (warning?: ActivityWarning): Promise<boolean> => (
    !warning && await applicationDataRootAvailable(options.home)
  );
  return async (request, response) => {
    const pathname = new URL(request.url ?? "/", `http://${HOST}`).pathname;
    if (pathname === "/") {
      if (request.method !== "GET") {
        managementError(response, 405, "method-not-allowed", "Method not allowed.", "load-shell");
        return;
      }
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(renderWebShell(
        sessionCapability,
        PRODUCT_VERSION,
        await applicationDataRootAvailable(options.home),
        platform === "darwin",
      ));
      return;
    }
    if (pathname === "/api/inventory") {
      if (request.method !== "GET") {
        managementError(response, 405, "method-not-allowed", "Method not allowed.", "inventory");
        return;
      }
      try {
        publicInventory(response, await snapshots.refresh("public"));
      } catch {
        managementError(response, 500, "inventory-refresh-failed", "Inventory could not be refreshed.", "inventory");
      }
      return;
    }
    if (pathname.startsWith("/api/management/")) {
      const action = pathname === "/api/management/artifacts/open" ? "open-artifact"
        : pathname === "/api/management/saves/review" ? "review-save"
        : pathname === "/api/management/saves/apply" ? "apply-save"
        : pathname === "/api/management/reveal" ? "system-reveal"
        : pathname === "/api/management/removals/preview" ? "recoverable-removal"
        : pathname === "/api/management/removals/apply" ? "recoverable-removal"
        : pathname === "/api/management/trash/open" ? "open-trash"
        : pathname === "/api/management/inventory/refresh" ? "refresh-inventory"
        : undefined;
      if (!action) {
        managementError(response, 404, "route-not-found", "Management route not found.");
        return;
      }
      if (request.method !== "POST") {
        managementError(response, 405, "method-not-allowed", "Method not allowed.", action);
        return;
      }

      const expectedHost = `${HOST}:${request.socket.localPort ?? ""}`;
      if (request.headers.host !== expectedHost) {
        managementError(response, 403, "host-invalid", "The request Host is not allowed.", action);
        return;
      }
      if (request.headers.origin !== `http://${expectedHost}`) {
        managementError(response, 403, "origin-invalid", "The request Origin is not allowed.", action);
        return;
      }
      const capabilityHeader = request.headers["x-harness-config-capability"];
      const capability = Array.isArray(capabilityHeader) ? capabilityHeader[0] : capabilityHeader;
      if (!capability) {
        managementError(response, 401, "capability-required", "A session capability is required.", action);
        return;
      }
      if (!capabilityMatches(capability, sessionCapability)) {
        managementError(response, 401, "capability-invalid", "The session capability is invalid.", action);
        return;
      }
      if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
        managementError(response, 415, "content-type-unsupported", "Management requests require application/json.", action);
        return;
      }
      const macOsOnly = action === "system-reveal"
        || action === "apply-save"
        || (action === "recoverable-removal" && pathname.endsWith("/apply"))
        || action === "open-trash";
      if (macOsOnly && platform !== "darwin") {
        managementError(response, 501, "platform-unsupported", "This management action is available only on macOS.", action);
        return;
      }

      let activityRecordOnFailure: Omit<ActivityRecord, "time" | "result"> | undefined;
      try {
        const body = await readJson(request);
        if (typeof body !== "object" || body === null) {
          throw new ManagementError(400, "request-invalid", "The request body must be an object.");
        }
        if (pathname === "/api/management/reveal") {
          const target = Reflect.get(body, "target");
          const parsedTarget = parseRevealTarget(target);
          const revealActivityBase = (verifiedPath: string, backupReference?: ActivityRecord["backupReference"]): Omit<ActivityRecord, "time" | "result"> => {
            const artifactIdentity = parsedTarget.kind === "artifact" || parsedTarget.kind === "latest-artifact-backup"
              ? parsedTarget.artifactIdentity
              : parsedTarget.kind === "managed-skill-directory" ? parsedTarget.path : null;
            const subjectKind = parsedTarget.kind === "managed-skill-directory" || parsedTarget.kind === "latest-artifact-backup" ? "artifact" : parsedTarget.kind;
            return {
              action: "system-reveal",
              subject: { kind: subjectKind, path: artifactIdentity ?? verifiedPath, artifactIdentity },
              ...(backupReference ? { backupReference } : {}),
            };
          };
          let result;
          let backupReference;
          try {
            if (parsedTarget.kind === "latest-artifact-backup") {
            const snapshot = await inventory(options);
            if (!snapshot.artifacts.some((candidate) => candidate.path === parsedTarget.artifactIdentity)) {
              throw new ManagementError(404, "reveal-target-not-found", "The selected artifact is not in the current Inventory.", { path: parsedTarget.artifactIdentity });
            }
            const latest = await activityRecovery.latestBackup(parsedTarget.artifactIdentity).catch(() => null);
            if (!latest) throw new ManagementError(404, "backup-not-found", "No validated Artifact Backup is available.", { path: parsedTarget.artifactIdentity });
            const root = await activityRecovery.canonicalRoot(false).catch(() => null);
            if (!root) throw new ManagementError(404, "backup-not-found", "No validated Artifact Backup is available.", { path: parsedTarget.artifactIdentity });
            const backupPath = join(root, latest.relativePath);
            try {
              await systemGateway.reveal({ disposition: "select-item", path: backupPath });
            } catch (error) {
              if (error instanceof FinderGatewayError) {
                throw new ManagementError(finderErrorStatus(error.code), error.code, error.message, {
                  path: parsedTarget.artifactIdentity,
                  technicalDetails: error.technicalDetails,
                });
              }
              throw new ManagementError(502, "finder-reveal-failed", "Finder could not reveal the Artifact Backup.", { path: parsedTarget.artifactIdentity });
            }
              result = { ok: true as const, action: "system-reveal" as const, disposition: "select-item" as const, path: backupPath };
              backupReference = { ...latest, reused: false };
            } else {
              result = await revealManagedLocation(options, parsedTarget, systemGateway);
            }
          } catch (error) {
            if (error instanceof ManagementError && error.path) activityRecordOnFailure = revealActivityBase(error.path);
            throw error;
          }
          activityRecordOnFailure = revealActivityBase(result.path, backupReference);
          const activity: ActivityRecord = {
            time: new Date().toISOString(),
            ...activityRecordOnFailure,
            result: { status: "success", code: "finder-request-accepted" },
          };
          const warning = await activityRecovery.record(activity);
          json(response, 200, {
            ...withActivityWarning(result, warning),
            applicationDataRootAvailable: await availableApplicationDataAfter(warning),
          });
          return;
        }
        if (pathname === "/api/management/inventory/refresh") {
          const reason = Reflect.get(body, "reason");
          if (reason !== "initial" && reason !== "manual" && reason !== "retry") {
            throw new ManagementError(400, "request-invalid", "reason must be initial, manual, or retry.");
          }
          json(response, 200, await snapshots.refresh(reason));
          return;
        }
        if (pathname === "/api/management/removals/preview") {
          const artifactIdentity = Reflect.get(body, "artifactIdentity");
          if (typeof artifactIdentity !== "string") {
            throw new ManagementError(400, "request-invalid", "artifactIdentity must be a string.");
          }
          json(response, 200, await recoverableRemoval.preview(artifactIdentity));
          return;
        }
        if (pathname === "/api/management/removals/apply") {
          const removalReviewId = Reflect.get(body, "removalReviewId");
          const confirmationName = Reflect.get(body, "confirmationName");
          if (typeof removalReviewId !== "string") {
            throw new ManagementError(400, "request-invalid", "removalReviewId must be a string.");
          }
          if (confirmationName !== undefined && typeof confirmationName !== "string") {
            throw new ManagementError(400, "request-invalid", "confirmationName must be a string when provided.");
          }
          const primary = await recoverableRemoval.apply({
            removalReviewId,
            ...(typeof confirmationName === "string" ? { confirmationName } : {}),
          });
          activityRecordOnFailure = {
            action: "recoverable-removal",
            subject: { kind: "artifact", path: primary.artifactIdentity, artifactIdentity: primary.artifactIdentity },
            targetKind: primary.targetKind,
          };
          const reconciled = await reconciler.settle(primary, {
            action: "removal",
            artifactIdentity: primary.artifactIdentity,
            targetKind: primary.targetKind,
          });
          const warning = await activityRecovery.record({
            time: primary.occurredAt,
            ...activityRecordOnFailure,
            result: { status: "success", code: "moved-to-trash" },
          });
          json(response, 200, {
            ...withActivityWarning(reconciled, warning),
            applicationDataRootAvailable: await availableApplicationDataAfter(warning),
          });
          return;
        }
        if (pathname === "/api/management/trash/open") {
          json(response, 200, await recoverableRemoval.openTrash());
          return;
        }
        if (action === "open-artifact") {
          const artifactIdentity = Reflect.get(body, "artifactIdentity");
          if (typeof artifactIdentity !== "string") {
            throw new ManagementError(400, "request-invalid", "artifactIdentity must be a string.");
          }
          const opened = await management.openArtifact(artifactIdentity);
          await beforeOpenResponseForTest?.(artifactIdentity);
          const latestBackup = await activityRecovery.latestBackup(opened.artifactIdentity).catch(() => null);
          json(response, 200, { ...opened, recovery: { latestBackup } });
        } else if (action === "review-save") {
          const editHandle = Reflect.get(body, "editHandle");
          const editRevision = Reflect.get(body, "editRevision");
          const content = Reflect.get(body, "content");
          if (typeof editHandle !== "string" || typeof editRevision !== "string" || typeof content !== "string") {
            throw new ManagementError(400, "request-invalid", "editHandle, editRevision, and content must be strings.");
          }
          json(response, 200, await management.reviewSave({ editHandle, editRevision, content }));
        } else if (action === "apply-save") {
          const reviewId = Reflect.get(body, "reviewId");
          if (typeof reviewId !== "string") throw new ManagementError(400, "request-invalid", "reviewId must be a string.");
          const primary = await management.applySave(reviewId);
          activityRecordOnFailure = {
            action: "save",
            subject: { kind: "artifact", path: primary.artifactIdentity, artifactIdentity: primary.artifactIdentity },
            backupReference: primary.backupReference,
          };
          const reconciled = await reconciler.settle(primary, {
            action: "save",
            artifactIdentity: primary.artifactIdentity,
          });
          const warning = await activityRecovery.record({
            time: primary.savedAt,
            ...activityRecordOnFailure,
            result: { status: "success", code: "saved" },
          });
          json(response, 200, {
            ...withActivityWarning(reconciled, warning),
            applicationDataRootAvailable: await availableApplicationDataAfter(warning),
          });
        }
      } catch (error) {
        if (error instanceof ManagementError) {
          let activityWarning: ActivityWarning | undefined;
          if (activityRecordOnFailure) {
            activityWarning = await activityRecovery.record({
              time: new Date().toISOString(),
              ...activityRecordOnFailure,
              result: { status: "failure", code: error.code },
            });
          } else if (error.path && (action === "apply-save" || action === "recoverable-removal" || action === "system-reveal")) {
            const activityAction = action === "apply-save" ? "save" : action;
            activityWarning = await activityRecovery.record({
              time: new Date().toISOString(),
              action: activityAction,
              subject: { kind: "artifact", path: error.path, artifactIdentity: error.path },
              result: { status: "failure", code: error.code },
            });
          }
          managementError(response, error.status, error.code, error.message, action, {
            ...(error.path ? { path: error.path } : {}),
            ...(error.technicalDetails ? { technicalDetails: error.technicalDetails } : {}),
            ...(activityWarning ? { warnings: [activityWarning] } : {}),
          });
          return;
        }
        managementError(response, 500, "management-failed", "The management action failed.", action);
      }
      return;
    }
    managementError(response, 404, "route-not-found", "Route not found.", "route");
  };
}

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, HOST);
  });
}

function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
}

export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const preferredPort = options.preferredPort ?? DEFAULT_PORT;
  const strictPort = options.strictPort ?? options.preferredPort !== undefined;
  const attempts = strictPort || preferredPort === 0 ? 1 : MAX_FALLBACK_ATTEMPTS;
  const inventoryRequest: InventoryRequest = {
    home: options.home,
    workspace: options.workspace,
    maxDepth: options.maxDepth,
  };
  const sessionCapability = randomBytes(32).toString("base64url");
  const platform = options.platform ?? process.platform;
  const systemGateway = options.systemGateway ?? createSystemGateway(platform);

  for (let offset = 0; offset < attempts; offset += 1) {
    const server = createServer(requestHandler(
      inventoryRequest,
      sessionCapability,
      systemGateway,
      platform,
      options.afterPrimaryEffectForTest,
      options.beforeOpenResponseForTest,
    ));
    try {
      await listen(server, preferredPort === 0 ? 0 : preferredPort + offset);
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to determine local server address");
      return {
        host: HOST,
        port: address.port,
        url: `http://${HOST}:${address.port}`,
        close: () => new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        }),
      };
    } catch (error) {
      server.close();
      if (!strictPort && isAddressInUse(error)) continue;
      throw error;
    }
  }
  throw new Error(`No available loopback port from ${preferredPort}`);
}
