# Runtime benchmarks

Build first with `pnpm build`. Benchmarks create temporary projects with an isolated HOME and `COMET_DATA_DIR`, overriding inherited user Runtime paths. They disable the daemon, use real workflow commands or SDK operations, and remove only their own temporary fixtures. Reports contain timings and build metadata, not credentials or original Hook requests.

For cold CLI commands and checked workflow transitions:

```powershell
node scripts/benchmark/runtime-coldstart-benchmark.mjs --runs=15 --targets=cli-version,native-sdk-status-public,classic-sdk-next-public,classic-sdk-build-verify-reuse --output=C:/Temp/comet-coldstart.json
```

SDK targets are explicitly named and report runtimeFormat sdk. Existing Native and Classic scenarios use explicit Compat fixtures and report compat. `classic-sdk-build-verify-reuse` executes Build and Verify through the real SDK Guard, validates that the second check returns reused, and independently counts one actual command execution. It is a two-stage flow, not a single-command cold-start comparison.

The cold-start benchmark uses three warmups and fresh Node processes with a warm filesystem. Fixture setup, restoration, and persisted postconditions are excluded from timing. Selectors initialize only the required fixture groups. Check restoration covers both project files and the workspace's actual user-level Runtime records. Reports include Git/FS instrumentation from a separate successful process; that instrumented process is not one of the timing samples.

For file, edit, acceptance, and SDK history scales:

```powershell
pnpm benchmark:workflow-scale --runs=3 --warmups=1 --file-counts=100,1000,10000 --dirty-counts=0,10,100,300 --acceptance-counts=10,100 --history-counts=10,100 --output=C:/Temp/comet-scale.json
```

Use `none` to disable a dimension, for example `--acceptance-counts=none --history-counts=none`. The scale benchmark measures:

- Native full, clean incremental, and dirty incremental snapshots;
- Classic and Native dirty check-input fingerprints;
- comment-only candidate comparisons, with Git call counts and an assertion that a functional edit changes the candidate;
- Native SDK Shape preparation with real approval Waits, restoring project and user Runtime state before every sample;
- completed Action histories created by actual SDK executor calls, followed by persisted Run reads.

API measurements run in one process with a warm filesystem; Shape measurements use fresh CLI processes. SDK history measures shared SDK storage, not a full Native Supervisor or Classic workflow. Worktree cardinality remains covered by the cold-start benchmark's `--worktrees=1,10,30`. Real host Hooks, external services, model execution, and end-to-end agent latency require separate acceptance.

Reports retain every sample, observed p95, runtime format, and snapshot completeness/omissions. `complete` records that measurement finished; `snapshotHealth.complete` separately validates every Native snapshot sample. The CLI saves diagnostic reports and exits nonzero when snapshot evidence is incomplete, retaining the limits and a sample of omissions. The benchmark defaults to the Runtime's 10,000-file budget; to measure larger fixtures, explicitly pass `--snapshot-max-files=20000` or another suitable budget. This affects only the temporary benchmark fixture. Actual projects configure `native.snapshot` scope and budgets. Incomplete samples are not acceptance evidence. Compare identical dimensions, sample counts, hardware, and benchmark hashes. To compare another built package, pass `--package-root=<path>` and `--source-head=<sha>` to the same script. Keep reports outside the product source tree unless intentionally publishing reviewed evidence.
