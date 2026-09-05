# Harness Config Studio

A local inventory of the filesystem artifacts that configure coding agents,
shown across home-level roots and user-selected project workspaces.

## Language

**Agent Harness**:
A supported coding-agent host with its own filesystem conventions, such as Codex, Claude Code, OpenCode, or Pi.
_Avoid_: Agent Ecosystem, provider, platform

**Agent Configuration Artifact**:
A file, directory, or symbolic link recognized as agent configuration within a Global Root or Project Root.
_Avoid_: Config file, item

**Runtime Artifact**:
Data produced while an Agent Harness runs, such as sessions, logs, caches,
credentials, history, or telemetry. Runtime Artifacts are excluded from the
Inventory.
_Avoid_: Config, miscellaneous files

**Harness Adapter**:
A built-in, versioned definition of the Global Roots, project-level patterns,
configuration categories, and exclusions belonging to one Agent Harness.
_Avoid_: Plugin, detector

**Global Root**:
A home-scoped directory where an Agent Harness stores configuration shared across projects.
_Avoid_: Global config, home config

**Workspace**:
The user-selected directory within which Project Roots are discovered.
_Avoid_: Workdir, repository collection

**Project Root**:
A directory inside a Workspace that contains either a Git repository marker or at least one recognized project-level Agent Configuration Artifact.
_Avoid_: Project, folder

**Project Scope**:
A directory below a Project Root that contains its own recognized project-level Agent Configuration Artifacts but is not itself a nested Git repository. It remains part of the nearest Project Root.
_Avoid_: Nested project, subproject

**Inventory**:
A read-only snapshot of discovered roots, projects, artifacts, and path metadata that excludes artifact contents.
_Avoid_: Analysis, audit, report

**Resolved Path**:
The absolute target path reached by following a symbolic link.
_Avoid_: Real file, original path

**Artifact Identity**:
The normalized absolute path of an Agent Configuration Artifact. v0 does not
assign an opaque or generated identifier.
_Avoid_: ID, UUID

**Harness Membership**:
The set of Agent Harnesses that consume an Agent Configuration Artifact. One
physical artifact can have several memberships without becoming several
artifacts.
_Avoid_: Owner, duplicated artifact

**Web Management**:
The browser-only v1 surface for explicitly viewing, editing, revealing, and
performing Recoverable Removal of Agent Configuration Artifacts. The CLI remains
an Inventory-only, read-only surface.
_Avoid_: Web editor, mutable CLI

**Recoverable Removal**:
A mutation that moves an Agent Configuration Artifact to the operating system's
Trash, where the user can restore it until the Trash is emptied outside the app.
For a symbolic link, it applies to the link itself and never its Resolved Path.
_Avoid_: Delete, permanent removal, rm

**Editable Artifact**:
An inventoried UTF-8 configuration file whose format and size are inside the
Web Management editing policy. A symbolic-link file is editable through its
explicitly displayed Resolved Path.
_Avoid_: Any text file, arbitrary path

**Edit Revision**:
The exact on-disk byte state observed when an Editable Artifact is opened. A
save is valid only while the current file still has that revision.
_Avoid_: Latest version, modification time

**Managed Skill Directory**:
A real, non-hidden directory directly below a recognized skills root, whether
complete, incomplete, or empty. It is the only kind of directory eligible for
Recoverable Removal in v1.
_Avoid_: Skill container, arbitrary artifact directory, folder

**Pending Edit**:
Browser-held content that differs from the Edit Revision and has not passed Save
Review or been written to disk.
_Avoid_: Draft file, autosave

**Save Review**:
The explicit Web Management checkpoint that presents the exact path, validation
result, and diff for a Pending Edit before the user authorizes a save.
_Avoid_: Save prompt, autosave

**Artifact Backup**:
A pre-save snapshot stored under `~/.harness_config_studio/backups` and associated
with the Artifact Identity and Edit Revision it protects. V1 retains at most ten
per artifact and reuses a matching backup when an interrupted Save is retried.
_Avoid_: Temporary file, autosave copy

**Removal Preview**:
A bounded, no-symlink-traversal snapshot of the exact file, link, or Managed
Skill Directory proposed for Recoverable Removal, including its path, entry
counts, total bytes, and affected Harness Memberships.
_Avoid_: Confirmation dialog, dry run, recursive listing

**Removal Revision**:
The path, entry structure, types, sizes, and filesystem timestamps observed by a
Removal Preview. Recoverable Removal is valid only while that metadata remains
unchanged.
_Avoid_: Directory hash, current folder

**System Reveal**:
A non-mutating Web Management action that asks Finder to select an artifact's
visible path or open a directory. A symbolic link reveals the link rather than
its Resolved Path.
_Avoid_: Open file, browse target

**Management Boundary**:
The canonical filesystem area formed by the selected Workspace and known Global
Roots. Web Management never reads or mutates a symbolic-link target outside this
boundary.
_Avoid_: Home directory, allowed path, sandbox

**Activity Record**:
A local metadata-only account of a Web Management action containing its time,
action, Artifact Identity, result, and related Artifact Backup when present.
It never contains artifact content.
_Avoid_: Telemetry, audit event, log message

**Application Data Root**:
The owner-only `~/.harness_config_studio` directory containing Artifact Backups
and the bounded Activity Record file. It is not a Global Root and is never
included in Inventory.
_Avoid_: Configuration root, cache, application support

**Stale Inventory**:
An Inventory snapshot that could not be refreshed after a confirmed filesystem
action. The action result remains authoritative while the displayed Inventory
requires an explicit retry.
_Avoid_: Failed action, rolled-back action
