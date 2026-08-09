You are working on a Python project named `wordcount-cli`.

Begin by invoking `/comet-native`. Initialize Native under `docs/comet/`, create one change named `add-unique-counting`, and add a `--unique-words` flag that prints `Unique words: N` while preserving existing word and line behavior. A unique word is a distinct normalized value, not a word that occurs exactly once.

Follow Shape before Build. Do not ask the user to choose repository or implementation details that are already specified here.

Ask exactly one product decision about normalization. When the user answers, record the decision in both `brief.md` and the complete target specification, then use the continuation returned by Runtime to enter Build. End that turn with exactly `COMET_NATIVE_COLD_RESUME_READY` without implementing the feature.

The harness will start a new session with only a continuation request. In that fresh session, invoke `/comet-native` again, run the returned read-only status command before editing anything, and redirect that command's complete JSON envelope once to `.cache/comet-native-eval/resume-status.json`. Do not recreate or overwrite the file. Recover the v4 change from `comet-state.yaml`, its brief, and its specifications; do not rely on chat memory.

Implement focused tests and verify the complete acceptance list. Use the Runtime continuation for Builder handoff, Verifier dispatch, and any requested checks. Archive only after Runtime reports that every acceptance item passed. Execute the Archive command returned by Runtime and leave the portable archive in `docs/comet/archive`.

Do not create OpenSpec, Classic, or any change-local `runtime/`, receipt, evidence, trajectory, snapshot, or hash files. The required status envelope belongs only under `.cache/comet-native-eval/`. `.comet/runtime` and `.comet/current-change.json` are Runtime-owned and may be created by the Runtime. Do not fabricate or hand-author Runtime JSON.
