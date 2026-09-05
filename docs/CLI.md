# CLI contract for agents

Harness Config Studio `0.2.6` keeps the command line deterministic,
Inventory-only, and read-only. Structured commands never open a browser, prompt
for input, read configuration content, or mutate the filesystem.

## Version and help

```text
harness-config --version
harness-config --help
```

`--version` prints only the package SemVer and a newline. Help identifies that
same package version and documents the human web launcher separately from the
agent-safe Inventory command.

## Stable Inventory command

```text
harness-config inventory [workspace] [--json]
  [--path DIR] [--depth 0-10]
  [--show-empty-projects] [--no-warnings]
```

The Workspace defaults to the current directory and home is detected
automatically. Inventory always writes one JSON document to stdout; `--json` is
an optional explicit marker. Diagnostics use stderr. Invalid input or a complete
scan failure exits non-zero; partial scans exit zero with structured warnings.

Compatibility guarantees:

- `schemaVersion` remains `1`; it is independent from package version `0.2.6`.
- Paths are normalized and absolute.
- Symbolic-link fields are explicit.
- Shared configuration appears once with `harnesses[]` memberships.
- `--no-warnings` returns `warnings: []` rather than changing the shape.
- No CLI command exposes content, Save Review, save, backup, Finder, Trash,
  restore, move, or Recoverable Removal.

## Human web launcher

```text
harness-config [workspace] [--path DIR] [--depth 0-10] [--port 0-65535] [--no-open]
harness-config web [workspace] [--path DIR] [--depth 0-10] [--port 0-65535] [--no-open]
```

This starts the authenticated local Web Management surface. It is not a
structured mutation command: all content reads and changes require explicit
browser interaction and their review flow. Without `--port`, the launcher
prefers 4173 and tries later loopback ports. Port `0` selects an ephemeral port.

Web Management uses three resizable desktop columns and an Artifact Explorer for
Agent Configuration Artifacts, with distinct icons for file and directory kinds,
full-name hover tooltips, symbolic-link boundaries, and explicit file opening.
Its tree toolbar and keyboard navigation do not add mutable commands to the CLI
contract. The header Help button or `?` opens the web workflow and keyboard
shortcut guide without affecting editor state.

macOS is required for Finder, Trash, Save Apply, and Removal Apply. Those
actions fail closed on other operating systems; the Inventory command remains
read-only and portable within the supported Node.js runtime.

Existing backups in `~/harness_config_studio` remain untouched. New backups and
activity records use `~/.harness_config_studio`. There is no automatic migration.
