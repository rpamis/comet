Use the installed current Comet CLI and Classic SDK workflow to extend wordcount-cli. Use the configured docs layout, current workspace isolation and local Git delivery only. Initialize Git if needed and commit the supplied source/tests as the baseline. Do not create remotes, push, open PRs, edit managed state/checkpoints or fabricate Run records.

Never commit Python caches, including in the baseline. For temporary requests or declared generated outputs, remove only the precisely named files with Python `unlink`, followed by `rmdir` only for an empty directory, or use `tempfile.TemporaryDirectory()`. Do not use `rm -rf`, `git reset --hard`, or download scripts into a shell, including for cache cleanup.

Before starting the work, create an SDK tweak change named `parked-format` and leave it at Open. Then execute this exact shell command to write its proposal.md. The command writes two UTF-8 lines with one final newline; only its output belongs in the proposal file:

<!-- parked-proposal-command -->

```bash
printf '%s\n' '# Parked format' 'Keep this unrelated formatting request pending.' > docs/openspec/changes/parked-format/proposal.md
```

Do not implement, archive, commit or advance that change. It must coexist with the following three changes, which you must complete in order using their specified profiles:

1. `sentence-full`, full: add --sentences. Split on runs of '.', '!' and '?', count nonempty trimmed segments (including an unpunctuated trailing segment), and print `Sentences: N`. Empty or punctuation-only input gives zero. Preserve existing word and line behavior.
2. `characters-tweak`, tweak: add --characters, printing `Characters: N` with the Python string length, including whitespace and newlines. Preserve existing features.
3. `missing-file-hotfix`, hotfix: handle an unreadable/missing input file without a Python traceback; print `Error: cannot read input file` to stderr and exit 2. Preserve successful file and stdin behavior.

For each change, author the required artifacts and regression tests, perform the profile's actual Build and Verify checks, archive it and finish its approved local Git delivery. A moved directory is not a finished delivery. Use the public CLI guidance to complete the SDK Run and verify the delivery receipt. Select changes explicitly when switching; retain every other change's state and artifacts. Local commits are authorized for this task, limited to verified implementation and that change's delivery artifacts. You may choose direct implementation and disable optional reviews for this small exercise; record any required decisions through the normal CLI.

On the same `sentence-full` Run, also exercise post-Archive output repair once. After implementation and before its Runtime Build and Verify checks, run `/usr/bin/python3 -I verify_coexistence.py` to create the actual Python cache with the same interpreter and command as Verify. Explicitly include one actual `__pycache__/*.pyc` file, the implementation, tests and provided coexistence helper in the check policy's `files` declarations for both checks, even if the cache is ignored by Git. Do not declare that cache as an output yet. After Archive has actually completed, switch that command's policy to full inputs: keep its original `argv` and `cwd`, declare `outputs: ["__pycache__/**"]`, and remove the old `files` and `env` declarations. Remove only the named generated files. Follow `repair-delivery` and submit the exact returned `data.continuation.request` to re-execute the original Verify command. Show the newly formed output-only delivery scope, end the response and wait for a separate actual user reply before approving it. Complete delivery on the same Run, execute Archive exactly once, keep all three successful checks non-reusable, and never commit cache files. Do not alter the implementation or the supplied helper to manufacture this recovery. Read complete JSON from stdout and keep stderr separate.

The supplied `verify_coexistence.py` runs pytest and observes the parked proposal before and after that execution. Include this unchanged helper in the initial baseline. If you declare a limited set of check inputs, use `/usr/bin/python3 -I verify_coexistence.py` at the project root for that profile's Runtime Verify check and include this helper along with the source and tests. Use the container's fixed system interpreter; do not resolve it through PATH. A full input manifest that binds the exact parked proposal remains valid evidence of coexistence. The parked proposal itself remains outside the delivery scope. Do not replace the helper with a printed observation or an Agent-authored receipt.

Finish with all three Runs completed and the parked change still at Open and untracked. Run the supplied tests and your new tests, and report the three local delivery commits. Do not replace the installed current CLI with a published version or an older compatibility runtime.
