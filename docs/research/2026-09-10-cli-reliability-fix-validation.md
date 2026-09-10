# CLI reliability and runtime validation

This report records implementation evidence for Native change `repair-cli-reliability-and-runtime`. It does not measure model productivity or establish the reported one-third correction overhead.

## Baselines

- Implementation base: `1617fa06da8a9bfbf5dd424316a1ba35072a289a`, branch `0.4.1`.
- Release comparison checked against fetched `origin/master`: package version `0.4.0`, latest release tag `0.4.0`. Changes belong in the existing `0.4.1` Changelog.
- Workflow controller: installed public Comet `0.4.0`. Product validation targets working-tree source and rebuilt `0.4.1` assets; these are separate evidence layers.
- No website content or submodule pointer changes are part of this change.

## Validation in progress

The checks below are development evidence. Final checks and independent acceptance are recorded by Native Runtime in the change's verification artifacts; this report does not predeclare their result. The complete reproducible timing comparison is in `2026-09-10-runtime-latency-repair-validation.md`.

| Check                                                           | Observed result                               |
| --------------------------------------------------------------- | --------------------------------------------- |
| Native lifecycle, loop and reliability regressions              | 3 files, 57 tests passed                      |
| Native input diagnostics, UTF-8 BOM and Builder return template | 3 tests passed                                |
| Supervisor and shared output regressions                        | 2 files, 34 tests passed                      |
| Native Skill, input contract and shared output                  | 3 files, 29 tests passed                      |
| Native user options and public workflow                         | 2 files, 27 tests passed                      |
| Native JSON, direct entry and human output                      | 3 files, 29 tests passed                      |
| Native public templates and linked worktree CLI                 | 2 files, 55 tests passed                      |
| TypeScript source checking                                      | Passed                                        |
| Unified build, including all three runtimes and Dashboard       | Passed; Vite retained its large-chunk warning |
| Prepublish secret scan                                          | Passed                                        |

## Workspace-specific check boundary

The original workspace's architecture linter reports `.codex-remote-attachments` as an unsupported top-level directory. It predates this task (2026-09-04) and is excluded by `.git/info/exclude`; it was not removed or added to the product allowlist. A temporary snapshot of the current Git-deliverable files passed the same architecture script. This does not claim that `pnpm lint` passed in the original workspace.

The first complete source lint identified three issues in changed Classic code. They were corrected and the complete source ESLint passed; the remaining original-workspace failure is the host-directory architecture issue above.

## Additional development evidence

- A real packed Comet 0.4.1 package installed and validated routing across 37 Native platform targets. This verifies installed files and configuration, not execution inside every real host. Final package validation must include the later selected-worktree and Classic identity-scope fixes.
- The independent read-only review passed after correcting Supervisor observation cwd and Classic telemetry error classification. A further review passed for the Classic record-stage identity scope; 28 related tests passed, then formatting and TypeScript compilation passed.
- The public Classic CLI completed 15 real commands successfully, including nested-directory recovery, repeated Design completion, OpenSpec returned actions and Windows literal arguments.
- Eval logging, telemetry and isolated shell fixtures passed 85 tests; the later Classic error-classification regression set passed 40 tests, followed by the additional redaction case. These sets overlap and must not be summed.
- Final full Vitest, generated-asset consistency and post-fix package results remain the responsibility of the Runtime check receipt and independent Verifier.

## First formal verification and repair

Native Runtime completed 17 checks for the first candidate. Full Vitest reported 4,844 passed, 19 failed and 57 skipped across 387 files; changed-file formatting also failed. The other 15 checks passed, including 88 Eval tests, all generated-runtime checks, full build, source ESLint, deliverable architecture and the actual package's 37 platform targets. Independent verification marked A11/A20 failed and A19/A21 blocked; it did not accept the candidate.

The repair preserves Classic `set --json`'s existing `data.updated` while adding current recovery information. Archive fixtures and the Classic benchmark now invoke their existing Node entry directly rather than an unsupported shell command. Skill assertions follow the approved adapter command, and bilingual Design guidance again enumerates every handoff source that invalidates evidence. Native Markdown formatting required making one table-content test insensitive to padding, without changing its choices or effects.

The website-related failure was present in the implementation baseline: both it and this checkout reference submodule `82ad22bed5607651ed236abfc4261bb2cc905456`, which serves CSS as `{ "css": "..." }` in `.css.json`; the test still opened `.css`. Only the test reader now validates and reads that actual JSON asset. All CSS scoping assertions remain, and no website content or gitlink changed.

Targeted Archive, benchmark, Skill, website and compatibility regressions completed after repair. All changed-file formatting passed. These repairs justify a fresh final full run; its result is recorded by Runtime rather than assumed here.

## Build access failure during revalidation

The second formal build failed while writing `comet-native-spec.mjs` with Windows `UNKNOWN(-4094)`. Its initial clean had removed `dist`; subsequent public CLI, package and benchmark checks therefore lacked their prerequisite. The affected full Vitest run was stopped and is incomplete, not a second completed suite. Source lint, changed formatting, generated consistency and Eval checks passed. The access failure's cause was not established.

After those checks ended, a standalone complete `node build.js` succeeded and the real public CLI returned version `0.4.1`. Product source did not change during this recovery. The next check plan uses that successful build, runs source type checking and all generated consistency checks, and explicitly verifies built entry files and the real CLI version before launching full Vitest. It retains the package and successful-runtime benchmark checks. Earlier failures remain recorded; neither a missing build nor a failed fixture is counted as a performance sample.

## Final full run and isolated budget-test repair

The third formal receipt (`9bfb6b53-8840-4d94-a275-e53d882f3fe9`) completed all 18 checks. Seventeen passed, including 88 Eval tests, generated consistency, package installation across 37 platform targets and all 15 successful benchmark targets. Full Vitest completed with 4,862 passed, one failed and 57 skipped. Its sole failure counted formatter-added blank lines against the Native Skill's physical-line limit (440 versus 425); this run is not reported as entirely passing.

The final repair changes only that test to count nonempty content lines: a main-file limit of 100 and a total limit of 303 retain the baseline's 302 content lines plus one. Heading and bilingual structure assertions remain. This is a content-line budget, not a token or semantic-size measurement. All 18 tests in the affected file passed. A saved hash inventory confirms that the other 1,507 source, asset and test files are unchanged since the completed full run. The independent verification combines that full-run evidence with targeted tests and hash verification rather than repeating the full suite after a test-only metric correction.

The final formal benchmark measured Native status at 600.8 ms for 30 changes versus 8,248.1 ms before (2 versus 92 Git calls), task without origin at 548.6 ms versus 1,418.1 ms, and activation at 174.2 ms versus 276.0 ms. Classic current/next measured 760.2/713.7 ms versus 245.9/168.1 ms: the repaired path restores required plugin behavior omitted by the old shortcut, so this comparison is not behaviorally equivalent and is not a speedup claim.

## Remaining evidence limits

- No paid model Eval or real user trace replay was started as part of the planned validation.
- Tool receipt timing, Agent invocation timing, process wall time and actual Runtime duration are distinct measurements. Unknown source timing remains unknown.
- Early Eval shell fixture attempts used an insufficiently isolated PATH and timed out. Later process inspection cannot establish whether those earlier attempts launched an installed Agent CLI or used the network. Subsequent fixtures isolate PATH and assert the exact fake executable before running.
- The original performance audit did not isolate every Windows cache root. The new benchmark isolates all supported user data/cache roots and checks successful command postconditions; the earlier numbers remain diagnostic evidence, not the final comparison.
