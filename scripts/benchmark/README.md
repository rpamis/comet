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

For project knowledge retrieval and read-only Agent planning:

```powershell
node scripts/benchmark/project-knowledge-retrieval-eval.mjs --project=<frozen-project> --cache-root=<isolated-cache> --summary
node scripts/benchmark/project-knowledge-task-ab.mjs --output=<new-experiment-directory> --repetitions=3
```

Retrieval evaluates the fixed 50 queries against the supplied corpus. Use identical frozen source bytes for before/after comparisons. `hitRateAt4` means at least one labelled source was returned; the legacy `recallAt4` field has the same meaning. `sourceRecallAt4` measures the fraction of all labelled sources retrieved, while `sourcePrecisionAt4` divides relevant source count by four even when fewer results were returned. The legacy `precisionAt4` divides by the number actually returned. `passageHitRateAt4` checks content assertions on the six labelled passage cases; finding the right file alone is insufficient. Passage labels do not participate in ranking. The report retains no-answer, archive exclusion, workspace isolation, mutation, and record lifecycle checks. `--enforce` also enforces the existing warm p95 target of 200 ms; a completed measurement can still fail that target.

The planning probe uses the configured Codex host model unless `--model` is supplied. It freezes one source snapshot and alternates runs with and without Comet context, including a phase-specific Personal Memory preference. Each run is read-only, has a six-shell-call budget, and retains its answer, model, source digest, candidate IDs, latency, usage, and violations. Failed, timed-out, and over-budget runs remain in the report and do not count as completed protocol runs. File-path coverage is a planning checklist, not proof of implemented behavior or a successful development task. Compare preference adherence, coverage, tool calls, and latency separately; improvement in one does not imply improvement in the others.

The host adapter uses existing authentication without copying credentials. It ignores user configuration, rules, plugins, hooks, and MCP services for the model subprocess, retaining only validated non-secret model-provider routing arguments in memory. The experiment uses isolated Comet memory and knowledge directories. Reports do not contain host configuration, authentication, raw model event logs, or stderr. Static bearer/header/query credentials and credential-bearing provider URLs are rejected. Review reports and answers before sharing them, since repository source and model output can contain project information.
