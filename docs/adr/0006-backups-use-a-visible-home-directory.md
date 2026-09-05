# Application data uses a hidden owner-only home directory

Updated by the maintainer's decision: use `~/.harness_config_studio` instead of
the original visible `~/harness_config_studio` directory. This supersedes the
original visibility choice; the ADR filename is retained for existing links.

The Application Data Root contains Artifact Backups and the bounded Activity
Record file. The root uses mode `0700` and its files use `0600`. The application's
Finder action opens the hidden directory directly. Activity recording remains
diagnostic and best-effort: failure is surfaced as a warning but never blocks or
rolls back the primary filesystem action.

Existing data in the old visible directory is not moved, merged, or deleted
automatically. New operations use the hidden directory. To retain recovery history
in the application, a maintainer may move the old directory to the new path while
the application is stopped and only if the destination does not already exist.
