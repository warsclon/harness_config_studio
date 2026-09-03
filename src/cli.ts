#!/usr/bin/env node

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { inventory } from "./index.ts";
import { PRODUCT_VERSION } from "./product-version.ts";
import { startServer } from "./server.ts";

type ParsedArgs = {
  mode: "inventory" | "web";
  workspace: string;
  depth: number;
  port?: number;
  open: boolean;
  help: boolean;
  version: boolean;
  showEmptyProjects: boolean;
  showWarnings: boolean;
};

const HELP = `Harness Config Studio ${PRODUCT_VERSION} — local agent configuration Inventory and Web Management

Usage:
  harness-config [workspace] [web options]
  harness-config web [workspace] [web options]
  harness-config inventory [workspace] [inventory options]

Commands:
  web                 Start the local web UI (default command)
  inventory           Write one versioned JSON inventory document to stdout

The workspace may be positional or supplied with --path. It defaults to the
current directory. The home directory is detected automatically. Inventory
never reads content or changes files. Web Management reads or changes an
artifact only after explicit browser actions. No command makes outbound requests.

Common options:
  --path <dir>        Workspace to scan (default: current directory)
  --depth <n>         Project discovery depth, integer 0-10 (default: 4)
  -V, --version       Show the package version and exit
  -h, --help          Show this help and exit

Web options:
  -p, --port <n>      Exact loopback port, 1-65535 (0 chooses an ephemeral port)
                      Without it, start at 4173 and use the next available port
  --no-open           Start the server without opening a browser

Inventory options:
  --json              Explicit JSON intent; inventory always returns JSON
  --show-empty-projects
                      Include Project Roots with zero recognized artifacts
                      By default, those Project Roots are omitted
  --no-warnings       Suppress warning entries; warnings remains present as []

JSON contract:
  stdout contains one schemaVersion 1 JSON document and no progress text.
  Paths are absolute. A partial scan returns available data plus warnings and
  still succeeds. Use --no-warnings only for presentation, not health checks.

Exit status:
  0  Successful inventory or server startup, including partial scans
  1  Invalid arguments, missing workspace, scan failure, or bind failure

Examples:
  harness-config . --no-open
  harness-config web /workspace --port 4173
  harness-config inventory /workspace --json
  harness-config inventory --path /workspace --depth 2 --show-empty-projects
  harness-config inventory /workspace --json --no-warnings
`;

function takeValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value) throw new Error(`${option} requires a value`);
  return value;
}

function parseArgs(argv: string[], cwd: string): ParsedArgs {
  const args = [...argv];
  let mode: ParsedArgs["mode"] = "web";
  if (args[0] === "inventory") {
    mode = "inventory";
    args.shift();
  } else if (args[0] === "web") {
    args.shift();
  }

  let workspace = cwd;
  let hasWorkspace = false;
  let depth = 4;
  let port: number | undefined;
  let open = true;
  let help = false;
  let version = false;
  let json = false;
  let showEmptyProjects = false;
  let showWarnings = true;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "-h" || argument === "--help") help = true;
    else if (argument === "-V" || argument === "--version") version = true;
    else if (argument === "--no-open") open = false;
    else if (argument === "--json") json = true;
    else if (argument === "--show-empty-projects") showEmptyProjects = true;
    else if (argument === "--no-warnings") showWarnings = false;
    else if (argument === "--path") {
      workspace = resolve(cwd, takeValue(args, index, argument));
      hasWorkspace = true;
      index += 1;
    } else if (argument === "--depth") {
      depth = Number(takeValue(args, index, argument));
      index += 1;
    } else if (argument === "--port" || argument === "-p") {
      port = Number(takeValue(args, index, argument));
      index += 1;
    } else if (argument?.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    else if (!hasWorkspace && argument) {
      workspace = resolve(cwd, argument);
      hasWorkspace = true;
    } else if (argument) throw new Error(`Unexpected argument: ${argument}`);
  }

  if (!Number.isInteger(depth) || depth < 0 || depth > 10) {
    throw new Error("--depth must be an integer from 0 to 10");
  }
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    throw new Error("--port must be an integer from 0 to 65535");
  }
  if (mode === "inventory" && !open) throw new Error("--no-open is available only in web mode");
  if (mode === "inventory" && port !== undefined) throw new Error("--port is available only in web mode");
  if (mode === "web" && json) throw new Error("--json is available only with inventory");
  if (mode === "web" && showEmptyProjects) {
    throw new Error("--show-empty-projects is available only with inventory");
  }
  if (mode === "web" && !showWarnings) throw new Error("--no-warnings is available only with inventory");
  return { mode, workspace: resolve(workspace), depth, port, open, help, version, showEmptyProjects, showWarnings };
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.once("error", () => undefined);
  child.unref();
}

async function assertDirectory(path: string): Promise<void> {
  const info = await stat(path);
  if (!info.isDirectory()) throw new Error(`Not a directory: ${path}`);
}

async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv, process.cwd());
  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }
  if (parsed.version) {
    process.stdout.write(`${PRODUCT_VERSION}\n`);
    return;
  }

  const request = { home: homedir(), workspace: parsed.workspace, maxDepth: parsed.depth };
  if (parsed.mode === "inventory") {
    const result = await inventory(request);
    if (!parsed.showEmptyProjects) {
      result.projectRoots = result.projectRoots.filter((project) => result.artifacts.some(
        (artifact) => artifact.scope.kind === "project" && artifact.scope.projectRoot === project.path,
      ));
    }
    if (!parsed.showWarnings) result.warnings = [];
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  await assertDirectory(parsed.workspace);
  const running = await startServer({
    ...request,
    preferredPort: parsed.port,
    strictPort: parsed.port !== undefined,
  });
  process.stdout.write("\nHarness Config Studio\n");
  process.stdout.write(`Workspace: ${parsed.workspace}\n`);
  process.stdout.write(`Home: ${homedir()} (auto-detected)\n`);
  process.stdout.write(`URL: ${running.url}\n`);
  process.stdout.write("Local Web Management · no LLM · Ctrl+C to quit\n\n");
  if (parsed.open) openBrowser(running.url);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
