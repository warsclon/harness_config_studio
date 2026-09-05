# Product versions

Package SemVer and Inventory schema version are separate contracts. The package
manifest is the only source of product version. Inventory remains
`schemaVersion: 1` in both releases below.

## 0.1.x — Inventory

The original private release provided deterministic filesystem Inventory in the
CLI and web view. It discovered supported Agent Configuration Artifacts and
symbolic-link metadata without reading content or mutating the filesystem.

## 0.2.6 — Artifact Explorer Web Management and Help

Version `0.2.6` is the first public npm release, published from GitHub Actions
on September 5, 2026. Run it with `npx harness-config-studio@0.2.6`.

The default web launcher provides three resizable desktop columns and a
hierarchical Artifact Explorer. It identifies files and directories, exposes
complete truncated names on hover, preserves symbolic-link boundaries, and
supports pointer and keyboard navigation with explicit file opening. It retains
native text editing, Save Review, versioned backups, atomic save, System Reveal,
Recoverable Removal through macOS Trash, post-action Inventory reconciliation,
and Stale Inventory retry.

The header Help button and the `?` shortcut open an in-app guide covering the
workflow, safety boundaries, tree navigation, column resizing, Save Review, and
Removal Preview. `Esc` closes the guide without changing editor state.

The CLI migration is intentionally uneventful:

- Existing `inventory` scripts keep `schemaVersion: 1` and read-only behavior.
- Project and warning filters are unchanged.
- `--version` is new and help now distinguishes Inventory from Web Management.
- Text that described the whole product as read-only now applies only to the
  Inventory/CLI surface.

Recoverable Removal is not permanent deletion. Eligible files, symbolic links,
and bounded Managed Skill Directories move to macOS Trash; links never move
their targets. Application-managed backup retention is the narrow documented
exception that permanently prunes old app-owned recovery data.

## Deferred beyond 0.2.6

- LLM analysis, health scores, semantic conflicts, or cleanup suggestions.
- Linux/Windows Finder, Trash, or mutation support.
- Mobile-specific UI.
- In-app backup browsing, restore, undo, or emptying Trash.
- Arbitrary directory removal, batch actions, rename, duplicate, or relocation.
