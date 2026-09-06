import { SUPPORTED_EDITABLE_EXTENSIONS } from "./editable-artifact.ts";
import type { InventoryResult } from "./inventory.ts";
import type { OpenedArtifact } from "./management.ts";

export type WebDemoData = {
  snapshot: InventoryResult;
  artifacts: Record<string, OpenedArtifact>;
};

export function renderWebShell(
  sessionCapability: string,
  productVersion: string,
  hasApplicationDataRoot = false,
  systemManagementSupported = true,
  demo: WebDemoData | null = null,
): string {
  // Inline data must never terminate the script element, even for example Markdown.
  const demoJson = JSON.stringify(demo).replaceAll("<", "\\u003c");
  if (demo) { systemManagementSupported = false; hasApplicationDataRoot = false; }
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  ${demo ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; base-uri 'none'; form-action 'none'">` : ""}
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="hcs-session-capability" content="${sessionCapability}">
  <title>Harness Config Studio</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#182019;background:#eef1ea;--ink:#182019;--muted:#687068;--line:#d8ded3;--surface:#fff;--green:#baf34a;--green-dark:#304b10;--amber:#ffe08a;--red:#ffd0cb}
    *{box-sizing:border-box}body{margin:0;min-width:980px;min-height:100vh}button,textarea{font:inherit}header{height:82px;color:#f7f9f3;background:#182019}.hero{height:100%;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:0 24px}.brand{display:flex;align-items:center;gap:14px}.brand h1{margin:0;font-size:22px;letter-spacing:-.035em}.brand p{margin:3px 0 0;color:#abb6a7;font-size:11px}.top-actions{display:flex;gap:8px}.top-action{padding:9px 12px;border:1px solid #7d8878;border-radius:9px;color:#f6f8f2;background:#ffffff0d;cursor:pointer}.top-action:hover{background:#ffffff18}.top-action:disabled{opacity:.55;cursor:wait}
    main{height:calc(100vh - 82px);padding:14px}.state{height:100%;display:grid;place-items:center;border:1px dashed var(--line);border-radius:14px;color:var(--muted);background:#fafbf8}.loader{width:26px;height:26px;margin:0 auto 12px;border:3px solid #dce3d4;border-top-color:#648a23;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.error-card{max-width:520px;padding:28px;text-align:center}.error-card code{display:block;margin:14px 0;padding:10px;border-radius:8px;color:#6b2d28;background:#fff0ee}.retry{padding:9px 14px;border:0;border-radius:9px;color:#fff;background:#263421;cursor:pointer}
    .inventory-layout{height:100%;display:flex;flex-direction:column;gap:9px}.inventory-banner{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 14px;border:1px solid #ddbc58;border-radius:10px;color:#5f490b;background:#fff6d8;font-size:10px}.inventory-banner p{margin:0}.inventory-banner code{font-size:9px}.columns{min-height:0;flex:1;display:grid;overflow:hidden;border:1px solid #cfd6ca;border-radius:14px;background:var(--surface);box-shadow:0 16px 50px rgba(30,42,25,.08)}.column{min-width:0;min-height:0;display:flex;flex-direction:column}.column-head{min-height:69px;padding:15px 17px;border-bottom:1px solid var(--line);background:#fafbf8}.eyebrow{margin:0 0 4px;color:#74806f;font:700 9px ui-monospace,monospace;letter-spacing:.11em;text-transform:uppercase}.column-head h2{margin:0;font-size:16px}.column-head code{display:block;margin-top:4px;color:var(--muted);font:9px ui-monospace,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.column-body{min-height:0;flex:1;overflow:auto}.source-meta{padding:11px 14px;border-bottom:1px solid var(--line);color:var(--muted);font:9px/1.5 ui-monospace,monospace;word-break:break-all}
    .columns{grid-template-columns:var(--sources-width,270px) 8px var(--artifacts-width,330px) 8px minmax(320px,1fr)}.column-resizer{position:relative;cursor:col-resize;touch-action:none;background:#f1f4ed;border-inline:1px solid var(--line)}.column-resizer:after{content:"";position:absolute;top:calc(50% - 16px);left:2px;width:2px;height:32px;border-radius:2px;background:#95a18d}.column-resizer:hover,.column-resizer:focus-visible,.column-resizer[data-dragging]{background:#d9f3b6}.column-resizer:focus-visible{outline:2px solid #648a23;outline-offset:-2px}.columns.is-resizing,.columns.is-resizing *{cursor:col-resize;user-select:none;-webkit-user-select:none}
    details.collection{border-bottom:1px solid var(--line)}details.collection>summary{display:flex;align-items:center;gap:8px;padding:11px 14px;list-style:none;cursor:pointer;font-size:11px;font-weight:800}details.collection>summary::-webkit-details-marker{display:none}details.collection>summary:before{content:"›";font-size:16px;color:var(--muted);transition:transform .15s}details.collection[open]>summary:before{transform:rotate(90deg)}details.collection>summary span{margin-left:auto;color:var(--muted);font:9px ui-monospace,monospace}.source-list{padding:0 8px 9px}.source-row{position:relative}.source-button,.filter,.project-toggle{width:100%;border:0;border-radius:8px;color:var(--ink);background:transparent;text-align:left;cursor:pointer}.source-button{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;padding:8px 42px 8px 8px}.source-button:hover,.source-button[aria-pressed="true"]{background:#eef8dc}.source-button strong{display:flex;align-items:center;gap:6px;font-size:11px}.source-button small{display:block;margin-top:3px;color:var(--muted);font:8px ui-monospace,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.source-reveal{position:absolute;top:8px;right:5px;width:29px;height:29px;border:1px solid var(--line);border-radius:8px;color:#465342;background:#fafbf8;cursor:pointer}.source-reveal:hover{background:#eef8dc}.source-count{padding:3px 5px;border-radius:6px;color:#29400d;background:var(--green);font:800 8px ui-monospace,monospace}.filter,.project-toggle{padding:7px 9px;color:#5f695c;font-size:10px}.filter[aria-pressed="true"],.project-toggle[aria-pressed="true"]{color:var(--green-dark);background:#eef8dc}.filter:before{content:"";display:inline-block;width:6px;height:6px;margin-right:7px;border-radius:50%;background:#aeb6aa}.filter[aria-pressed="true"]:before{background:#69a113}.warning-list{margin:0;padding:0 12px 10px 28px;color:#6d5a20;font:9px/1.55 ui-monospace,monospace}
    .artifact-list,.artifact-children{margin:0;padding:0;list-style:none}.artifact-list{min-width:300px}.artifact-children{margin-left:14px;border-left:1px solid #e1e6dd}.artifact-node{position:relative}.artifact-row-main{position:relative;border-bottom:1px solid #edf0e9}.artifact-button{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:10px 86px 10px 12px;border:0;color:var(--ink);background:#fff;text-align:left;cursor:pointer}.artifact-button:hover,.artifact-button[aria-pressed="true"],.directory-button[aria-expanded="true"]{background:#f2f9e5}.artifact-button:disabled{cursor:not-allowed;opacity:.58}.artifact-name{min-width:0;display:flex;align-items:center;gap:7px;font-size:12px;font-weight:800}.artifact-name-text{min-width:44px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.artifact-path{display:block;margin:4px 0 0 22px;color:var(--muted);font:8px/1.45 ui-monospace,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.memberships{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:3px}.member{padding:3px 4px;border-radius:5px;color:#65705f;background:#eef1e9;font:800 7px ui-monospace,monospace;text-transform:uppercase}.tree-chevron{width:12px;color:#788172;text-align:center;transition:transform .12s}.tree-chevron.open{transform:rotate(90deg)}.tree-chevron.leaf{visibility:hidden}.artifact-type-icon{display:inline-grid;place-items:center;width:17px;height:17px;flex:0 0 17px;border-radius:4px;color:#566151;background:#eef1e9}.artifact-type-icon svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.artifact-type-icon.directory{color:#765a18;background:#fff3c9}.artifact-type-icon.markdown{color:#285d91;background:#e6f2ff}.artifact-type-icon.json{color:#865b0d;background:#fff1d5}.artifact-type-icon.yaml{color:#70458b;background:#f3e9fa}.artifact-type-icon.toml{color:#24684f;background:#e4f5ed}.symlink-icon{display:inline-grid;place-items:center;width:16px;height:16px;border-radius:5px;color:#5d4500;background:var(--amber);font:900 10px ui-monospace,monospace}.symlink-icon.broken{color:#792722;background:var(--red)}.symlink-target{display:block;margin:4px 0 0 39px;color:#735d19;font:8px/1.4 ui-monospace,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.reveal-button,.trash-button{position:absolute;top:7px;width:30px;height:30px;border:1px solid var(--line);border-radius:8px;background:#fafbf8;cursor:pointer}.reveal-button{right:9px;color:#465342}.trash-button{right:43px;color:#792722}.reveal-button:hover{background:#eef8dc}.trash-button:hover{background:#fff0ee}.trash-button:disabled{color:#9a9f98;background:#f2f3f1;cursor:not-allowed}.reveal-status{padding:7px 14px;border-bottom:1px solid var(--line);color:#405039;background:#f4f9ec;font-size:9px}.reveal-status.error{color:#792722;background:#fff0ee}.removal-status{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 14px;border-bottom:1px solid var(--line);color:#304b10;background:#eef8dc;font-size:9px}.removal-status.error{color:#792722;background:#fff0ee}.empty{margin:16px;padding:22px;border:1px dashed var(--line);border-radius:10px;color:var(--muted);background:#fafbf8;text-align:center;font-size:11px}
    .detail-body{height:100%;display:flex;flex-direction:column}.detail-empty{height:100%;display:grid;place-items:center;padding:40px;color:var(--muted);text-align:center}.detail-loading{height:100%;display:grid;place-items:center;color:var(--muted)}.detail-error{margin:18px;padding:16px;border:1px solid #e4aaa4;border-radius:10px;color:#792722;background:#fff0ee}.detail-meta{padding:14px 17px;border-bottom:1px solid var(--line);background:#fafbf8}.detail-title{display:flex;align-items:center;justify-content:space-between;gap:10px}.detail-meta h3{margin:0 0 9px;font-size:15px}.close-editor{border:0;color:var(--muted);background:transparent;cursor:pointer}.metadata{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:5px 12px;margin:0}.metadata dt{color:var(--muted);font:800 8px ui-monospace,monospace;text-transform:uppercase}.metadata dd{min-width:0;margin:0;font-size:10px;word-break:break-all}.metadata code{font:9px/1.4 ui-monospace,monospace}.editor{min-height:0;flex:1;display:flex;flex-direction:column;padding:13px}.editor-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:7px}.editor-bar label{margin:0;color:var(--muted);font:800 9px ui-monospace,monospace;text-transform:uppercase}.editor-actions{display:flex;align-items:center;gap:9px}.editor-status,.cursor-position{color:var(--muted);font:800 8px ui-monospace,monospace}.save-button,.danger-button{padding:6px 9px;border:0;border-radius:7px;color:#fff;font-size:9px;font-weight:800;cursor:pointer}.save-button{background:#304b10}.danger-button{background:#8b2e27}.save-button:disabled,.danger-button:disabled{color:#8b9388;background:#e4e8e0;cursor:not-allowed}.editor textarea{width:100%;min-height:0;flex:1;resize:none;padding:14px;border:1px solid var(--line);border-radius:9px;color:#20281e;background:#fbfcf9;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;tab-size:2}.editor textarea:focus{outline:2px solid #baf34a;outline-offset:1px}.editor-note{display:flex;justify-content:space-between;gap:12px;margin:7px 1px 0;color:var(--muted);font-size:9px}.save-error{margin:0 0 8px;padding:8px;border:1px solid #e4aaa4;border-radius:7px;color:#792722;background:#fff0ee;font-size:9px}.modal-backdrop{position:fixed;inset:0;z-index:10;display:grid;place-items:center;padding:30px;background:#182019a8}.save-review,.dirty-guard,.removal-review,.help-dialog{width:min(920px,90vw);max-height:88vh;overflow:auto;padding:0;border:1px solid #bec8b8;border-radius:14px;background:#fff;box-shadow:0 24px 80px #0005}.dirty-guard,.removal-review{width:min(700px,90vw)}.help-dialog{width:min(840px,90vw)}.review-head,.review-actions{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:16px 18px}.review-head{border-bottom:1px solid var(--line)}.review-head h2{margin:0;font-size:18px}.review-body{padding:16px 18px}.review-identity{display:block;padding:9px;border-radius:7px;background:#f1f4ed;font:9px ui-monospace,monospace;word-break:break-all}.validation-ready{margin:12px 0;padding:9px;border-radius:7px;color:#304b10;background:#eef8dc;font-weight:800}.skill-warning{padding:11px;border-radius:8px;color:#6d4c00;background:#fff5d5}.review-metadata{display:flex;gap:14px;color:var(--muted);font:9px ui-monospace,monospace}.diff{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.diff section{min-width:0}.diff h3{margin:0 0 5px;font-size:10px}.diff pre{min-height:180px;margin:0;padding:11px;overflow:auto;border:1px solid var(--line);border-radius:8px;background:#fafbf8;font:10px/1.5 ui-monospace,monospace;white-space:pre-wrap;word-break:break-word}.removal-tree{max-height:190px;margin:12px 0;padding:8px;overflow:auto;border:1px solid var(--line);border-radius:8px;background:#fafbf8;font:9px/1.6 ui-monospace,monospace}.removal-tree div{padding-left:calc(var(--depth) * 14px)}.typed-confirmation{display:grid;gap:6px;margin-top:14px;font-size:10px;font-weight:800}.typed-confirmation textarea{min-height:42px;padding:9px;resize:vertical;border:1px solid var(--line);border-radius:7px;font:11px ui-monospace,monospace}.review-actions{border-top:1px solid var(--line);justify-content:flex-end}.secondary-button{padding:7px 10px;border:1px solid var(--line);border-radius:7px;background:#fff;cursor:pointer}.help-body{display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:18px}.help-section{min-width:0;padding:14px;border:1px solid var(--line);border-radius:10px;background:#fafbf8}.help-section h3{margin:0 0 8px;font-size:13px}.help-section p,.help-section li{color:#4f594c;font-size:10px;line-height:1.55}.help-section p{margin:0}.help-section ul{margin:0;padding-left:17px}.help-shortcuts{grid-column:1/-1}.shortcut-list{display:grid;grid-template-columns:max-content 1fr;gap:7px 13px;margin:0}.shortcut-list dt,.shortcut-list dd{margin:0;font-size:10px}.shortcut-list kbd{display:inline-block;min-width:62px;padding:3px 6px;border:1px solid #c8d0c2;border-bottom-width:2px;border-radius:5px;background:#fff;font:800 9px ui-monospace,monospace;text-align:center}.shortcut-list dd{align-self:center;color:#4f594c}
    .tree-toolbar{position:sticky;z-index:2;top:0;display:flex;gap:6px;padding:7px 10px;border-bottom:1px solid var(--line);background:#fafbf8}.tree-toolbar .secondary-button{padding:5px 8px}.artifact-node[aria-selected="true"]>.artifact-row-main>.artifact-button{background:#e8f5d0;outline:2px solid #8ab448;outline-offset:-2px}.artifact-row-main>.reveal-button,.artifact-row-main>.trash-button{opacity:0;z-index:1}.artifact-row-main:hover>.reveal-button,.artifact-row-main:hover>.trash-button,.artifact-row-main:focus-within>.reveal-button,.artifact-row-main:focus-within>.trash-button,.artifact-node[aria-selected="true"]>.artifact-row-main>.reveal-button,.artifact-node[aria-selected="true"]>.artifact-row-main>.trash-button{opacity:1;pointer-events:auto}
    ${demo ? '.demo-strip{height:42px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:#baf34a;color:#182019;font-size:12px}.demo-strip a{color:inherit}.demo-strip strong{margin-right:12px}main{height:calc(100vh - 124px)}' : ""}
  </style>
</head>
<body data-system-management-supported="${systemManagementSupported}">
  ${demo ? '<div class="demo-strip"><span><strong>READ-ONLY DEMO</strong>Fictional data · No access to your files</span><a href="index.html">← Overview</a></div>' : ""}
  <header><div class="hero"><div class="brand"><div><h1>Harness Config Studio</h1><p>${demo ? "Explore example configurations" : "Inventory and explicit Web Management"} · Version ${productVersion}</p></div></div><div class="top-actions">${hasApplicationDataRoot ? '<button class="top-action" type="button" data-testid="reveal-application-data" disabled>Reveal application data in Finder</button>' : ""}<button class="top-action" type="button" data-testid="help" aria-label="Help and keyboard shortcuts" aria-keyshortcuts="?">? Help</button><button class="top-action" type="button" data-testid="toggle-sections" aria-label="Expand all sections" aria-pressed="false" disabled>Expand all</button><button class="top-action" type="button" data-testid="refresh" disabled>↻ Refresh snapshot</button></div></div></header>
  <main id="app" data-state="loading" aria-live="polite"><section class="state"><div><div class="loader"></div><strong>Loading configuration inventory…</strong></div></section></main>
  <script>
  (() => {
    const demo = ${demoJson};
    // The demo has no transport to a local server. Only these read operations exist.
    async function request(url, options = {}) {
      if (!demo) return fetch(url, options);
      const body = JSON.parse(options.body || "{}");
      let payload;
      let status = 200;
      if (url === "/api/inventory") payload = demo.snapshot;
      else if (url === "/api/management/artifacts/open" && Object.hasOwn(demo.artifacts, body.artifactIdentity)) {
        payload = { ...demo.artifacts[body.artifactIdentity], editability: "view-only", writable: false };
      } else if (url === "/api/management/inventory/refresh") {
        payload = { status: "fresh", published: { snapshot: demo.snapshot, generation: 1 } };
      } else {
        status = 403;
        payload = { error: { code: "demo-read-only", message: "The demo cannot write files or run system actions." } };
      }
      return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", "x-harness-config-inventory-generation": "1" } });
    }
    const app = document.querySelector("#app");
    const refreshButton = document.querySelector('[data-testid="refresh"]');
    const sectionToggle = document.querySelector('[data-testid="toggle-sections"]');
    const helpButton = document.querySelector('[data-testid="help"]');
    let applicationDataReveal = document.querySelector('[data-testid="reveal-application-data"]');
    const capability = document.querySelector('meta[name="hcs-session-capability"]').content;
    const systemManagementSupported = document.body.dataset.systemManagementSupported === "true";
    const systemActionDisabled = systemManagementSupported ? "" : ' disabled title="Available only on macOS"';
    const harnessLabels = { codex: "Codex", claude: "Claude Code", opencode: "OpenCode", pi: "Pi" };
    const enabledHarnesses = new Set(["codex", "claude", "opencode", "pi"]);
    const openGroups = new Set();
    let snapshot = null;
    let publishedGeneration = 0;
    let publishedAt = null;
    let inventoryStatus = "initial-loading";
    let inventoryRefreshInFlight = false;
    let staleInventory = null;
    let confirmedEffects = [];
    let selectedSource = null;
    let openedArtifact = null;
    let pendingContent = null;
    let currentReview = null;
    let reviewingSave = false;
    let dirtyAction = null;
    let deferredAction = null;
    let saveError = null;
    let saveStatus = null;
    let openingArtifactIdentity = null;
    let artifactOpenSequence = 0;
    let detailError = null;
    let revealStatus = null;
    let removalPreview = null;
    let removalStatus = null;
    let removalInFlight = false;
    let helpOpen = false;
    let showEmptyProjects = false;
    const openArtifactDirectories = new Set();
    const initializedArtifactRoots = new Set();
    let selectedTreePath = null;
    let artifactTreeNodes = new Map();
    let visibleTreePaths = [];
    const columnWidths = { sources: 270, artifacts: 330 };
    const columnMinimumWidths = { sources: 200, artifacts: 260, detail: 320 };

    const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
    const compactPath = (path, home) => path === home ? "~" : path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
    const basename = (path) => path.split("/").filter(Boolean).at(-1) || path;
    const visible = (artifact) => artifact.harnesses.some((id) => enabledHarnesses.has(id));
    const sourceKey = (kind, path) => kind + ":" + path;
    const isFileRemovalCandidate = (artifact) => artifact.kind === "file" && !artifact.isSymbolicLink;
    const isSymbolicLinkRemovalCandidate = (artifact) => artifact.isSymbolicLink;
    const dirname = (path) => path.slice(0, path.lastIndexOf("/")) || "/";
    const isWithin = (path, parent) => path === parent || path.startsWith(parent.endsWith("/") ? parent : parent + "/");

    function removalAffectsReference(identity, resolvedPath, targetIdentity, targetKind) {
      if (targetKind === "symbolic-link") return identity === targetIdentity;
      if (targetKind === "file") return identity === targetIdentity || resolvedPath === targetIdentity;
      return isWithin(identity, targetIdentity) || Boolean(resolvedPath && isWithin(resolvedPath, targetIdentity));
    }

    function inventoryArtifacts() {
      return snapshot.artifacts.filter((artifact) => !confirmedEffects.some((effect) => (
        effect.action === "removal"
        && removalAffectsReference(
          artifact.path,
          artifact.isSymbolicLink ? artifact.resolvedPath : null,
          effect.artifactIdentity,
          effect.targetKind,
        )
      )));
    }

    function isRecognizedSkillsRoot(artifact) {
      if (artifact.category !== "skills" || artifact.kind !== "directory" || artifact.isSymbolicLink) return false;
      return !inventoryArtifacts().some((candidate) => (
        candidate !== artifact
        && candidate.category === "skills"
        && candidate.kind === "directory"
        && !candidate.isSymbolicLink
        && isWithin(artifact.path, candidate.path)
      ));
    }

    function isManagedSkillDirectoryCandidate(artifact) {
      return artifact.category === "skills"
        && artifact.kind === "directory"
        && !artifact.isSymbolicLink
        && !basename(artifact.path).startsWith(".")
        && inventoryArtifacts().some((candidate) => candidate.path === dirname(artifact.path) && isRecognizedSkillsRoot(candidate));
    }

    function pendingEditAffectedBy(artifactIdentity, targetKind) {
      if (!hasPendingEdit() || !openedArtifact) return false;
      return removalAffectsReference(
        openedArtifact.artifactIdentity,
        openedArtifact.symbolicLink.resolvedPath,
        artifactIdentity,
        targetKind,
      );
    }

    function symlinkIcon(entry) {
      return entry?.isSymbolicLink ? '<span class="symlink-icon ' + (entry.brokenLink ? "broken" : "") + '" data-testid="symlink-icon" aria-label="' + (entry.brokenLink ? "Broken symbolic link" : "Symbolic link") + '">↗</span>' : "";
    }

    function symlinkTarget(entry) {
      if (!entry?.isSymbolicLink) return "";
      return '<code class="symlink-target ' + (entry.brokenLink ? "broken" : "") + '" data-testid="symlink-target">→ ' + escapeHtml(entry.brokenLink ? "Broken target" : compactPath(entry.resolvedPath || "", snapshot.home)) + "</code>";
    }

    function sourceArtifacts() {
      const artifacts = inventoryArtifacts().filter(visible);
      if (!selectedSource || selectedSource === "all") return selectedSource === "all" ? artifacts : [];
      const separator = selectedSource.indexOf(":");
      const kind = selectedSource.slice(0, separator);
      const path = selectedSource.slice(separator + 1);
      if (kind === "global") return artifacts.filter((artifact) => artifact.scope.kind === "global" && artifact.scope.root === path);
      return artifacts.filter((artifact) => artifact.scope.kind === "project" && artifact.scope.projectRoot === path);
    }

    function applyPublishedSnapshot(published) {
      if (!published || published.generation < publishedGeneration) return false;
      snapshot = published.snapshot;
      publishedGeneration = published.generation;
      publishedAt = published.publishedAt;
      inventoryStatus = "fresh";
      staleInventory = null;
      confirmedEffects = [];
      if (selectedSource && selectedSource !== "all") {
        const separator = selectedSource.indexOf(":");
        const kind = selectedSource.slice(0, separator);
        const path = selectedSource.slice(separator + 1);
        const rootExists = kind === "global"
          ? snapshot.globalRoots.some((root) => root.path === path && visible(root))
          : snapshot.projectRoots.some((root) => root.path === path);
        const hasVisibleArtifacts = inventoryArtifacts().some((artifact) => (
          visible(artifact)
          && (kind === "global"
            ? artifact.scope.kind === "global" && artifact.scope.root === path
            : artifact.scope.kind === "project" && artifact.scope.projectRoot === path)
        ));
        if (!rootExists || (kind === "project" && !showEmptyProjects && !hasVisibleArtifacts)) selectedSource = "all";
      }
      if (openedArtifact) {
        const metadata = inventoryArtifacts().find((artifact) => artifact.path === openedArtifact.artifactIdentity);
        if (!metadata || metadata.kind !== "file" || !visible(metadata)) {
          openedArtifact = null;
          pendingContent = null;
          currentReview = null;
        } else {
          openedArtifact.scope = metadata.scope;
          openedArtifact.harnesses = metadata.harnesses;
          openedArtifact.symbolicLink = {
            isSymbolicLink: metadata.isSymbolicLink,
            resolvedPath: metadata.resolvedPath,
            brokenLink: metadata.brokenLink,
          };
        }
      }
      return true;
    }

    function sourceButton(kind, root, artifacts, subtitle) {
      const key = sourceKey(kind, root.path);
      const label = root.name || basename(root.path);
      return '<div class="source-row"><button type="button" class="source-button" data-source="' + escapeHtml(key) + '" aria-pressed="' + (selectedSource === key) + '"><span><strong>' + symlinkIcon(root) + '<span>' + escapeHtml(label) + '</span></strong><small>' + escapeHtml(subtitle) + '<br>' + escapeHtml(compactPath(root.path, snapshot.home)) + '</small>' + symlinkTarget(root) + '</span><span class="source-count">' + artifacts.length + '</span></button>' + (demo ? '' : '<button type="button" class="source-reveal" data-reveal-source-kind="' + escapeHtml(kind === "global" ? "global-root" : "project-root") + '" data-reveal-source-path="' + escapeHtml(root.path) + '" aria-label="Reveal ' + escapeHtml(label) + ' in Finder"' + systemActionDisabled + '>⌖</button>') + '</div>';
    }

    function renderSources() {
      const artifacts = inventoryArtifacts();
      const globalSources = snapshot.globalRoots.filter(visible).map((root) => sourceButton("global", root, artifacts.filter((artifact) => artifact.scope.kind === "global" && artifact.scope.root === root.path && visible(artifact)), "Global Root")).join("");
      const projects = snapshot.projectRoots.map((project) => ({ project, artifacts: artifacts.filter((artifact) => artifact.scope.kind === "project" && artifact.scope.projectRoot === project.path && visible(artifact)) }));
      const emptyCount = projects.filter((entry) => entry.artifacts.length === 0).length;
      const shownProjects = showEmptyProjects ? projects : projects.filter((entry) => entry.artifacts.length > 0);
      const projectSources = shownProjects.map(({ project, artifacts: rows }) => sourceButton("project", project, rows, "Project Root")).join("");
      const filters = snapshot.harnesses.map((harness) => '<button type="button" class="filter" data-filter="' + harness.id + '" data-testid="filter-' + harness.id + '" aria-pressed="' + enabledHarnesses.has(harness.id) + '">' + escapeHtml(harnessLabels[harness.id]) + " · " + escapeHtml(harness.status) + "</button>").join("");
      const warnings = snapshot.warnings.length ? '<ul class="warning-list">' + snapshot.warnings.map((warning) => '<li><strong>' + escapeHtml(warning.code) + '</strong> · ' + escapeHtml(compactPath(warning.path, snapshot.home)) + "</li>").join("") + "</ul>" : '<p class="empty">No scan warnings.</p>';
      const group = (id, title, count, body, className = "") => '<details class="collection ' + className + '" data-group="' + id + '" data-collapsible' + (openGroups.has(id) ? " open" : "") + '><summary><h2>' + title + '</h2><span>' + count + "</span></summary>" + body + "</details>";
      const projectToggleLabel = showEmptyProjects ? "Hide projects without artifacts" : "Show projects without artifacts";
      return '<div class="source-meta">Workspace<br>' + escapeHtml(snapshot.workspace) + "</div>" +
        group("global", "Global configuration", snapshot.globalRoots.length, '<div class="source-list">' + (globalSources || '<p class="empty">No global roots.</p>') + "</div>") +
        group("project", "Project configuration", shownProjects.length + " of " + projects.length, '<div class="source-list"><button type="button" class="project-toggle" data-testid="toggle-empty-projects" aria-label="' + projectToggleLabel + '" aria-pressed="' + showEmptyProjects + '"' + (emptyCount ? "" : " disabled") + ">" + projectToggleLabel + " · " + emptyCount + "</button>" + (projectSources || '<p class="empty">No project roots.</p>') + "</div>") +
        group("harness", "Agent Harnesses", snapshot.harnesses.length, '<div class="source-list">' + filters + "</div>") +
        group("warnings", "Scan warnings", snapshot.warnings.length, warnings, "warnings");
    }

    function artifactIconKind(node) {
      if (node.kind === "directory") return "directory";
      const name = node.name.toLowerCase();
      if (name.endsWith(".md") || name.endsWith(".mdc")) return "markdown";
      if (name.endsWith(".json") || name.endsWith(".jsonc")) return "json";
      if (name.endsWith(".yaml") || name.endsWith(".yml")) return "yaml";
      if (name.endsWith(".toml")) return "toml";
      return "file";
    }

    function artifactTypeIcon(node) {
      const kind = artifactIconKind(node);
      const labels = { directory: "Directory", markdown: "Markdown file", json: "JSON file", yaml: "YAML file", toml: "TOML file", file: "File" };
      const folder = '<path d="M2.5 6.5h6l1.8-2h7.2v11h-15z"></path>';
      const page = '<path d="M5 2.5h6.5l3.5 3.5v11.5H5z"></path><path d="M11.5 2.5V6H15"></path>';
      const mark = kind === "markdown" ? '<path d="M7 10v4m0-4 1.5 2L10 10v4m2-4 1 1 1-1m-1 1v3"></path>'
        : kind === "json" ? '<path d="M8 8c-1 0-1.5.5-1.5 1.5v1c0 1-.5 1.5-1.5 1.5 1 0 1.5.5 1.5 1.5v1C6.5 15.5 7 16 8 16m4-8c1 0 1.5.5 1.5 1.5v1c0 1 .5 1.5 1.5 1.5-1 0-1.5.5-1.5 1.5v1c0 1-.5 1.5-1.5 1.5"></path>'
          : kind === "yaml" ? '<path d="m7 9 2 3 2-3m-2 3v3"></path>'
            : kind === "toml" ? '<path d="M7 9h6m-3 0v6"></path>' : "";
      return '<span class="artifact-type-icon ' + kind + '" data-icon-kind="' + kind + '" role="img" aria-label="' + labels[kind] + '"><svg viewBox="0 0 20 20" aria-hidden="true">' + (kind === "directory" ? folder : page + mark) + "</svg></span>";
    }

    function artifactTreeDescriptors(rows) {
      if (!selectedSource) return [];
      const descriptors = [];
      const addGlobal = (root) => {
        const artifacts = rows.filter((artifact) => artifact.scope.kind === "global" && artifact.scope.root === root.path);
        if (selectedSource !== "all" || artifacts.length) descriptors.push({ kind: "global", root, artifacts, subtitle: "Global Root" });
      };
      const addProjectRoot = (root) => {
        const artifacts = rows.filter((artifact) => artifact.scope.kind === "project" && artifact.scope.projectRoot === root.path);
        if (selectedSource !== "all" || artifacts.length) descriptors.push({ kind: "project", root, artifacts, subtitle: "Project Root" });
      };
      if (selectedSource === "all") {
        snapshot.globalRoots.filter(visible).forEach(addGlobal);
        snapshot.projectRoots.forEach(addProjectRoot);
        return descriptors;
      }
      const separator = selectedSource.indexOf(":");
      const kind = selectedSource.slice(0, separator);
      const path = selectedSource.slice(separator + 1);
      const roots = kind === "global" ? snapshot.globalRoots.filter(visible) : snapshot.projectRoots;
      const root = roots.find((candidate) => candidate.path === path);
      if (root) (kind === "global" ? addGlobal : addProjectRoot)(root);
      return descriptors;
    }

    function buildArtifactTree(descriptor) {
      const artifactByPath = new Map(descriptor.artifacts.map((artifact) => [artifact.path, artifact]));
      const rootArtifact = artifactByPath.get(descriptor.root.path) || null;
      const root = {
        path: descriptor.root.path,
        name: descriptor.root.name || basename(descriptor.root.path),
        kind: "directory",
        artifact: rootArtifact,
        source: descriptor.root,
        sourceKind: descriptor.kind,
        subtitle: descriptor.subtitle,
        children: [],
      };
      const nodes = new Map([[root.path, root]]);
      const sortedArtifacts = [...descriptor.artifacts].sort((left, right) => left.path.localeCompare(right.path, undefined, { sensitivity: "base" }));
      for (const artifact of sortedArtifacts) {
        if (artifact.path === root.path || !isWithin(artifact.path, root.path)) continue;
        const relative = artifact.path.slice(root.path.length).replace(/^\\/+/, "");
        if (!relative) continue;
        const segments = relative.split("/");
        let parent = root;
        for (let index = 0; index < segments.length; index += 1) {
          const path = root.path + "/" + segments.slice(0, index + 1).join("/");
          let node = nodes.get(path);
          if (!node) {
            const metadata = artifactByPath.get(path) || null;
            node = {
              path,
              name: segments[index],
              kind: metadata?.kind || "directory",
              artifact: metadata,
              source: null,
              sourceKind: null,
              subtitle: null,
              children: [],
            };
            nodes.set(path, node);
            parent.children.push(node);
          }
          parent = node;
        }
      }
      const sortChildren = (node) => {
        node.children.sort((left, right) => {
          const kindOrder = (left.kind === "directory" ? 0 : 1) - (right.kind === "directory" ? 0 : 1);
          return kindOrder || left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
        });
        node.children.forEach(sortChildren);
      };
      sortChildren(root);
      return root;
    }

    function initializeArtifactTree(roots) {
      for (const root of roots) {
        if (initializedArtifactRoots.has(root.path)) continue;
        initializedArtifactRoots.add(root.path);
        if (!(root.artifact || root.source)?.isSymbolicLink) openArtifactDirectories.add(root.path);
      }
    }

    function prepareArtifactTree(roots) {
      initializeArtifactTree(roots);
      artifactTreeNodes = new Map();
      visibleTreePaths = [];
      const visit = (node, shown) => {
        artifactTreeNodes.set(node.path, node);
        if (shown) visibleTreePaths.push(node.path);
        if (!(node.artifact || node.source)?.isSymbolicLink) {
          node.children.forEach((child) => visit(child, shown && openArtifactDirectories.has(node.path)));
        }
      };
      roots.forEach((root) => visit(root, true));
      while (selectedTreePath && !visibleTreePaths.includes(selectedTreePath)) {
        const parent = dirname(selectedTreePath);
        selectedTreePath = parent === selectedTreePath ? null : parent;
      }
      selectedTreePath ||= visibleTreePaths[0] || null;
    }

    function focusSelectedTreeNode() {
      const item = Array.from(app.querySelectorAll("[data-tree-path]")).find((candidate) => candidate.dataset.treePath === selectedTreePath);
      item?.querySelector(":scope > .artifact-row-main > .artifact-button")?.focus({ preventScroll: true });
    }

    function runTreeSelection(path, action) {
      const select = () => {
        selectedTreePath = path;
        action?.();
        renderReady();
        focusSelectedTreeNode();
      };
      if (hasPendingEdit() && openedArtifact?.artifactIdentity !== path) runOrGuard(select); else select();
    }

    function toggleArtifactDirectory(path, force) {
      const expanded = openArtifactDirectories.has(path);
      const shouldExpand = force === undefined ? !expanded : force;
      if (shouldExpand) openArtifactDirectories.add(path); else openArtifactDirectories.delete(path);
    }

    function handleArtifactTreeKey(event) {
      const button = event.target.closest(".artifact-button");
      const item = button?.closest("[data-tree-path]");
      if (!item || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Delete"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const path = item.dataset.treePath;
      const node = artifactTreeNodes.get(path);
      if (!node) return;
      const index = visibleTreePaths.indexOf(path);
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const target = visibleTreePaths[Math.max(0, Math.min(visibleTreePaths.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
        if (target) runTreeSelection(target);
        return;
      }
      if (event.key === "ArrowRight") {
        if (node.kind !== "directory" || (node.artifact || node.source)?.isSymbolicLink) return;
        if (!openArtifactDirectories.has(path) && node.children.length) runTreeSelection(path, () => toggleArtifactDirectory(path, true));
        else if (node.children[0]) runTreeSelection(node.children[0].path);
        return;
      }
      if (event.key === "ArrowLeft") {
        if (node.kind === "directory" && openArtifactDirectories.has(path)) runTreeSelection(path, () => toggleArtifactDirectory(path, false));
        else {
          const parent = dirname(path);
          if (artifactTreeNodes.has(parent)) runTreeSelection(parent);
        }
        return;
      }
      if (event.key === "Enter") {
        if (node.kind === "directory") runTreeSelection(path, () => toggleArtifactDirectory(path));
        else if (openedArtifact?.artifactIdentity !== path) runTreeSelection(path, () => { void openArtifact(path); });
        return;
      }
      item.querySelector("[data-remove-artifact]")?.click();
    }

    function renderArtifactActions(node) {
      if (demo) return "";
      const artifact = node.artifact;
      if (!artifact) {
        if (!node.source) return "";
        return '<button type="button" class="reveal-button" data-reveal-source-kind="' + escapeHtml(node.sourceKind === "global" ? "global-root" : "project-root") + '" data-reveal-source-path="' + escapeHtml(node.path) + '" aria-label="Reveal ' + escapeHtml(node.name) + ' in Finder"' + systemActionDisabled + '>⌖</button>';
      }
      const targetKind = isSymbolicLinkRemovalCandidate(artifact)
        ? "symbolic-link"
        : isManagedSkillDirectoryCandidate(artifact)
          ? "managed-skill-directory"
          : isFileRemovalCandidate(artifact) ? "file" : null;
      const dirtyTarget = targetKind ? pendingEditAffectedBy(artifact.path, targetKind) : false;
      const staleTarget = inventoryStatus === "stale";
      const trashTitle = staleTarget ? "Refresh Inventory before another mutation" : dirtyTarget ? "Discard or save the pending edit first" : "Move to Trash";
      const trash = targetKind ? '<button type="button" class="trash-button" data-remove-artifact="' + escapeHtml(artifact.path) + '" data-removal-kind="' + targetKind + '" aria-label="Move ' + escapeHtml(node.name) + ' to Trash" title="' + trashTitle + '"' + (dirtyTarget || staleTarget || !systemManagementSupported ? " disabled" : "") + '>⌫</button>' : "";
      return trash + '<button type="button" class="reveal-button" data-reveal-artifact="' + escapeHtml(artifact.path) + '" aria-label="Reveal ' + escapeHtml(node.name) + ' in Finder"' + systemActionDisabled + '>⌖</button>';
    }

    function renderArtifactNode(node, level = 1) {
      const entry = node.artifact || node.source;
      const isDirectory = node.kind === "directory";
      const isLinkedDirectory = isDirectory && entry?.isSymbolicLink;
      const expandable = isDirectory && !isLinkedDirectory && node.children.length > 0;
      const expanded = expandable && openArtifactDirectories.has(node.path);
      const category = node.artifact?.category || node.subtitle;
      const harnesses = node.artifact?.harnesses || node.source?.harnesses || [];
      const memberships = harnesses.map((id) => '<span class="member">' + escapeHtml(harnessLabels[id] || id) + "</span>").join("");
      const chevron = '<span class="tree-chevron ' + (expanded ? "open" : expandable ? "" : "leaf") + '" aria-hidden="true">›</span>';
      const content = '<span><span class="artifact-name">' + chevron + artifactTypeIcon(node) + symlinkIcon(entry) + '<span class="artifact-name-text" title="' + escapeHtml(node.name) + '">' + escapeHtml(node.name) + "</span>" + (category ? '<span class="member">' + escapeHtml(category) + "</span>" : "") + '</span><code class="artifact-path" data-testid="artifact-path">' + escapeHtml(compactPath(node.path, snapshot.home)) + "</code>" + symlinkTarget(entry) + '</span><span class="memberships">' + memberships + "</span>";
      const button = isDirectory
        ? '<button type="button" class="artifact-button directory-button" tabindex="' + (selectedTreePath === node.path ? "0" : "-1") + '"' + (isLinkedDirectory ? ' aria-disabled="true"' : ' data-directory="' + escapeHtml(node.path) + '" aria-expanded="' + expanded + '"') + ' aria-label="' + escapeHtml(node.name + (isLinkedDirectory ? " symbolic link directory" : " directory")) + '">' + content + "</button>"
        : '<button type="button" class="artifact-button" tabindex="' + (selectedTreePath === node.path ? "0" : "-1") + '" data-artifact="' + escapeHtml(node.path) + '" aria-pressed="' + (openedArtifact?.artifactIdentity === node.path) + '">' + content + "</button>";
      const children = expanded ? '<ul class="artifact-children" role="group">' + node.children.map((child) => renderArtifactNode(child, level + 1)).join("") + "</ul>" : "";
      return '<li class="artifact-node" role="treeitem" aria-selected="' + (selectedTreePath === node.path) + '" aria-level="' + level + '" data-tree-path="' + escapeHtml(node.path) + '"' + (expandable ? ' aria-expanded="' + expanded + '"' : "") + '><div class="artifact-row-main">' + button + renderArtifactActions(node) + "</div>" + children + "</li>";
    }

    function renderArtifacts() {
      if (!selectedSource) return '<div class="empty">Choose a source to browse its Agent Configuration Artifacts.</div>';
      const descriptors = artifactTreeDescriptors(sourceArtifacts());
      if (!descriptors.length) return '<div class="empty">No recognized artifacts for this source and filter.</div>';
      const roots = descriptors.map(buildArtifactTree);
      prepareArtifactTree(roots);
      return '<div class="tree-toolbar" role="toolbar" aria-label="Artifact Explorer"><button type="button" class="secondary-button" data-tree-expand="true" aria-label="Expand all artifact directories">Expand all</button> <button type="button" class="secondary-button" data-tree-expand="false" aria-label="Collapse all artifact directories">Collapse all</button></div><ul class="artifact-list" role="tree" aria-label="Agent Configuration Artifacts">' + roots.map((root) => renderArtifactNode(root)).join("") + "</ul>";
    }

    function scopeLabel(scope) {
      return scope.kind === "global" ? "Global" : "Project";
    }

    function hasPendingEdit() {
      return openedArtifact !== null && pendingContent !== null && pendingContent !== openedArtifact.content;
    }

    function pendingEditBytes() {
      if (!openedArtifact || pendingContent === null) return 0;
      const newlineCount = pendingContent.split("\\n").length - 1;
      let newlineOverhead = openedArtifact.newlineStyle === "crlf" ? newlineCount : 0;
      if (openedArtifact.newlineStyle === "mixed") {
        const map = openedArtifact.newlineByteOverheadMap || "";
        newlineOverhead = 0;
        for (let index = 0; index < Math.min(newlineCount, map.length); index += 1) {
          if (map[index] === "1") newlineOverhead += 1;
        }
      }
      return new TextEncoder().encode(pendingContent).length + newlineOverhead + (openedArtifact.hasUtf8Bom ? 3 : 0);
    }

    function pendingEditWithinLimit() {
      return pendingEditBytes() <= 1048576;
    }

    function isArtifactEditable() {
      return !demo && openedArtifact?.editability === "editable";
    }

    function cursorLabel(textarea) {
      const before = textarea.value.slice(0, textarea.selectionStart);
      const lines = before.split("\\n");
      return "Ln " + lines.length + ", Col " + ((lines.at(-1)?.length || 0) + 1);
    }

    function renderDetail() {
      if (openingArtifactIdentity) return '<div class="detail-loading"><div><div class="loader"></div>Opening artifact…</div></div>';
      if (detailError) return '<div class="detail-error"><strong>' + escapeHtml(detailError.code) + '</strong><p>' + escapeHtml(detailError.message) + "</p></div>";
      if (!openedArtifact) return '<div class="detail-empty"><div><strong>No artifact open</strong><p>Select an eligible text artifact. Content is loaded only after that explicit action.</p></div></div>';
      const linkLabel = openedArtifact.symbolicLink.isSymbolicLink ? "Symbolic link" : "Not a symbolic link";
      const resolved = openedArtifact.symbolicLink.resolvedPath ? '<dt>Resolved Path</dt><dd><code>' + escapeHtml(openedArtifact.symbolicLink.resolvedPath) + "</code></dd>" : "";
      const editable = isArtifactEditable();
      const dirty = hasPendingEdit();
      const withinLimit = pendingEditWithinLimit();
      const note = (dirty ? "Discard or save the pending edit before moving this file to Trash. · " : "")
        + (editable
          ? (openedArtifact.symbolicLink.isSymbolicLink ? "Editing linked target · " : "") + openedArtifact.format + " edit · Cmd/Ctrl+S reviews before writing"
          : demo ? "Read-only demo · Example content" : "View-only · File is not writable");
      const errorLocation = saveError?.technicalDetails ? ' · Line ' + saveError.technicalDetails.line + ', column ' + saveError.technicalDetails.column : "";
      const error = saveError ? '<p class="save-error" role="alert"><strong>' + escapeHtml(saveError.code) + '</strong> · ' + escapeHtml(saveError.message) + errorLocation + '</p>' : "";
      const status = !dirty ? (demo ? "Demo" : "Saved") : withinLimit ? "Unsaved changes" : "Pending Edit too large";
      const success = saveStatus ? '<p class="validation-ready" role="status">' + escapeHtml(saveStatus) + '</p>' : "";
      const latest = openedArtifact.recovery?.latestBackup;
      const recovery = '<section data-testid="artifact-recovery"><h4>Recovery</h4>' + (latest
        ? '<dl class="metadata"><dt>Latest backup</dt><dd><code>' + escapeHtml(latest.relativePath) + '</code></dd><dt>Protected revision</dt><dd><code>' + escapeHtml(latest.editRevision) + '</code></dd><dt>Created</dt><dd>' + escapeHtml(latest.createdAt) + '</dd></dl><button type="button" class="secondary-button" data-testid="reveal-latest-backup"' + systemActionDisabled + '>Reveal backup in Finder</button>'
        : '<p>No backup recorded for this artifact</p>') + '</section>';
      return '<div class="detail-body"><div class="detail-meta"><div class="detail-title"><h3>' + escapeHtml(basename(openedArtifact.artifactIdentity)) + '</h3><button type="button" class="close-editor" data-testid="close-editor" aria-label="Close editor">×</button></div><dl class="metadata"><dt>Artifact Identity</dt><dd><code>' + escapeHtml(openedArtifact.artifactIdentity) + '</code></dd><dt>Format</dt><dd>' + escapeHtml(openedArtifact.format) + '</dd><dt>Encoding</dt><dd>' + (openedArtifact.hasUtf8Bom ? "UTF-8 BOM" : "UTF-8") + '</dd><dt>Scope</dt><dd>' + escapeHtml(scopeLabel(openedArtifact.scope)) + '</dd><dt>Harness Memberships</dt><dd>' + openedArtifact.harnesses.map((id) => escapeHtml(harnessLabels[id] || id)).join(", ") + '</dd><dt>Symbolic link</dt><dd>' + linkLabel + '</dd>' + resolved + '<dt>Edit Revision</dt><dd><code>' + escapeHtml(openedArtifact.editRevision) + '</code></dd></dl>' + recovery + '</div><div class="editor">' + success + error + '<div class="editor-bar"><label for="artifact-content">Artifact content</label><div class="editor-actions"><span class="editor-status" data-testid="editor-status">' + status + '</span>' + (demo ? '' : '<button class="save-button" type="button" data-testid="review-save"' + (editable && dirty && withinLimit && inventoryStatus !== "stale" ? "" : " disabled") + '>Review save</button>') + '</div></div><textarea id="artifact-content" aria-label="Artifact content"' + (editable ? "" : " readonly") + ' spellcheck="false">' + escapeHtml(pendingContent ?? openedArtifact.content) + '</textarea><p class="editor-note"><span>' + note + '</span><span class="cursor-position" data-testid="cursor-position">Ln 1, Col 1</span></p></div></div>';
    }

    function renderSaveReview() {
      if (!currentReview) return "";
      const metadata = currentReview.metadata;
      const link = currentReview.symbolicLink?.isSymbolicLink ? '<dl class="metadata"><dt>Symbolic link</dt><dd><span aria-hidden="true" data-testid="review-symlink-icon">↗</span> Symbolic link</dd><dt>Artifact Identity (symbolic link)</dt><dd><code>' + escapeHtml(currentReview.artifactIdentity) + '</code></dd><dt>Resolved Path (target to be saved)</dt><dd><code>' + escapeHtml(currentReview.symbolicLink.resolvedPath) + '</code></dd><dt>Scope</dt><dd>' + escapeHtml(scopeLabel(currentReview.scope)) + '</dd><dt>Harness Memberships</dt><dd>' + currentReview.harnesses.map((id) => escapeHtml(harnessLabels[id] || id)).join(", ") + '</dd></dl><p>Saving changes the target bytes and preserves the symbolic link.</p>' : '<code class="review-identity">' + escapeHtml(currentReview.artifactIdentity) + '</code>';
      return '<div class="modal-backdrop"><section class="save-review" role="dialog" aria-modal="true" aria-labelledby="save-review-title"><div class="review-head"><h2 id="save-review-title">Save Review</h2></div><div class="review-body">' + link + '<p class="validation-ready" data-testid="save-validation">' + escapeHtml(currentReview.validation.message) + '</p><div class="review-metadata"><span>' + escapeHtml(metadata.format) + '</span><span>' + escapeHtml(metadata.newline) + '</span><span>' + escapeHtml(metadata.permissions) + '</span><span>' + metadata.originalBytes + ' → ' + metadata.proposedBytes + ' bytes</span></div><div class="diff" data-testid="save-diff"><section><h3>Before</h3><pre>' + escapeHtml(currentReview.diff.before) + '</pre></section><section><h3>After</h3><pre>' + escapeHtml(currentReview.diff.after) + '</pre></section></div></div><div class="review-actions"><button type="button" class="secondary-button" data-testid="cancel-save-review">Cancel</button><button type="button" class="save-button" data-testid="confirm-save"' + systemActionDisabled + '>Confirm save</button></div></section></div>';
    }

    function renderRemovalPreview() {
      if (!removalPreview) return "";
      if (removalPreview.status === "refused") {
        const limit = removalPreview.reason === "entries" ? "5,000 entries" : "100 MiB";
        return '<div class="modal-backdrop"><section class="removal-review" role="dialog" aria-modal="true" aria-labelledby="removal-title"><div class="review-head"><h2 id="removal-title">Too large to review safely</h2></div><div class="review-body"><code class="review-identity">' + escapeHtml(removalPreview.artifactIdentity) + '</code><p>This Managed Skill Directory exceeded the ' + limit + ' preview limit. It was not approved for removal.</p><p>Observed at least: ' + escapeHtml(removalPreview.observedAtLeast) + '</p></div><div class="review-actions"><button type="button" class="secondary-button" data-testid="cancel-removal">Cancel</button><button type="button" class="secondary-button" data-testid="reveal-refused-removal">Reveal in Finder</button></div></section></div>';
      }
      const memberships = removalPreview.harnesses.map((id) => escapeHtml(harnessLabels[id] || id)).join(", ");
      if (removalPreview.targetKind === "managed-skill-directory") {
        const icons = { file: "File", directory: "Directory", "symbolic-link": "Symbolic link", other: "Other" };
        const tree = removalPreview.tree.entries.map((entry) => '<div style="--depth:' + entry.depth + '"><span>' + icons[entry.type] + '</span> · ' + escapeHtml(entry.relativePath) + '</div>').join("");
        const remaining = removalPreview.summary.entries - removalPreview.tree.entries.length;
        return '<div class="modal-backdrop"><section class="removal-review" role="dialog" aria-modal="true" aria-labelledby="removal-title" aria-describedby="removal-consequence"><div class="review-head"><h2 id="removal-title">Move skill directory to Trash</h2></div><div class="review-body"><code class="review-identity">' + escapeHtml(removalPreview.artifactIdentity) + '</code><p id="removal-consequence">This whole directory will be moved as one recoverable target to macOS Trash without following symbolic links inside it.</p><dl class="metadata"><dt>Skill name</dt><dd><strong>' + escapeHtml(removalPreview.skillName) + '</strong></dd><dt>Skills root</dt><dd><code>' + escapeHtml(removalPreview.parentSkillsRoot) + '</code></dd><dt>Scope</dt><dd>' + escapeHtml(scopeLabel(removalPreview.scope)) + '</dd><dt>Harness Memberships</dt><dd>' + memberships + '</dd><dt>Files</dt><dd>' + removalPreview.summary.files + '</dd><dt>Directories</dt><dd>' + removalPreview.summary.directories + '</dd><dt>Symbolic links</dt><dd>' + removalPreview.summary.symbolicLinks + '</dd><dt>Other</dt><dd>' + removalPreview.summary.other + '</dd><dt>Total bytes</dt><dd>' + removalPreview.summary.totalBytes + '</dd></dl><div class="removal-tree" aria-label="Bounded tree summary">' + tree + (remaining > 0 ? '<div>… ' + remaining + ' more entries</div>' : "") + '</div><label class="typed-confirmation">Type “' + escapeHtml(removalPreview.skillName) + '” to confirm<textarea rows="2" data-testid="removal-confirmation" aria-label="Type “' + escapeHtml(removalPreview.skillName) + '” to confirm" autocomplete="off" spellcheck="false"></textarea></label></div><div class="review-actions"><button type="button" class="secondary-button" data-testid="cancel-removal">Cancel</button><button type="button" class="danger-button" data-testid="confirm-removal" disabled>Move ' + escapeHtml(removalPreview.skillName) + ' to Trash</button></div></section></div>';
      }
      if (removalPreview.targetKind === "symbolic-link") {
        const targetState = removalPreview.linkState === "broken"
          ? '<p><strong>Broken target — no target will be accessed</strong></p><dl class="metadata"><dt>Resolved Path</dt><dd>Not available</dd></dl>'
          : '<dl class="metadata"><dt>Resolved Path</dt><dd><code>' + escapeHtml(removalPreview.resolvedPath) + '</code></dd><dt>Target boundary</dt><dd>' + escapeHtml(removalPreview.targetBoundary === "inside" ? "Inside Management Boundary" : "Outside Management Boundary") + '</dd></dl>';
        return '<div class="modal-backdrop"><section class="removal-review" role="dialog" aria-modal="true" aria-labelledby="removal-title" aria-describedby="removal-consequence"><div class="review-head"><h2 id="removal-title">Move symbolic link to Trash</h2></div><div class="review-body"><code class="review-identity">' + escapeHtml(removalPreview.artifactIdentity) + '</code><p id="removal-consequence">Only this symbolic link will be moved to macOS Trash. Its target will not be moved, copied, modified, or backed up.</p>' + targetState + '<dl class="metadata"><dt>Type</dt><dd>1 symbolic link</dd><dt>Scope</dt><dd>' + escapeHtml(scopeLabel(removalPreview.scope)) + '</dd><dt>Category</dt><dd>' + escapeHtml(removalPreview.category) + '</dd><dt>Harness Memberships</dt><dd>' + memberships + '</dd><dt>Link bytes</dt><dd>' + removalPreview.summary.totalBytes + '</dd></dl></div><div class="review-actions"><button type="button" class="secondary-button" data-testid="cancel-removal">Cancel</button><button type="button" class="danger-button" data-testid="confirm-removal"' + (removalInFlight ? " disabled" : "") + '>Move symbolic link to Trash</button></div></section></div>';
      }
      const warning = removalPreview.skillWarning ? '<div class="skill-warning" role="alert"><strong>This may disable the skill.</strong><p>Skill directory: <code>' + escapeHtml(removalPreview.skillWarning.directory) + '</code></p><p>Harness Memberships: ' + memberships + '</p></div>' : "";
      return '<div class="modal-backdrop"><section class="removal-review" role="dialog" aria-modal="true" aria-labelledby="removal-title" aria-describedby="removal-consequence"><div class="review-head"><h2 id="removal-title">Move file to Trash</h2></div><div class="review-body"><code class="review-identity">' + escapeHtml(removalPreview.artifactIdentity) + '</code><p id="removal-consequence">This file will be moved to macOS Trash and can be restored there until Trash is emptied.</p>' + warning + '<dl class="metadata"><dt>Type</dt><dd>File</dd><dt>Scope</dt><dd>' + escapeHtml(scopeLabel(removalPreview.scope)) + '</dd><dt>Category</dt><dd>' + escapeHtml(removalPreview.category) + '</dd><dt>Harness Memberships</dt><dd>' + memberships + '</dd><dt>Bytes</dt><dd>' + removalPreview.summary.totalBytes + '</dd></dl></div><div class="review-actions"><button type="button" class="secondary-button" data-testid="cancel-removal">Cancel</button><button type="button" class="danger-button" data-testid="confirm-removal"' + (removalInFlight ? " disabled" : "") + '>Move this file to Trash</button></div></section></div>';
    }

    function renderDirtyGuard() {
      if (!dirtyAction) return "";
      return '<div class="modal-backdrop"><section class="dirty-guard" role="dialog" aria-modal="true" aria-labelledby="dirty-title"><div class="review-head"><h2 id="dirty-title">Unsaved changes</h2></div><div class="review-body"><p>This artifact has a browser-only Pending Edit.</p></div><div class="review-actions"><button type="button" class="secondary-button" data-testid="dirty-cancel">Cancel</button><button type="button" class="secondary-button" data-testid="dirty-discard">Discard</button><button type="button" class="save-button" data-testid="dirty-save"' + (pendingEditWithinLimit() ? "" : " disabled") + '>Save changes</button></div></section></div>';
    }

    function renderHelp() {
      if (!helpOpen) return "";
      if (demo) return '<div class="modal-backdrop"><section class="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title"><div class="review-head"><h2 id="help-title">Explore the demo</h2><button type="button" class="secondary-button" data-testid="close-help" aria-label="Close help">Close</button></div><div class="help-body"><p>This demo uses fictional configurations. It cannot access your files.</p><p>Select a Global Root or Project Root, expand directories and open a text artifact. Resize the columns or filter by Agent Harness.</p><p>Saving, backups, Finder and Trash are available in the local macOS application. This demo is read-only.</p><p>Use arrow keys to explore the tree, Enter to open an artifact, and Escape to close help.</p></div></section></div>';
      return '<div class="modal-backdrop"><section class="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title"><div class="review-head"><div><p class="eyebrow">Local guide</p><h2 id="help-title">Harness Config Studio help</h2></div><button type="button" class="secondary-button" data-testid="close-help" aria-label="Close help">Close</button></div><div class="help-body">' +
        '<section class="help-section"><h3>How it works</h3><p>Select a Global Root or Project Root, then explore its recognized Agent Configuration Artifacts. Inventory lists metadata only; file content is loaded explicitly when you open an eligible file.</p></section>' +
        '<section class="help-section"><h3>Artifact Explorer</h3><ul><li>Roots begin expanded; nested directories begin collapsed.</li><li>Use Expand all or Collapse all for the current tree.</li><li>File and directory icons show the artifact kind. The link badge marks symbolic links, and complete truncated names appear on hover.</li><li>Drag either column boundary to resize adjacent columns.</li></ul></section>' +
        '<section class="help-section"><h3>Editing and saving</h3><p>Supported UTF-8 files (up to one MiB): ${SUPPORTED_EDITABLE_EXTENSIONS}. Scripts and Rules are never executed or syntax-validated. Editable text opens in the Editor. Changes remain a browser-only Pending Edit until you review and confirm the diff. Navigation never saves or discards silently, and every accepted save retains a recoverable backup.</p></section>' +
        '<section class="help-section"><h3>Removal and recovery</h3><p>The Trash action always opens a Removal Preview first. Eligible files, symbolic links, and bounded skill directories move to macOS Trash; they are never permanently deleted here. The tree refreshes after a successful action.</p></section>' +
        '<section class="help-section help-shortcuts"><h3>Keyboard shortcuts</h3><dl class="shortcut-list"><dt><kbd>?</kbd></dt><dd>Open this help from outside a text field.</dd><dt><kbd>Esc</kbd></dt><dd>Close this help.</dd><dt><kbd>↑ / ↓</kbd></dt><dd>Move selection through visible tree items.</dd><dt><kbd>← / →</kbd></dt><dd>Collapse or expand a directory; move to its parent or first child.</dd><dt><kbd>Enter</kbd></dt><dd>Toggle a directory or explicitly open a file.</dd><dt><kbd>Delete</kbd></dt><dd>Open Removal Preview; it never removes immediately.</dd><dt><kbd>Cmd/Ctrl+S</kbd></dt><dd>Open Save Review for the current Pending Edit.</dd><dt><kbd>Home / End</kbd></dt><dd>Move a focused column separator to its allowed minimum or maximum.</dd></dl></section>' +
        '<section class="help-section help-shortcuts"><h3>Safety boundaries</h3><p>The web server stays on loopback, the CLI remains read-only, and there is no LLM analysis. Symbolic-link directories are never traversed. Finder, save, and Trash actions require an explicit browser action and are available only on macOS.</p></section>' +
        '</div></section></div>';
    }

    function closeHelp() {
      if (!helpOpen) return;
      helpOpen = false;
      renderReady();
      helpButton.focus({ preventScroll: true });
    }

    function openHelp() {
      if (!snapshot || currentReview || removalPreview || dirtyAction || helpOpen) return;
      helpOpen = true;
      renderReady();
    }

    function runOrGuard(action) {
      if (!hasPendingEdit()) {
        void action();
        return;
      }
      dirtyAction = action;
      renderReady();
    }

    function syncSectionToggle() {
      const sections = Array.from(app.querySelectorAll("[data-collapsible]"));
      const allOpen = sections.length > 0 && sections.every((section) => section.open);
      sectionToggle.setAttribute("aria-label", allOpen ? "Collapse all sections" : "Expand all sections");
      sectionToggle.setAttribute("aria-pressed", String(allOpen));
      sectionToggle.textContent = allOpen ? "Collapse all" : "Expand all";
      sectionToggle.disabled = sections.length === 0;
    }

    function applyColumnWidths() {
      const columns = app.querySelector(".columns");
      if (!columns) return;
      const available = columns.clientWidth - 16;
      columnWidths.sources = Math.max(columnMinimumWidths.sources, Math.min(columnWidths.sources, available - columnMinimumWidths.artifacts - columnMinimumWidths.detail));
      columnWidths.artifacts = Math.max(columnMinimumWidths.artifacts, Math.min(columnWidths.artifacts, available - columnWidths.sources - columnMinimumWidths.detail));
      app.style.setProperty("--sources-width", columnWidths.sources + "px");
      app.style.setProperty("--artifacts-width", columnWidths.artifacts + "px");
      for (const separator of columns.querySelectorAll("[data-resize-column]")) {
        const key = separator.dataset.resizeColumn;
        const maximum = key === "sources" ? columnWidths.sources + columnWidths.artifacts - columnMinimumWidths.artifacts : available - columnWidths.sources - columnMinimumWidths.detail;
        separator.setAttribute("aria-valuemin", columnMinimumWidths[key]);
        separator.setAttribute("aria-valuemax", Math.round(maximum));
        separator.setAttribute("aria-valuenow", Math.round(columnWidths[key]));
        separator.setAttribute("aria-valuetext", Math.round(columnWidths[key]) + " pixels");
      }
    }

    function renderColumnResizer(key, label) {
      return '<div class="column-resizer" role="separator" tabindex="0" aria-orientation="vertical" aria-label="' + label + '" aria-controls="management-' + key + '" data-resize-column="' + key + '" title="Drag or use Left/Right arrows to resize columns"></div>';
    }

    function bindColumnResizers() {
      applyColumnWidths();
      const columns = app.querySelector(".columns");
      for (const separator of columns.querySelectorAll("[data-resize-column]")) {
        const key = separator.dataset.resizeColumn;
        let drag = null;
        separator.addEventListener("pointerdown", (event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          const adjacentMinimum = key === "sources" ? columnMinimumWidths.artifacts : columnMinimumWidths.detail;
          const pairWidth = key === "sources" ? columnWidths.sources + columnWidths.artifacts : columns.clientWidth - 16 - columnWidths.sources;
          drag = { pointerId: event.pointerId, x: event.clientX, width: columnWidths[key], pairWidth, adjacentMinimum };
          event.preventDefault();
          separator.focus({ preventScroll: true });
          separator.setPointerCapture(event.pointerId);
          separator.toggleAttribute("data-dragging", true);
          columns.classList.add("is-resizing");
        });
        separator.addEventListener("pointermove", (event) => {
          if (!drag || event.pointerId !== drag.pointerId) return;
          columnWidths[key] = Math.max(columnMinimumWidths[key], Math.min(drag.width + event.clientX - drag.x, drag.pairWidth - drag.adjacentMinimum));
          if (key === "sources") columnWidths.artifacts = drag.pairWidth - columnWidths.sources;
          applyColumnWidths();
        });
        separator.addEventListener("keydown", (event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const pairWidth = columnWidths.sources + columnWidths.artifacts;
          const minimum = columnMinimumWidths[key];
          const maximum = Number(separator.getAttribute("aria-valuemax"));
          const requested = event.key === "Home" ? minimum : event.key === "End" ? maximum : columnWidths[key] + (event.key === "ArrowRight" ? 16 : -16);
          columnWidths[key] = Math.max(minimum, Math.min(requested, maximum));
          if (key === "sources") columnWidths.artifacts = pairWidth - columnWidths.sources;
          applyColumnWidths();
        });
        const finish = () => {
          const pointerId = drag?.pointerId;
          drag = null;
          separator.removeAttribute("data-dragging");
          columns.classList.remove("is-resizing");
          if (pointerId !== undefined && separator.hasPointerCapture(pointerId)) separator.releasePointerCapture(pointerId);
        };
        separator.addEventListener("pointerup", finish);
        separator.addEventListener("pointercancel", finish);
        separator.addEventListener("lostpointercapture", finish);
        separator.addEventListener("blur", finish);
      }
    }

    function bindControls() {
      bindColumnResizers();
      for (const details of app.querySelectorAll("[data-group]")) {
        details.addEventListener("toggle", () => {
          if (details.open) openGroups.add(details.dataset.group); else openGroups.delete(details.dataset.group);
          syncSectionToggle();
        });
      }
      for (const button of app.querySelectorAll("[data-source]")) {
        button.addEventListener("click", () => {
          const nextSource = button.dataset.source;
          runOrGuard(() => {
            selectedSource = nextSource;
            openedArtifact = null;
            pendingContent = null;
            detailError = null;
            renderReady();
          });
        });
      }
      for (const button of app.querySelectorAll("[data-filter]")) {
        button.addEventListener("click", () => {
          const id = button.dataset.filter;
          runOrGuard(() => {
            if (enabledHarnesses.has(id)) enabledHarnesses.delete(id); else enabledHarnesses.add(id);
            openedArtifact = null;
            pendingContent = null;
            renderReady();
          });
        });
      }
      const emptyToggle = app.querySelector('[data-testid="toggle-empty-projects"]');
      emptyToggle?.addEventListener("click", () => {
        showEmptyProjects = !showEmptyProjects;
        openGroups.add("project");
        renderReady();
      });
      for (const button of app.querySelectorAll("[data-tree-expand]")) {
        button.addEventListener("click", () => {
          for (const node of artifactTreeNodes.values()) {
            if (node.kind !== "directory" || (node.artifact || node.source)?.isSymbolicLink) continue;
            if (button.dataset.treeExpand === "true") openArtifactDirectories.add(node.path);
            else openArtifactDirectories.delete(node.path);
          }
          renderReady();
          focusSelectedTreeNode();
        });
      }
      const artifactTree = app.querySelector('[role="tree"]');
      artifactTree?.addEventListener("keydown", handleArtifactTreeKey);
      artifactTree?.addEventListener("focusin", (event) => {
        const item = event.target.closest("[data-tree-path]");
        if (!item) return;
        if (hasPendingEdit() && selectedTreePath !== item.dataset.treePath) return;
        selectedTreePath = item.dataset.treePath;
        for (const candidate of artifactTree.querySelectorAll("[data-tree-path]")) {
          const selected = candidate === item;
          candidate.setAttribute("aria-selected", String(selected));
          const control = candidate.querySelector(":scope > .artifact-row-main > .artifact-button");
          if (control) control.tabIndex = selected ? 0 : -1;
        }
      });
      for (const button of app.querySelectorAll("[data-directory]")) {
        button.addEventListener("click", () => {
          const path = button.dataset.directory;
          runTreeSelection(path, () => toggleArtifactDirectory(path));
        });
      }
      for (const button of app.querySelectorAll("[data-artifact]")) {
        button.addEventListener("click", () => {
          const identity = button.dataset.artifact;
          if (openedArtifact?.artifactIdentity === identity) {
            runTreeSelection(identity);
            return;
          }
          runTreeSelection(identity, () => { void openArtifact(identity); });
        });
      }
      for (const button of app.querySelectorAll("[data-reveal-artifact]")) {
        button.addEventListener("click", () => revealTarget(
          { kind: "artifact", artifactIdentity: button.dataset.revealArtifact },
          basename(button.dataset.revealArtifact),
        ));
      }
      for (const button of app.querySelectorAll("[data-remove-artifact]")) {
        button.addEventListener("click", () => requestRemovalPreview(button.dataset.removeArtifact, button.dataset.removalKind));
      }
      for (const button of app.querySelectorAll("[data-reveal-source-kind]")) {
        button.addEventListener("click", () => revealTarget(
          { kind: button.dataset.revealSourceKind, path: button.dataset.revealSourcePath },
          basename(button.dataset.revealSourcePath),
        ));
      }
      const editor = app.querySelector("#artifact-content");
      if (editor && isArtifactEditable()) {
        const syncEditorState = () => {
          pendingContent = editor.value;
          currentReview = null;
          saveError = null;
          saveStatus = null;
          app.querySelector(".save-error")?.remove();
          const dirty = hasPendingEdit();
          const withinLimit = pendingEditWithinLimit();
          app.querySelector('[data-testid="editor-status"]').textContent = !dirty ? "Saved" : withinLimit ? "Unsaved changes" : "Pending Edit too large";
          app.querySelector('[data-testid="review-save"]').disabled = !dirty || !withinLimit || inventoryStatus === "stale";
          for (const removalButton of app.querySelectorAll("[data-remove-artifact]")) {
            const affected = pendingEditAffectedBy(removalButton.dataset.removeArtifact, removalButton.dataset.removalKind);
            removalButton.disabled = affected || inventoryStatus === "stale" || !systemManagementSupported;
            removalButton.title = inventoryStatus === "stale" ? "Refresh Inventory before another mutation" : affected ? "Discard or save the pending edit first" : "Move to Trash";
          }
          app.querySelector('[data-testid="cursor-position"]').textContent = cursorLabel(editor);
        };
        editor.addEventListener("input", syncEditorState);
        for (const eventName of ["click", "keyup", "select"]) editor.addEventListener(eventName, syncEditorState);
        editor.addEventListener("keydown", (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            if (hasPendingEdit() && pendingEditWithinLimit()) void requestSaveReview();
            return;
          }
          if (event.key === "Tab") {
            event.preventDefault();
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            editor.setRangeText("\\t", start, end, "end");
            editor.dispatchEvent(new Event("input", { bubbles: true }));
          }
        });
      }
      app.querySelector('[data-testid="review-save"]')?.addEventListener("click", requestSaveReview);
      app.querySelector('[data-testid="reveal-latest-backup"]')?.addEventListener("click", () => revealTarget(
        { kind: "latest-artifact-backup", artifactIdentity: openedArtifact.artifactIdentity },
        "latest backup",
      ));
      app.querySelector('[data-testid="close-editor"]')?.addEventListener("click", () => runOrGuard(() => {
        openedArtifact = null;
        pendingContent = null;
        detailError = null;
        renderReady();
      }));
      app.querySelector('[data-testid="cancel-save-review"]')?.addEventListener("click", () => {
        currentReview = null;
        deferredAction = null;
        renderReady();
      });
      app.querySelector('[data-testid="confirm-save"]')?.addEventListener("click", applyCurrentReview);
      app.querySelector('[data-testid="cancel-removal"]')?.addEventListener("click", () => {
        removalPreview = null;
        renderReady();
      });
      app.querySelector('[data-testid="confirm-removal"]')?.addEventListener("click", applyRemoval);
      const removalConfirmation = app.querySelector('[data-testid="removal-confirmation"]');
      removalConfirmation?.addEventListener("input", () => {
        const confirm = app.querySelector('[data-testid="confirm-removal"]');
        if (confirm) confirm.disabled = removalConfirmation.value !== removalPreview?.skillName || removalInFlight;
      });
      app.querySelector('[data-testid="reveal-refused-removal"]')?.addEventListener("click", () => {
        revealTarget({ kind: "managed-skill-directory", path: removalPreview.artifactIdentity }, removalPreview.skillName);
      });
      app.querySelector('[data-testid="retry-removal"]')?.addEventListener("click", () => requestRemovalPreview(removalStatus.retryArtifactIdentity));
      app.querySelector('[data-testid="open-trash"]')?.addEventListener("click", openTrash);
      app.querySelector('[data-testid="retry-inventory"]')?.addEventListener("click", () => requestInventoryRefresh("retry"));
      app.querySelector('[data-testid="dirty-cancel"]')?.addEventListener("click", () => {
        dirtyAction = null;
        renderReady();
      });
      app.querySelector('[data-testid="dirty-discard"]')?.addEventListener("click", () => {
        const action = dirtyAction;
        dirtyAction = null;
        currentReview = null;
        pendingContent = openedArtifact?.content ?? null;
        if (action) void action();
      });
      app.querySelector('[data-testid="dirty-save"]')?.addEventListener("click", () => {
        deferredAction = dirtyAction;
        dirtyAction = null;
        void requestSaveReview();
      });
      app.querySelector('[data-testid="close-help"]')?.addEventListener("click", closeHelp);
    }

    function renderReady() {
      app.dataset.state = "ready";
      const modalOpen = Boolean(currentReview || removalPreview || dirtyAction || helpOpen);
      document.querySelector("header").toggleAttribute("inert", modalOpen);
      const selectedLabel = selectedSource === "all" ? "All artifacts" : selectedSource ? basename(selectedSource.slice(selectedSource.indexOf(":") + 1)) : "Select a source";
      const revealNotice = revealStatus ? '<div class="reveal-status ' + (revealStatus.error ? "error" : "") + '" role="status">' + escapeHtml(revealStatus.message) + "</div>" : "";
      const removalNotice = removalStatus ? '<div class="removal-status ' + (removalStatus.error ? "error" : "") + '" role="status"><span>' + escapeHtml(removalStatus.message) + '</span>' + (removalStatus.moved ? '<button type="button" class="secondary-button" data-testid="open-trash">Open Trash</button>' : removalStatus.retryArtifactIdentity ? '<button type="button" class="secondary-button" data-testid="retry-removal">Retry Preview</button>' : "") + "</div>" : "";
      const staleMessage = staleInventory?.primaryAction === "save"
        ? "Saved successfully. Inventory refresh failed; the view below may be outdated."
        : staleInventory?.primaryAction === "removal"
          ? "Moved to Trash. Inventory refresh failed; the view below may be outdated."
          : "Inventory refresh failed. Showing the last successful snapshot.";
      const inventoryBanner = inventoryStatus === "stale"
        ? '<div class="inventory-banner" role="alert" data-testid="stale-inventory"><p><strong>' + staleMessage + '</strong><br><code>' + escapeHtml(staleInventory?.error?.code || "inventory-refresh-failed") + ' · Last successful snapshot ' + escapeHtml(publishedAt || "unknown") + '</code></p><button type="button" class="secondary-button" data-testid="retry-inventory"' + (inventoryRefreshInFlight ? " disabled" : "") + '>Retry Inventory</button></div>'
        : inventoryStatus === "refreshing" ? '<div class="inventory-banner" role="status" data-testid="inventory-refreshing"><p><strong>Refreshing Inventory…</strong></p></div>' : "";
      app.innerHTML = '<div class="inventory-layout">' + inventoryBanner + '<section class="columns"' + (modalOpen ? " inert" : "") + '><aside class="column" id="management-sources" data-testid="management-sources"><div class="column-head"><p class="eyebrow">Sources</p><h2>Configuration roots</h2></div><div class="column-body">' + renderSources() + '</div></aside>' + renderColumnResizer("sources", "Resize Configuration and Artifacts") + '<section class="column" id="management-artifacts" data-testid="management-artifacts"><div class="column-head"><p class="eyebrow">Artifacts</p><h2>' + escapeHtml(selectedLabel) + '</h2><code><span data-testid="artifact-count">' + inventoryArtifacts().filter(visible).length + '</span> visible in Inventory</code></div>' + revealNotice + removalNotice + '<div class="column-body">' + renderArtifacts() + '</div></section>' + renderColumnResizer("artifacts", "Resize Artifacts and Editor") + '<section class="column" id="management-detail" data-testid="management-detail"><div class="column-head"><p class="eyebrow">Detail</p><h2>' + (openedArtifact ? escapeHtml(basename(openedArtifact.artifactIdentity)) : "Editor") + '</h2><code>One artifact at a time</code></div><div class="column-body">' + renderDetail() + "</div></section></section></div>" + renderSaveReview() + renderRemovalPreview() + renderDirtyGuard() + renderHelp();
      bindControls();
      syncSectionToggle();
      if (applicationDataReveal) applicationDataReveal.disabled = !systemManagementSupported;
      if (modalOpen) {
        app.querySelector('[data-testid="close-help"], [data-testid="cancel-removal"], [data-testid="cancel-save-review"], [data-testid="dirty-cancel"]')?.focus();
      }
    }

    async function openArtifact(artifactIdentity) {
      const openSequence = ++artifactOpenSequence;
      openingArtifactIdentity = artifactIdentity;
      detailError = null;
      saveError = null;
      saveStatus = null;
      renderReady();
      try {
        const response = await request("/api/management/artifacts/open", {
          method: "POST",
          headers: { "content-type": "application/json", "x-harness-config-capability": capability },
          body: JSON.stringify({ artifactIdentity }),
        });
        const payload = await response.json();
        if (openSequence !== artifactOpenSequence) return;
        if (!response.ok) throw payload.error || { code: "management-failed", message: "Unable to open artifact." };
        openedArtifact = payload;
        pendingContent = payload.content;
      } catch (error) {
        if (openSequence !== artifactOpenSequence) return;
        openedArtifact = null;
        detailError = { code: error?.code || "management-failed", message: error?.message || String(error) };
      } finally {
        if (openSequence === artifactOpenSequence) {
          openingArtifactIdentity = null;
          renderReady();
        }
      }
    }

    async function revealTarget(target, label) {
      revealStatus = { message: "Asking Finder…", error: false };
      renderReady();
      try {
        const response = await request("/api/management/reveal", {
          method: "POST",
          headers: { "content-type": "application/json", "x-harness-config-capability": capability },
          body: JSON.stringify({ target }),
        });
        const payload = await response.json();
        if (!response.ok) throw { ...(payload.error || { code: "finder-reveal-failed", message: "Finder could not reveal the managed location." }), warnings: payload.warnings };
        revealStatus = {
          message: "Asked Finder to " + (payload.disposition === "select-item" ? "select " : "open ") + label + ".",
          error: false,
        };
        if (payload.warnings?.length) revealStatus.message += " " + payload.warnings[0].message;
        if ("applicationDataRootAvailable" in payload) syncApplicationDataReveal(payload.applicationDataRootAvailable);
      } catch (error) {
        revealStatus = { message: (error?.code || "finder-reveal-failed") + ": " + (error?.message || String(error)) + (error?.warnings?.length ? " · " + error.warnings[0].message : ""), error: true };
      }
      renderReady();
    }

    async function requestRemovalPreview(artifactIdentity, targetKind) {
      if (!artifactIdentity || inventoryStatus === "stale") return;
      const artifact = inventoryArtifacts().find((candidate) => candidate.path === artifactIdentity);
      const effectiveKind = targetKind || (artifact && isManagedSkillDirectoryCandidate(artifact) ? "managed-skill-directory" : "file");
      if (pendingEditAffectedBy(artifactIdentity, effectiveKind)) {
        dirtyAction = () => requestRemovalPreview(artifactIdentity, effectiveKind);
        renderReady();
        return;
      }
      removalStatus = effectiveKind === "managed-skill-directory" ? { message: "Scanning directory…", error: false, moved: false } : null;
      renderReady();
      try {
        const response = await request("/api/management/removals/preview", {
          method: "POST",
          headers: { "content-type": "application/json", "x-harness-config-capability": capability },
          body: JSON.stringify({ artifactIdentity }),
        });
        const payload = await response.json();
        if (!response.ok) throw payload.error || { code: "removal-preview-failed", message: "Unable to review removal." };
        removalPreview = payload;
        removalStatus = null;
      } catch (error) {
        removalPreview = null;
        removalStatus = { message: (error?.code || "removal-preview-failed") + ": " + (error?.message || String(error)), error: true, moved: false, ...(effectiveKind === "managed-skill-directory" ? { retryArtifactIdentity: artifactIdentity } : {}) };
      }
      renderReady();
    }

    async function applyRemoval() {
      if (!removalPreview || removalPreview.status === "refused" || removalInFlight) return;
      const review = removalPreview;
      if (pendingEditAffectedBy(review.artifactIdentity, review.targetKind)) {
        removalPreview = null;
        dirtyAction = () => requestRemovalPreview(review.artifactIdentity, review.targetKind);
        renderReady();
        return;
      }
      const confirmationName = review.targetKind === "managed-skill-directory"
        ? app.querySelector('[data-testid="removal-confirmation"]')?.value
        : undefined;
      removalInFlight = true;
      renderReady();
      try {
        const response = await request("/api/management/removals/apply", {
          method: "POST",
          headers: { "content-type": "application/json", "x-harness-config-capability": capability },
          body: JSON.stringify({ removalReviewId: review.removalReviewId, ...(confirmationName === undefined ? {} : { confirmationName }) }),
        });
        const payload = await response.json();
        if (!response.ok) throw { ...(payload.error || { code: "trash-failed", message: "Unable to move the selected target to Trash." }), warnings: payload.warnings };
        const openedInside = openedArtifact && removalAffectsReference(
          openedArtifact.artifactIdentity,
          openedArtifact.symbolicLink.resolvedPath,
          review.artifactIdentity,
          review.targetKind,
        );
        if (openedInside) {
          openedArtifact = null;
          pendingContent = null;
          currentReview = null;
          saveError = null;
        }
        const confirmedEffect = {
          action: "removal",
          artifactIdentity: review.artifactIdentity,
          targetKind: review.targetKind,
        };
        if (payload.reconciliation?.status === "fresh") {
          applyPublishedSnapshot(payload.reconciliation.published);
        } else if (payload.reconciliation?.status === "stale"
          && (payload.reconciliation.lastPublishedGeneration ?? 0) >= publishedGeneration) {
          confirmedEffects.push(confirmedEffect);
          inventoryStatus = "stale";
          staleInventory = { primaryAction: "removal", error: payload.reconciliation.error };
        }
        removalPreview = null;
        removalStatus = { message: review.targetKind === "symbolic-link" ? "Symbolic link moved to Trash; target unchanged" : "Moved to Trash", error: false, moved: true };
        if (payload.warnings?.length) removalStatus.message += " · " + payload.warnings.map((warning) => warning.message).join(" · ");
        if ("applicationDataRootAvailable" in payload) syncApplicationDataReveal(payload.applicationDataRootAvailable);
      } catch (error) {
        removalPreview = null;
        removalStatus = { message: (error?.code || "trash-failed") + ": " + (error?.message || String(error)) + (error?.warnings?.length ? " · " + error.warnings[0].message : ""), error: true, moved: false, retryArtifactIdentity: review.artifactIdentity };
      } finally {
        removalInFlight = false;
        renderReady();
      }
    }

    async function openTrash() {
      try {
        const response = await request("/api/management/trash/open", {
          method: "POST",
          headers: { "content-type": "application/json", "x-harness-config-capability": capability },
          body: "{}",
        });
        const payload = await response.json();
        if (!response.ok) throw payload.error || { code: "trash-failed", message: "Unable to open Trash." };
      } catch (error) {
        removalStatus = { message: "Moved to Trash · " + (error?.code || "trash-failed") + ": " + (error?.message || String(error)), error: true, moved: true };
        renderReady();
      }
    }

    async function requestSaveReview() {
      if (!openedArtifact || !hasPendingEdit() || !pendingEditWithinLimit() || reviewingSave || inventoryStatus === "stale") return;
      reviewingSave = true;
      try {
        const response = await request("/api/management/saves/review", {
          method: "POST",
          headers: { "content-type": "application/json", "x-harness-config-capability": capability },
          body: JSON.stringify({
            editHandle: openedArtifact.editHandle,
            editRevision: openedArtifact.editRevision,
            content: pendingContent,
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw payload.error || { code: "review-failed", message: "Unable to review save." };
        currentReview = payload;
        renderReady();
      } catch (error) {
        deferredAction = null;
        saveError = { code: error?.code || "review-failed", message: error?.message || String(error), technicalDetails: error?.technicalDetails };
        renderReady();
      } finally {
        reviewingSave = false;
      }
    }

    async function applyCurrentReview() {
      if (!currentReview) return;
      const review = currentReview;
      const confirmButton = app.querySelector('[data-testid="confirm-save"]');
      if (confirmButton) confirmButton.disabled = true;
      try {
        const response = await request("/api/management/saves/apply", {
          method: "POST",
          headers: { "content-type": "application/json", "x-harness-config-capability": capability },
          body: JSON.stringify({ reviewId: review.reviewId }),
        });
        const payload = await response.json();
        if (!response.ok) throw { ...(payload.error || { code: "save-failed", message: "Unable to save artifact." }), warnings: payload.warnings };
        const savedSymbolicLink = Boolean(openedArtifact?.symbolicLink.isSymbolicLink);
        openedArtifact.content = pendingContent;
        openedArtifact.editRevision = payload.editRevision;
        openedArtifact.recovery = { latestBackup: payload.backupReference || null };
        if (payload.reconciliation?.status === "fresh") {
          applyPublishedSnapshot(payload.reconciliation.published);
        } else if (payload.reconciliation?.status === "stale"
          && (payload.reconciliation.lastPublishedGeneration ?? 0) >= publishedGeneration) {
          inventoryStatus = "stale";
          staleInventory = { primaryAction: "save", error: payload.reconciliation.error };
        }
        currentReview = null;
        detailError = null;
        saveError = null;
        const warningMessages = payload.warnings?.map((warning) => warning.message).join(" · ");
        saveStatus = warningMessages || (savedSymbolicLink ? "Saved target; symbolic link preserved" : "Saved successfully");
        if ("applicationDataRootAvailable" in payload) syncApplicationDataReveal(payload.applicationDataRootAvailable);
        renderReady();
        const action = deferredAction;
        deferredAction = null;
        if (action) void action();
      } catch (error) {
        currentReview = null;
        deferredAction = null;
        saveError = { code: error?.code || "save-failed", message: (error?.message || String(error)) + (error?.warnings?.length ? " · " + error.warnings[0].message : ""), technicalDetails: error?.technicalDetails };
        renderReady();
      }
    }

    function renderLoading() {
      app.dataset.state = "loading";
      app.innerHTML = '<section class="state"><div><div class="loader"></div><strong>Loading configuration inventory…</strong></div></section>';
      refreshButton.disabled = true;
      sectionToggle.disabled = true;
      if (applicationDataReveal) applicationDataReveal.disabled = true;
    }

    function renderError(error) {
      app.dataset.state = "error";
      app.innerHTML = '<section class="state"><div class="error-card"><h2>Could not load inventory</h2><p>The local scan did not complete.</p><code>' + escapeHtml(error instanceof Error ? error.message : String(error)) + '</code><button class="retry" type="button" data-testid="retry">Retry</button></div></section>';
      app.querySelector('[data-testid="retry"]').addEventListener("click", load);
      sectionToggle.disabled = true;
      if (applicationDataReveal) applicationDataReveal.disabled = true;
    }

    async function load() {
      renderLoading();
      try {
        const response = await request("/api/inventory", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message || "Unable to load inventory");
        snapshot = payload;
        const generation = Number(response.headers.get("x-harness-config-inventory-generation"));
        if (Number.isInteger(generation) && generation > 0) publishedGeneration = generation;
        publishedAt = payload.generatedAt;
        inventoryStatus = "fresh";
        staleInventory = null;
        openedArtifact = null;
        pendingContent = null;
        currentReview = null;
        renderReady();
      } catch (error) {
        renderError(error);
      } finally {
        refreshButton.disabled = false;
      }
    }

    async function refreshInventory(reason) {
      if (inventoryRefreshInFlight) return;
      inventoryRefreshInFlight = true;
      refreshButton.disabled = true;
      if (snapshot) {
        if (inventoryStatus !== "stale") inventoryStatus = "refreshing";
        renderReady();
      } else {
        renderLoading();
      }
      try {
        const response = await request("/api/management/inventory/refresh", {
          method: "POST",
          headers: { "content-type": "application/json", "x-harness-config-capability": capability },
          body: JSON.stringify({ reason }),
        });
        const outcome = await response.json();
        if (!response.ok) throw outcome.error || { code: "inventory-refresh-failed", message: "Inventory could not be refreshed." };
        if (outcome.status === "fresh") {
          applyPublishedSnapshot(outcome.published);
        } else if (snapshot) {
          if ((outcome.lastPublished?.generation ?? 0) >= publishedGeneration) {
            inventoryStatus = "stale";
            staleInventory = { primaryAction: staleInventory?.primaryAction || "manual", error: outcome.error };
          } else {
            inventoryStatus = "fresh";
            staleInventory = null;
          }
        } else {
          throw outcome.error;
        }
        if (snapshot) renderReady();
      } catch (error) {
        if (snapshot) {
          inventoryStatus = "stale";
          staleInventory = { primaryAction: staleInventory?.primaryAction || "manual", error: { code: error?.code || "inventory-refresh-failed" } };
          renderReady();
        } else {
          renderError(error);
        }
      } finally {
        inventoryRefreshInFlight = false;
        refreshButton.disabled = false;
        if (snapshot) renderReady();
      }
    }

    function requestInventoryRefresh(reason) {
      const requestedGeneration = publishedGeneration;
      runOrGuard(() => {
        if (publishedGeneration > requestedGeneration) return;
        return refreshInventory(reason);
      });
    }

    window.addEventListener("resize", applyColumnWidths);
    helpButton.addEventListener("click", openHelp);
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && helpOpen) {
        event.preventDefault();
        closeHelp();
        return;
      }
      const target = event.target;
      const isTyping = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || target?.isContentEditable;
      if (event.key === "?" && !isTyping && !helpOpen) {
        event.preventDefault();
        openHelp();
      }
    });
    refreshButton.addEventListener("click", () => requestInventoryRefresh("manual"));
    sectionToggle.addEventListener("click", () => {
      const sections = Array.from(app.querySelectorAll("[data-collapsible]"));
      const shouldOpen = !sections.every((section) => section.open);
      runOrGuard(() => {
        openGroups.clear();
        if (shouldOpen) for (const section of sections) openGroups.add(section.dataset.group);
        selectedSource = shouldOpen ? "all" : null;
        openedArtifact = null;
        pendingContent = null;
        renderReady();
      });
    });
    window.addEventListener("beforeunload", (event) => {
      if (!hasPendingEdit()) return;
      event.preventDefault();
      event.returnValue = "";
    });
    function bindApplicationDataReveal() {
      applicationDataReveal?.addEventListener("click", () => {
        revealTarget({ kind: "application-data-root" }, ".harness_config_studio");
      });
    }

    function ensureApplicationDataReveal() {
      if (applicationDataReveal) return;
      const button = document.createElement("button");
      button.className = "top-action";
      button.type = "button";
      button.dataset.testid = "reveal-application-data";
      button.textContent = "Reveal application data in Finder";
      button.disabled = !systemManagementSupported;
      document.querySelector(".top-actions")?.prepend(button);
      applicationDataReveal = button;
      bindApplicationDataReveal();
    }

    function syncApplicationDataReveal(available) {
      if (available) {
        ensureApplicationDataReveal();
        return;
      }
      applicationDataReveal?.remove();
      applicationDataReveal = null;
    }

    bindApplicationDataReveal();
    load();
  })();
  </script>
</body>
</html>`;
}
