---
name: comet
description: "Route /comet requests or an active Comet change to the permanent Comet Native or Comet Classic entry selected by project configuration."
---

# Comet Entry

`/comet` only selects an entry. It does not contain either workflow's execution method.

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
4. Invoke exactly one entry based only on the returned `skill`, passing the user's original request through unchanged:
   - `comet-native` → `/comet-native`
   - `comet-classic` → `/comet-classic`

Do not switch workflows based on task size, file count, active changes, or model judgment. Native and Classic changes, states, and artifacts always remain independent.
