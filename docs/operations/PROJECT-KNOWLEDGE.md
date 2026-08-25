# Project Knowledge and Project Policy

Project Knowledge is the current project's traceable engineering-knowledge layer. It helps the Agent understand “what the project is” and “how to work here next”, but it never overrides the current user request, system constraints, current source, configuration, or tests. Users manage the capability through one Project Knowledge workspace.

## Two kinds of project memory

- **Project Model**: `topology`, `fact`, and `dependency` records describing directories, modules, dependencies, and verifiable project facts.
- **Project Policy**: `decision`, `pattern`, `procedure`, `constraint`, and `failure-resolution` records describing accepted decisions, stable practices, operational procedures, constraints, and resolved failures.

Records use one lifecycle:

- `trial`: a single credible inference available for low-priority retrieval;
- `proven`: a stable explicit project convention, current deterministic fact, or successfully reused record;
- `enforced`: only a Project Policy bound to a deterministic verification command that still exists and has passed;
- `superseded`: no longer injected because its source became stale, its command disappeared, it was corrected, or a higher-priority decision replaced it.

Project Policy is not a second Rule-file system. Existing repository AGENTS files, Rules, source, configuration, tests, and checks remain higher-priority evidence. Comet builds a retrievable model and activations without silently rewriting those files.

## Automatic learning checkpoints

The Project Model Builder consumes repository changes, structured verification, and Change archives, then combines manifests, configuration, directory structure, bounded source relationships, and custom Markdown corpora to update the model.

The Project Policy Learner uses closed-loop events:

- an accepted and resolved Review finding forms a decision or constraint;
- a failure with a known cause, fix, and successful re-verification forms a failure resolution;
- completed verification links real successful commands and calibrates related policies;
- an archived Change contributes final decisions, stable patterns, procedures, and superseded conclusions;
- context outcomes strengthen, rewrite, or supersede trial policies.

The Experience Journal persists events on a fast path. Reflection later processes bounded batches by episode, changed paths, and evidence. If the semantic reviewer is unavailable, deterministic Project Model and verification links continue while semantic Policy work is replayed later, without blocking Classic or Native workflows.

## Local document paths and providers

The Local Provider stores authoritative records in a SQLite database isolated by stable repository ID under the user data directory. The main workspace and linked worktrees share records, while document sections and FTS are workspace-specific rebuildable views. Local indexes Comet-managed Native/Classic documents, archives, deterministic project structure, and Markdown globs configured through `knowledge.local.include`:

```yaml
knowledge:
  provider: local
  local:
    include:
      - docs/**/*.md
      - packages/*/README.md
      - architecture/**/decisions-*.md
```

Patterns are relative to the project root and multiple globs are supported. Sources are checked again before injection. When a file changes, disappears, or no longer matches its selector, the old record becomes `superseded` and new evidence creates a new version.

Teams can instead configure a mutually exclusive Remote Provider:

```yaml
knowledge:
  provider: remote
  remote:
    endpoint: https://knowledge.example.com/provider
    token_env: COMET_KNOWLEDGE_TOKEN
    scope: team-project
    timeout_ms: 5000
```

Remote receives only bounded task/path/phase/operation values and normalized records and evidence. It does not receive the complete repository, complete diffs, logs, Personal Memory, or credentials. A Remote failure never silently falls back to Local.

## How the Agent uses it

At task start, the Context Director filters by project, path, operation, phase, kind, and state, then ranks with FTS, bounded ripgrep, relationships, source freshness, and real application feedback. A small number of key `proven/enforced` Project Policies may be injected in full. Project Model records, trial policies, long procedures, and evidence enter the Context Manifest by default.

Each Manifest item contains a stable ID, title, summary, source type, and actual `whyApplied`. The Agent expands an ID only when it needs full content, sources, or verification:

```text
comet task . --task "change the authentication module" --path src/auth --operation edit --phase build --session <id> --json
comet task . --task "change the authentication module" --session <same-id> --expand-context <id> --json
```

Actual application outcomes feed back into ranking and lifecycle. Context budgets limit only resident full text in one injection; they do not limit provider records, indexed documents, or Reflection input.

## Dashboard and CLI

The Project Knowledge workspace directly provides Project Model and Project Policy views without repeating the same large title shown in the sidebar. Models are browsed by topology/fact/dependency and policies by decision/pattern/procedure/constraint/failure-resolution. Lists and details show lifecycle, scope, sources, verification, `whyApplied`, recent outcomes, update time, and full application history, with a preview of the current Context Manifest.

Users can manually add project knowledge or policies in the Dashboard, correct or supersede them, expand sources, and refresh. The page renders a cached snapshot first; background learning and indexing never block first paint.

The CLI uses the same authoritative state:

```text
comet knowledge status .
comet knowledge query . --task "change the authentication module" --path src/auth --phase build --operation edit
comet knowledge list . --state proven
comet knowledge get . --id <record-id>
comet knowledge correct . --id <record-id> --text <new-description>
comet knowledge forget . --id <record-id>
comet knowledge feedback . --id <record-id> --outcome used-successfully
comet knowledge rebuild .
```

If a query or background learner fails, the current task continues without injecting failed content. A failed correction or supersession preserves the prior state. When the plugin is disabled or uninstalled, it does not learn, query, run policy verification, open SQLite, or send network requests.
