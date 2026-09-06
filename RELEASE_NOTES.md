# Harness Config Studio 0.2.7

Release candidate: publication is pending maintainer approval and verification.

## Added

- View and edit Rules, Python, JavaScript, TypeScript and shell artifacts, including module variants: `.rules`, `.py`, `.ts`, `.js`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.sh`, `.bash`, `.zsh`.
- Discover Claude hooks in global and project configuration, including nested script files.
- Format labels, explicit syntax-not-validated messaging and supported-extension guidance.

## Preserved behavior

- Scripts are edited as UTF-8 text and never executed or reformatted.
- Save Review, exact pre-save backups, executable permissions, BOM and line endings remain preserved.
- One-MiB limit, read-only CLI, Inventory schema version 1 and symbolic-link boundaries remain unchanged.
- General source discovery, syntax highlighting and language validation are outside this release.

## Validation and publishing

Release qualification runs on Node 22 and 24. Publication uses the existing version-tag workflow and required approval with OIDC; it does not use the revoked bootstrap token. OIDC success must be verified on the actual release.

---

# Harness Config Studio 0.2.6

The first public npm release was published from GitHub Actions on September 5,
2026, from tag `v0.2.6`, with provenance. Run `npx harness-config-studio@0.2.6`.

## Added

- Hierarchical Artifact Explorer in three resizable desktop columns, with
  distinct file/directory icons and explicit one-at-a-time artifact opening.
- Pointer and keyboard tree navigation, Expand all/Collapse all controls, and
  complete-name hover tooltips for truncated file or directory names.
- Native editing for supported UTF-8 text formats up to one MiB.
- Save Review with validation, exact path, diff, revision checks, backups, and
  atomic replacement.
- Finder reveal and recoverable macOS Trash workflows for eligible files,
  symbolic links, and bounded Managed Skill Directories.
- Recovery wayfinding, metadata-only Activity Records, post-action Inventory
  reconciliation, and Stale Inventory retry.
- `harness-config --version` and a real tarball install/startup smoke gate.
- In-app Help with workflow guidance and a keyboard shortcut reference, opened
  from the header or with `?` and closed with `Esc`.

## Changed

- The web launcher is now a human management surface; the CLI remains a
  read-only Inventory interface.
- Package version is `0.2.6` while Inventory remains `schemaVersion: 1`.
- Nested directories start collapsed and preserve session expansion while
  surviving Inventory refreshes; successful removal selects the nearest visible
  parent and immediately removes the affected subtree from the view.
- HTTP failures use one structured, content-free error envelope.

## Security

- Management POST requests require JSON, strict loopback Host and Origin, and a
  per-process in-memory session capability.
- Targets are revalidated against the Management Boundary before action.
- Errors expose only allowlisted scalar technical details and never process
  output, artifact content, diffs, capabilities, or raw link targets.
- Save Apply, Reveal, and Recoverable Removal fail closed outside macOS.

## Compatibility

- Compiled ESM JavaScript supports Node.js 22 and 24.
- Production dependency count remains zero.
- The UI remains English-only and desktop-only.

## Known limitations

- Finder, Trash, and filesystem mutations are supported only on macOS.
- There is no in-app restore, undo, backup content browser, or permanent artifact
  deletion.
- The app provides no LLM analysis, telemetry, or outbound service integration.
