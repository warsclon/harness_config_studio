# Harness Config Studio

**One local workspace for the instructions, settings and skills across your coding agents and projects.**

Codex · Claude Code · OpenCode · Pi

![Harness Config Studio showing fictional global configuration and AGENTS.md content](https://raw.githubusercontent.com/warsclon/harness_config_studio/main/docs/media/hero.png)

Explore configuration roots, inspect artifact contents, and see which Agent Harnesses
use each file. In the local app, review changes before saving, preserve backups,
and move eligible artifacts to macOS Trash.

![A 12-second walkthrough of the read-only demo: global instructions, project configuration, settings and a shared skill](https://raw.githubusercontent.com/warsclon/harness_config_studio/main/docs/media/workflow.gif)

## Explore the demo

A static, read-only demo uses the real interface with fictional configurations.
It cannot access your files. Browse Codex, Claude Code, OpenCode and Pi roots,
open example artifacts, filter harnesses and resize the columns.
Saving, backups, Finder and Trash are available in the local macOS application;
they are not simulated by the hosted demo.

From this checkout, run `npm ci`, then `npx playwright install chromium` for browser
checks, and `npm run site:preview` to open the presentation and demo locally.
The command prints a loopback URL. No deployment is performed.

**[Try the live demo →](https://warsclon.github.io/harness_config_studio/)**
— no installation, fictional data, read-only.

See [presentation maintenance](https://github.com/warsclon/harness_config_studio/blob/main/docs/PRESENTATION.md)
for media regeneration and GitHub Pages deployment.

## Application

Harness Config Studio is a local, deterministic tool for the filesystem
artifacts that configure Codex, Claude Code, OpenCode, and Pi. Version `0.2.7`
has two deliberately different surfaces:

- `harness-config inventory` is a read-only CLI that emits the unchanged
  `schemaVersion: 1` Inventory contract.
- `harness-config` starts the loopback Web Management UI for a human to inspect,
  edit, reveal, and move eligible artifacts to the macOS Trash.

Version `0.2.7` is [published on npm](https://www.npmjs.com/package/harness-config-studio)
with GitHub Actions provenance. Run it without a permanent installation:

```bash
npx harness-config-studio@0.2.7
```

Or install the command globally:

```bash
npm install -g harness-config-studio
harness-config
```

Version `0.2.7` includes Rules/script editing and Claude hook discovery.
It was published through GitHub Actions Trusted Publishing (OIDC), with verified
provenance and package integrity.

## Requirements and local use

- macOS for Finder, Trash, and filesystem mutations.
- Tested on Node.js 22 and 24. The package accepts Node.js >=22; other majors
  have not been qualified for this release.
- A desktop browser. The UI is English-only and desktop-only.

```bash
npm install
npm run build

# Start Web Management for the current directory and open the browser.
node dist/cli.js

# Select another Workspace without opening a browser automatically.
node dist/cli.js /path/to/workspace --no-open

# Emit the read-only Inventory JSON contract.
node dist/cli.js inventory /path/to/workspace --json

# Identify the running package.
node dist/cli.js --version
```

The installed executable is named `harness-config`. The home directory is
detected automatically and the Workspace defaults to the current directory.
Run `harness-config --help` for command-specific options and examples.

After the first npm publication, the equivalent commands will be:

```bash
npx harness-config-studio
npx harness-config-studio inventory /path/to/workspace --json
```

Without `--port`, the server prefers `127.0.0.1:4173` and tries later ports if
needed. An explicit port binds exactly; port `0` requests an ephemeral loopback
port for automated smoke tests.

## Inventory and CLI compatibility

Inventory recognizes built-in configuration patterns for four Agent Harnesses,
including instructions, settings, skills, commands, agents, rules, and MCP
configuration. It reports path metadata and symbolic-link state without reading
artifact content. Runtime data such as credentials, sessions, logs, caches,
history, and telemetry is excluded by allowlist.

Project Roots without recognized artifacts are hidden by default. Use
`--show-empty-projects` in the CLI or the Project configuration toggle in the
web UI to show them. `--no-warnings` keeps `warnings` in the JSON envelope as an
empty array. The CLI has no content, save, Finder, backup, Trash, or removal
command.

See [docs/CLI.md](docs/CLI.md) for the stable machine contract and
[VERSIONS.md](VERSIONS.md) for migration details.

## Web Management

The desktop Artifact Explorer presents Global Roots and Project Roots, Agent
Configuration Artifacts, and the Detail/Editor as three resizable columns.
Agent Configuration Artifacts have distinct icons for file and directory kinds;
symbolic links show their Resolved Path without traversing linked directories,
and truncated names expose their complete value on hover. Roots start expanded
while nested directories start collapsed; toolbar and keyboard controls navigate
the tree without implicitly loading file content. Use the header Help button or
press `?` outside a text field for the workflow guide and complete shortcut list.

Content is loaded only after an explicit artifact selection. The native editor
supports UTF-8 `md`, `txt`, `json`, `jsonc`, `toml`, `yaml`, `yml`, `rules`,
`py`, `ts`, `js`, `mjs`, `cjs`, `mts`, `cts`, `sh`, `bash`, and `zsh` files up
to one MiB. JSON is syntax-validated before Save Review; the other formats are
preserved without parsing or reformatting. Scripts and Rules are never executed
or syntax-validated. File permissions, including executable bits, are retained.

Saving requires an explicit diff review, an unchanged byte revision, a retained
backup, and an atomic same-directory replacement. Backups and a metadata-only
Activity Record live under the owner-only `~/.harness_config_studio` Application
Data Root. Recovery is delegated to Finder; there is no in-app restore.

Eligible files, symbolic links, and bounded Managed Skill Directories can be
moved to the macOS Trash. Symbolic-link removal moves only the link. Directory
preview never follows links and is refused above 5,000 entries or 100 MiB.
There is no permanent-delete fallback. Confirmed actions remain authoritative
if the following Inventory refresh fails; the UI then marks Inventory stale and
offers Retry.

Finder and Trash actions, Save Apply, and Removal Apply fail closed outside
macOS. Inventory, explicit content open, and Save Review remain portable Node.js
operations, but non-macOS Web Management mutations are unsupported.

## Safety and privacy

- The HTTP server binds only to `127.0.0.1`.
- Content-bearing and mutable requests require a random in-memory capability,
  strict Origin and Host validation, and JSON request bodies.
- Every action re-derives and revalidates its target inside the Management
  Boundary. Out-of-boundary symbolic-link targets are never read or edited.
- Errors and Activity Records are content-free. The app has no LLM, telemetry,
  analytics, CDN resources, automatic updates, or outbound service calls.
- No operation changes file permissions to make an artifact writable.

## Development and release gates

```bash
npm run typecheck
npm run build
npm test
npm run package:smoke
```

The suite uses real temporary filesystems, loopback HTTP, the compiled CLI, and
Chromium. Finder and Trash are replaced with a narrow fake in automated tests;
the release smoke packs a real tarball, validates its allowlist, installs it in
a temporary directory, and exercises version/help/Inventory/web startup and
controlled fixture mutations. It tests the installed executable and offline package
execution. Automated checks never move personal configuration. A macOS-only
regression calls the real Trash bridge with a missing fixture; successful native
Finder/Trash operations are checked separately during release qualification.

To retain the tested tarball and its SHA-256/evidence, run
`npm run package:smoke -- --retain-dir release-artifacts`. The output directory
must not already exist. See [the release procedure](docs/RELEASING.md) and
[security reporting status](SECURITY.md).

Harness Config Studio is available under the [MIT License](LICENSE).

Claude hook scripts in `~/.claude/hooks` and project `.claude/hooks` directories
are included recursively in Inventory. Linked directories are not traversed.
The app does not resolve hook command strings or discover arbitrary source files.
