# Workflow scale measurements

Measured on Windows with Node v22.20.0, using one warmup and three samples per case. Both builds used the same benchmark script, inputs, and machine, with the daemon disabled and no concurrent build or test run. The baseline was compiled from Git commit 44766251a539e67363cac6647733719f6b03f180 in an isolated directory. The candidate was measured before committing this change; exact executed module hashes and source status are recorded in the reports.

| Operation                                       | Before median | Candidate median | Reduction | Git calls |
| ----------------------------------------------- | ------------- | ---------------- | --------- | --------- |
| Native full snapshot, 10,000 files              | 11.696 s      | 6.057 s          | 48.2%     | 9 → 9     |
| Native clean incremental snapshot, 10,000 files | 2.652 s       | 2.592 s          | 2.3%      | 10 → 10   |
| Native dirty incremental snapshot, 10,000 files | 11.635 s      | 6.143 s          | 47.2%     | 9 → 9     |
| Classic dirty check inputs, 10,000 files        | 5.778 s       | 2.864 s          | 50.4%     | 43 → 6    |
| Native dirty check inputs, 10,000 files         | 4.596 s       | 4.628 s          | -0.7%     | 7 → 7     |
| Native candidate comparison, 300 comment edits  | 25.017 s      | 1.874 s          | 92.5%     | 305 → 15  |

The clean incremental snapshot and Native dirty input fingerprint are effectively unchanged. These timings cover snapshot and comparison operations, not model execution or end-to-end task completion. All measured Native content snapshots were complete with no omissions. Each source file was approximately 1 KB.

Raw evidence: [baseline](workflow-scale-before.json), [candidate](workflow-scale-after.json). Reports retain every sample, observed p95, executable hashes, and the shared benchmark SHA-256. The candidate comparison also checks that a functional edit changes the candidate.

Reproduce with a built checkout using the same script and --package-root for each build:

```powershell
pnpm benchmark:workflow-scale --file-counts=10000 --dirty-counts=300 --acceptance-counts=none --history-counts=none --runs=3 --warmups=1 --output=C:/Temp/comet-scale.json
```

See [benchmark usage](README.md) for acceptance, SDK history, cold CLI, checked SDK Build/Verify, and worktree scenarios. Those dimensions require their own results; this table does not establish their speed or real host Hook/model behavior.

The raw samples above predate the benchmark's aggregate snapshot-health check. Their Native snapshots are all complete, and the five recorded Runtime module hashes still match the candidate after the CLI handoff fixes. The current benchmark additionally exits nonzero for incomplete snapshots and saves limits and omission samples. A fixture above 10,000 files needs an explicit `--snapshot-max-files` budget; increasing the budget never silently changes a real project's configuration.
