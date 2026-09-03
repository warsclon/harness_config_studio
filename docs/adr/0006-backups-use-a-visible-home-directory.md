# Application data uses a visible owner-only home directory

V1 creates `~/harness_config_studio` automatically for Artifact Backups and the bounded Activity Record file rather than using a platform-specific Application Support directory. The root uses mode `0700` and its files use `0600`, keeping potentially sensitive recovery material owner-only but directly inspectable from Finder. Activity recording is diagnostic and best-effort: failure is surfaced as a warning but never blocks or rolls back the primary filesystem action.
