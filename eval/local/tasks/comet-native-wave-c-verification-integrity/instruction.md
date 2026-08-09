You are working on a Python project named `wordcount-cli`.

Begin by invoking `/comet-native`. Initialize Native under `docs/comet/`, create `add-longest-word`, and add a `--longest-word` flag that prints `Longest word: VALUE`. Preserve the existing counters, add focused tests, and write a target specification for `longest-word` with at least two acceptance items.

Exercise the beta17 verification loop:

1. Submit the Builder handoff. Let Runtime run its required checks. Do not treat the Builder's own “passed” summary as verification.
2. Dispatch a read-only Verifier. First submit a response that omits one acceptance item and save the exact Runtime response as `.cache/comet-native-eval/verifier-missing.json`; Native must reject it. Then submit a complete response that reports a failed acceptance and save `.cache/comet-native-eval/verifier-failed.json`. Native must return the candidate to Build.
3. Repair the implementation, dispatch a new Verifier attempt, and submit a complete pass. Save the final `status --details --json` response as `.cache/comet-native-eval/final-status.json`. Archive once; Archive must not rerun the Runtime checks.

The final project must contain only the readable brief/spec/verification Markdown and `comet-state.yaml` in the change/archive. `.comet/config.yaml`, `.comet/current-change.json`, and `.comet/runtime/` are Runtime-owned and allowed. Do not create snapshot, scope, receipt, evidence, checkpoint, preflight, trajectory, or change-local Runtime files. Do not hand-author Runtime JSON envelopes.
