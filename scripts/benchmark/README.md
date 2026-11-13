# Runtime benchmarks

Build first with `pnpm build`. Benchmarks create temporary projects with an isolated HOME and `COMET_DATA_DIR`, overriding inherited user Runtime paths. They disable the daemon, use real workflow commands or SDK operations, and remove only their own temporary fixtures. Reports contain timings and build metadata, not credentials or original Hook requests.

For cold CLI commands and current platform task handoffs:

```powershell
node scripts/benchmark/runtime-coldstart-benchmark.mjs --runs=15 --targets=cli-version,native-sdk-status-public,classic-sdk-next-public,native-next-public,native-next-current-session --output=C:/Temp/comet-coldstart.json
```

Native and Classic scenarios create current SDK Runs. `native-next-public` measures the first Shape task claim; `native-next-current-session` measures observing the original task again from the same session. Postconditions verify that the Action, claim and Run remain unchanged on the repeated observation. Retired command execution, check reuse and interruption recovery scenarios are no longer included. These task handoffs do not perform checks or approve Shape, and cannot be compared directly with the former automatic Shape preparation measurements.

The cold-start benchmark uses three warmups and fresh Node processes with a warm filesystem. Fixture setup, restoration, and persisted postconditions are excluded from timing. Selectors initialize only the required fixture groups. Check restoration covers both project files and the workspace's actual user-level Runtime records. Reports include Git/FS instrumentation from a separate successful process; that instrumented process is not one of the timing samples.

For acceptance and SDK history scales:

```powershell
pnpm benchmark:workflow-scale --runs=3 --warmups=1 --acceptance-counts=10,100 --history-counts=10,100 --output=C:/Temp/comet-scale.json
```

Use `none` to disable a dimension. Shape measurements submit a platform task report through the public CLI and verify that every acceptance item reaches the real approval Wait. They do not approve it. SDK history measurements execute deterministic fixture Actions and compare full Run responses, current views, and persisted reads. Reports retain response bytes, timing samples and Git process counts. Fixture setup and restoration are excluded from timing.

File snapshots, dirty-input fingerprints and candidate content comparisons have been removed with the ordinary managed check runner. Their former options are rejected. SDK history measures shared storage rather than a full Supervisor workflow. Real platform Hooks, external services, model execution and end-to-end Agent latency require separate acceptance. Compare identical dimensions, sample counts, hardware and benchmark hashes; another built package can be selected with `--package-root=<path>` and `--source-head=<sha>`.

For project knowledge retrieval and read-only Agent planning:

```powershell
node scripts/benchmark/project-knowledge-retrieval-eval.mjs --project=<frozen-project> --cache-root=<isolated-cache> --summary
node scripts/benchmark/project-knowledge-task-ab.mjs --output=<new-experiment-directory> --repetitions=3
```

Retrieval evaluates the fixed 50 queries against the supplied corpus. Use identical frozen source bytes for before/after comparisons. `hitRateAt4` means at least one labelled source was returned; the legacy `recallAt4` field has the same meaning. `sourceRecallAt4` measures the fraction of all labelled sources retrieved, while `sourcePrecisionAt4` divides relevant source count by four even when fewer results were returned. The legacy `precisionAt4` divides by the number actually returned. `passageHitRateAt4` checks content assertions on the six labelled passage cases; finding the right file alone is insufficient. Passage labels do not participate in ranking. The report retains no-answer, archive exclusion, workspace isolation, mutation, and record lifecycle checks. `--enforce` also enforces the existing warm p95 target of 200 ms; a completed measurement can still fail that target.

The planning probe uses the configured Codex host model unless `--model` is supplied. It freezes one source snapshot and alternates runs with and without Comet context, including a phase-specific Personal Memory preference. Each run is read-only, has a six-shell-call budget, and retains its answer, model, source digest, candidate IDs, latency, usage, and violations. Failed, timed-out, and over-budget runs remain in the report and do not count as completed protocol runs. File-path coverage is a planning checklist, not proof of implemented behavior or a successful development task. Compare preference adherence, coverage, tool calls, and latency separately; improvement in one does not imply improvement in the others.

The host adapter uses existing authentication without copying credentials. It ignores user configuration, rules, plugins, hooks, and MCP services for the model subprocess, retaining only validated non-secret model-provider routing arguments in memory. The experiment uses isolated Comet memory and knowledge directories. Reports do not contain host configuration, authentication, raw model event logs, or stderr. Static bearer/header/query credentials and credential-bearing provider URLs are rejected. Review reports and answers before sharing them, since repository source and model output can contain project information.
