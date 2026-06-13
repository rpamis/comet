# Pi Slash Command Extension Design

## Goal

Make Comet slash commands discoverable and directly usable in Pi after `comet init`, while keeping `comet update` and `comet uninstall` consistent with the installed platform assets.

## Root Cause

Pi does not convert a skill's `triggers` frontmatter into native slash commands. It only discovers custom slash commands registered by an extension, while skill invocation uses `/skill:<name>` and requires `enableSkillCommands`.

Comet currently copies skills into `.pi/skills/` but does not install a Pi extension or enable skill commands. As a result, `/comet`, `/comet-open`, and the other Comet commands do not appear in Pi's slash-command completion.

## Architecture

Pi-specific command installation will follow the existing OpenCode platform-asset pattern in `src/core/skills.ts`.

When Comet skills are copied for Pi:

1. Read the top-level `*/SKILL.md` entries from `assets/manifest.json`.
2. Derive command names from those entries so the extension cannot drift from the shipped skills.
3. Generate `.pi/extensions/comet-commands.ts`.
4. Merge `.pi/settings.json` with `enableSkillCommands: true`, preserving all unrelated user settings.

The generated extension registers each Comet command through `pi.registerCommand()`. Its handler forwards the command and optional arguments to the corresponding `/skill:<name>` invocation through `pi.sendUserMessage()`.

Because `comet update` already calls the same skill-copy function with overwrite enabled, it will regenerate the extension and reapply the settings merge automatically.

## Scope Behavior

Project scope writes:

- `.pi/extensions/comet-commands.ts`
- `.pi/settings.json`

Global scope writes the same relative paths beneath the user's home directory:

- `~/.pi/agent/extensions/comet-commands.ts`
- `~/.pi/agent/settings.json`

Pi's global skills also belong under `~/.pi/agent/skills/`, so the Pi platform definition will
use `.pi/agent` as its global resource root while keeping `.pi` for project scope.
Update and uninstall detection will also recognize the legacy `~/.pi/skills/` location used by
earlier Comet versions, allowing update to migrate the active installation and uninstall to clean
up Comet-owned legacy skill files.

## Ownership And Preservation

The extension file is entirely Comet-managed and may be overwritten during init with `--overwrite` or during update.

`settings.json` is user-owned shared configuration. Installation will parse the existing JSON object, set only `enableSkillCommands` to `true`, and preserve every other key.

If existing `settings.json` is invalid JSON, installation will report the Pi command asset as failed instead of silently replacing user configuration.

Uninstall will:

- Remove only `.pi/extensions/comet-commands.ts`.
- Preserve `.pi/settings.json`, including `enableSkillCommands`, because Comet cannot know whether another user-installed skill depends on that shared setting.
- Remove the extensions directory only when it becomes empty.

## Generated Extension Contract

The extension will:

- Import `ExtensionAPI` as a type from `@earendil-works/pi-coding-agent`, Pi's published package.
- Export a default registration function.
- Register every top-level Comet skill found in the manifest.
- Use the command name without the leading slash.
- Forward empty arguments as `/skill:<name>`.
- Forward non-empty arguments as `/skill:<name> <args>`.
- Include stable descriptions suitable for Pi command completion.

## Error Handling

Skill files continue to use the existing copy error handling.

Pi command asset generation is part of the platform copy result:

- Successful extension/settings writes increase the copied count.
- Existing assets skipped without overwrite increase the skipped count where appropriate.
- Invalid shared settings produce an explicit error and do not destroy the file.

The extension is written only after settings can be parsed, avoiding a partially configured state where native commands exist but their forwarded skill commands are disabled.

## Tests

Focused tests will verify:

- Project-scope Pi init creates the extension and enables skill commands.
- Global-scope Pi init writes beneath the mocked home directory.
- The generated command set matches top-level Comet skills in the manifest.
- Handlers preserve and forward arguments correctly.
- Existing Pi settings are preserved while `enableSkillCommands` becomes `true`.
- Repeated overwrite/update behavior is deterministic.
- Invalid Pi settings are not replaced.
- Uninstall removes the managed extension while preserving settings and unrelated extension files.

The existing init E2E test that installs all platforms will also assert the Pi extension exists. Final verification will run focused init/uninstall tests, the repository's full Vitest suite, build, and lint.

## Version And Changelog

`master` is version `0.3.7`, while the current branch already contains version `0.3.8` and a `0.3.8` changelog entry. This fix will remain in `0.3.8` and append `Fixed` and `Tests` entries to that existing release section.
