---
name: comet
description: "Use when the user explicitly invokes /comet or asks to use Comet without choosing Native or Classic; activate an unconfigured project from global defaults, then load exactly one permanent entry from project configuration."
---

# Comet Entry

`/comet` only selects an entry. It does not contain either workflow's execution method.

Once this Skill is loaded, treat the `/comet` entry as selected. Immediately perform the entry resolution below; do not re-evaluate whether the task is suitable for Comet, and do not merely explain why it will not be used.

1. Run the Comet CLI installed on PATH in the current project:

   ```text
   comet workflow resolve . --activate --json
   ```

   If project config is missing, this snapshots global defaults and creates project artifact directories. Later global changes do not rewrite it.
2. Parse the JSON. Only accept `schema: comet.workflow-resolution.v1` and a `skill` value listed below.
   If it returns `command not found`, stop and report an incomplete CLI install. If the CLI starts but exits nonzero, returns invalid JSON, or reports invalid config, stop with the original error. Do not search for Skill files, scan platform configuration directories, or invoke an internal bundle directly. Never fall back or guess.
3. Select exactly one entry based only on the returned `skill`. Immediately use the Skill tool to load that entry, and load no other entry:
    - `/comet-native` → **Execute immediately:** Use the Skill tool to load the `comet-native` skill. Do not skip this step.
    - `/comet-classic` → **Execute immediately:** Use the Skill tool to load the `comet-classic` skill. Do not skip this step.

   After the skill is loaded, pass the user's original request unchanged to the loaded entry Skill as its user input.

Do not switch workflows based on task size, file count, active changes, or model judgment. Native and Classic changes, states, and artifacts always remain independent.
