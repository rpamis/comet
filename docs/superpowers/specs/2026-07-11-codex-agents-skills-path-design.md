# Codex `.agents/skills` Installation Design

## Problem

Current Comet platform metadata installs Codex Skills under `.codex/skills`. Current Codex CLI documentation instead defines repository and user-authored Skill discovery under `.agents/skills`. As a result, a successful Comet Codex installation can remain invisible to current Codex CLI releases.

Codex-specific configuration is a separate concern: rules, hooks, plugin caches, and `config.toml` still belong under `.codex`. Changing the complete Codex platform root to `.agents` would therefore fix Skill discovery while relocating unrelated Codex artifacts incorrectly.

## Goals

- Install project-scoped Codex Skills under `<project>/.agents/skills`.
- Install global Codex Skills under `~/.agents/skills`.
- Keep Codex-specific rules, hooks, configuration, and plugin-cache discovery under `.codex`.
- Make init, update, doctor, inventory, bundle discovery, and uninstall agree on the current Skill location.
- Recognize and safely migrate Comet-managed legacy installations under `.codex/skills`.
- Preserve unrelated user and third-party Skills in both old and new directories.

## Non-goals

- Moving Codex configuration or plugin caches out of `.codex`.
- Treating every `.agents/skills` directory as proof that Codex is installed.
- Duplicating managed Skills permanently across `.agents/skills` and `.codex/skills`.
- Changing other platforms merely because they also consume the shared Agent Skills directory.

## Design

### Separate Skill and platform configuration roots

Codex platform metadata will use `.agents` as its project and global Skill root. Codex rules will explicitly retain `.codex` as their base directory. Hook and plugin-cache code will continue using the existing Codex-specific paths.

This keeps the generic installation pipeline intact: Skill destinations continue to be computed as `<skills root>/skills`, while rule destinations can use the existing independent `rulesBaseDir` capability.

### Legacy compatibility and migration

Legacy `.codex/skills` is a compatibility input, not a second current destination.

- Detection and inventory may inspect legacy Codex Skills so an existing installation remains manageable.
- Update installs the current assets into `.agents/skills` and removes only legacy entries known to be Comet-managed.
- Uninstall removes Comet-managed entries from both current and legacy locations.
- Migration must not delete unrelated files or replace a directory containing unmanaged content.
- Symlink mode applies the same managed-entry safety rules already used by Comet.

After migration, `.agents/skills` is the canonical destination. Comet will not continuously dual-write both locations.

### Platform detection

The shared `.agents/skills` directory alone is not sufficient evidence for automatic Codex platform detection because other agents use the same standard location. Detection should rely on Codex-specific evidence or a Comet-managed Codex Skill entry, while explicit platform selection remains authoritative.

Skill/component checks must use the canonical directory and may fall back to the legacy directory only for compatibility and migration reporting.

### Lifecycle behavior

- `init`: new Codex installs write Skills only to `.agents/skills`; Codex rules stay in `.codex/rules`.
- `update`: existing `.codex/skills` Comet entries are upgraded into `.agents/skills`, then safely cleaned from the legacy location.
- `doctor`: reports the canonical location and identifies a legacy-only install as requiring migration rather than healthy current installation.
- `uninstall`: removes Comet-managed content from canonical and legacy Codex Skill paths without touching unrelated Skills.
- Skill inventory and Bundle authoring: discover current Codex Skills from `.agents/skills`; legacy discovery is retained only where needed to manage an older Comet install.

## Testing

Regression coverage will prove:

- project and global copy installs target `.agents/skills`;
- symlink installs target `.agents/skills` and preserve unrelated entries;
- Codex rules remain under `.codex/rules`;
- current-path installs are detected by doctor/update/uninstall;
- legacy-only installs are migrated during update;
- uninstall cleans managed entries from both paths;
- unrelated legacy and current Skills survive migration and uninstall;
- shared `.agents/skills` content does not by itself cause an unrelated platform to be selected as Codex.

Focused tests will run first, followed by formatting, lint, build, and the full test suite in proportion to the touched surfaces.

## Release Notes and Versioning

The current branch and `origin/master` both use `0.4.0-beta.4`, and the branch already has a `0.4.0-beta.4` changelog section. This user-visible Codex compatibility fix will be appended to that existing release section without changing the package version.
