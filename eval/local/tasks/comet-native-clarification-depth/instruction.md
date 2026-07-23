You are working on a Python project named `wordcount-cli`.

Begin by invoking the `/comet-native` Skill. Initialize Native under `docs/comet/`, create one change named `add-sentence-counting`, and add an opt-in `--sentences` CLI flag that prints `Sentences: N` after any requested `Lines: N` output while preserving the existing word and line counters.

The fixed interface contract is:

- only the ASCII terminal characters `.`, `!`, and `?` can create sentence boundaries;
- non-empty input with no terminal character counts as one sentence;
- when `--sentences` is present, it prints independently of `--lines`; the flag behavior and output order described above are not open product decisions.

The input domain is ordinary ASCII prose. Numbers, URLs, file paths, code, markup, quoted data, and Unicode-specific segmentation are out of scope.

The contract deliberately leaves three areas unresolved: empty or whitespace-only input, consecutive terminal characters, and terminal-looking characters embedded inside ordinary prose tokens. Resolve them in that listed order through the configured clarification protocol. An answer about whether an embedded character creates a boundary may introduce later decisions about how the recognized token collection is maintained and its exact contents; handle each dependent decision immediately after its parent.

The requested interface is intentionally underspecified. Follow the already configured Native Sequential clarification protocol and resolve every undefined user-visible behavior before implementation. Investigate repository-owned facts yourself, and do not change the configured clarification mode.

Complete Shape, Build, Verify, and Archive using only the Comet Native Skill and its bundled runtime.
