# Removal uses the macOS Trash only

V1 implements Recoverable Removal only by moving an eligible Agent Configuration Artifact to the macOS Trash. It never falls back to permanent deletion when that operation is unavailable or fails, and moving a symbolic link affects only the link rather than its Resolved Path; this deliberately trades convenience for recoverability and a narrow destructive boundary.
