Use the installed current Comet CLI and Classic SDK workflow to extend wordcount-cli. Use the configured docs layout, current workspace isolation and local Git delivery only. Initialize Git if needed and commit the supplied source/tests as the baseline. Do not create remotes, push, open PRs, edit managed state/checkpoints or fabricate Run records.

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

Finish with all three Runs completed and the parked change still at Open and untracked. Run the supplied tests and your new tests, and report the three local delivery commits. Do not replace the installed current CLI with a published version or an older compatibility runtime.
