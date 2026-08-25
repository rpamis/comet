---
name: comet
description: "Comet workflow entry. Use when the user invokes /comet or asks to use Comet without choosing Native or Classic; resolve and load exactly one entry from project configuration."
---

# Comet Entry

Once this Skill is loaded, treat the `/comet` entry as selected; do not re-evaluate whether the task is suitable for Comet. Immediately perform the entry resolution below.

1. Run the Comet CLI installed on PATH:

   ```text
   comet workflow resolve . --activate --json
   ```

   Missing project config is initialized from global defaults.
2. Parse the JSON. Only accept `schema: comet.workflow-resolution.v1` and a `skill` value listed below.
   On `command not found`, stop and report an incomplete CLI install. If the CLI starts but exits nonzero or returns invalid JSON/config, stop with the original error. Do not search for Skill files, scan platform configuration directories, or invoke an internal bundle directly. Never fall back or guess.
3. Select exactly one entry based only on the returned `skill`. Immediately use the Skill tool to load that entry, and load no other entry:
    - `/comet-native` → **Execute immediately:** Use the Skill tool to load the `comet-native` skill. Do not skip this step.
    - `/comet-classic` → **Execute immediately:** Use the Skill tool to load the `comet-classic` skill. Do not skip this step.

   After the skill is loaded, pass the user's original request unchanged to the loaded entry Skill.

The returned Skill binds the workspace and loads task context, personal memory, and project knowledge; use `comet memory context` when needed.

The selected Skill uses a Context Manifest, `--expand-context "<id>"` for details, and `--application "<id>" --outcome <status>` to report actual use.

Do not switch workflows based on task size, file count, active changes, or model judgment. Native and Classic changes, states, and artifacts always remain independent.
