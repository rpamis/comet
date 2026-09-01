You are working on a Python project named `wordcount-cli`.

Begin by invoking `/comet-native`. Initialize Native under `docs/comet/`, create a change named `stalled-average`, and author a brief plus complete target specification for `average-word-length` and an `--average-word-length` flag. Move the change to Verify without modifying `wordcount.py` or `test_wordcount.py`; the missing flag is the intentional acceptance failure.

Exercise Native's bounded repair Loop while keeping the implementation, brief, and specification unchanged:

1. Run the same failing acceptance command three times. Let Runtime record each failure in portable `comet-state.yaml`. Save the third failed `next` command's exact JSON envelope as `.cache/comet-native-eval/manual-stop.json`. The state must expose a user-readable blocker and a no-progress or failed-iteration counter of at least three.
2. Follow the continuation returned by Runtime and use one explicit repair continuation with a concrete new hypothesis. Save that exact successful command envelope as `.cache/comet-native-eval/override.json`. Do not use a second override.
3. Continue real failing verification attempts until the Runtime's bounded ceiling is reached. Save the ceiling command envelope as `.cache/comet-native-eval/hard-stop.json`, then save the exact read-only status envelope as `.cache/comet-native-eval/hard-stop-status.json`. The final v4 state must remain active, blocked or await-user, retain its counters and blocker, and expose a continuation action.

For every saved stop/status envelope, preserve the complete JSON returned by the CLI. It must include a plain-language `summary`, exactly one `next.command` or `next.ask_user`, and (when `userCommunication.required` is true) a matching `user_message` that can be relayed without exposing loop counters or other machine fields.

Do not archive, claim a pass, suppress a command error, weaken tests, or implement the missing feature. Do not fabricate, combine, paraphrase, or hand-author the four required command envelopes. Keep all machine state under `.comet/runtime`; do not create change-local `runtime/`, trajectory, checkpoint, receipt, evidence, snapshot, or hash files. Use only the Comet Native Skill and bundled Runtime.
