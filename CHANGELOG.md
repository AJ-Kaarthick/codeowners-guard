# Changelog

All notable changes to **CODEOWNERS Guard** will be documented in this file.

## [1.0.0] - 2026-10-10

### Initial Release

- **Filesystem-Aware Path Casing Validation**:
  - Segment-by-segment literal directory entry comparison.
  - Provable casing corrections for root-anchored and literal prefix patterns.
  - Ambiguity detection and suppression for multiple case-variant directory entries.
- **Scoped Quick Fixes via `Ctrl+.`**:
  - Preferred single-rule fix targeting only the pattern token.
  - File-wide bulk fix with confirmation dialog and prevalidated coordinated WorkspaceEdit.
  - Workspace-wide bulk fix across all effective CODEOWNERS files with dynamic counts and cancellation safety.
- **Discovery and Precedence**:
  - Automatic GitHub precedence evaluation: `.github/CODEOWNERS` > `CODEOWNERS` > `docs/CODEOWNERS`.
  - Inactive file diagnostics for shadowed CODEOWNERS files.
  - Repository-root discovery walking upward for `.git` directories and worktree `.git` files with workspace fallback.
  - Independent handling of multi-root workspaces.
- **Syntax and Diagnostic Guards**:
  - Detection and diagnostics for unsupported GitHub CODEOWNERS syntax (`!` negation and `[ ]` character ranges).
  - Unmatched literal path diagnostics.
  - Duplicate pattern override detection explaining GitHub last-match-wins behavior.
  - 3 MB file size limit enforcement.
- **Automatic Non-Blocking Lifecycle**:
  - Automatic scan on activation, file open, and save.
  - Debounced (300ms) re-scans on document edits.
  - Filesystem watcher tracking creations, renames, and deletions with targeted directory cache invalidation.
- **Privacy & Performance**:
  - Completely local: no AI, telemetry, network calls, or backend dependencies.
  - Zero automatic file modifications.
  - Configurable exclusions (`codeownersGuard.exclude`).
