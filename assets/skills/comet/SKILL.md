---
name: comet
description: "Use when the user explicitly invokes /comet or asks to use Comet without choosing Native or Classic; load exactly one permanent entry from project configuration."
---

# Comet Entry

`/comet` only selects an entry. It does not contain either workflow's execution method.

Once the host loads this Skill, treat the `/comet` entry as selected. Immediately perform the entry resolution below; do not re-evaluate whether the task is suitable for Comet or only explain why Comet will not be used.

1. First try the Comet CLI installed on PATH in the current project:

   ```text
   comet workflow resolve . --json
   ```

2. **Only** when the host explicitly reports `command not found`, `executable not found`, or `ENOENT`, proving that `comet` is absent from PATH, locate `<comet-skill-root>` from this `SKILL.md` and run the bundled entry runtime:

   ```text
   node <comet-skill-root>/scripts/comet-entry-runtime.mjs . --json
   ```

   If the CLI starts but exits nonzero, configuration parsing fails, output is not JSON, or a required field is invalid, do not retry through the bundled runtime. Stop and report the original error without falling back or guessing.
3. Parse the JSON. Only accept `schema: comet.workflow-resolution.v1` and a `skill` value listed below.
4. Select exactly one entry based only on the returned `skill`. Immediately use the Skill tool to load that entry, and load no other entry:
    - `/comet-native` → **Execute immediately:** Use the Skill tool to load the `comet-native` skill. Do not skip this step.
    - `/comet-classic` → **Execute immediately:** Use the Skill tool to load the `comet-classic` skill. Do not skip this step.

   After the skill is loaded, pass the user's original request unchanged to the loaded entry Skill as its user input.

Do not switch workflows based on task size, file count, active changes, or model judgment. Native and Classic changes, states, and artifacts always remain independent.
