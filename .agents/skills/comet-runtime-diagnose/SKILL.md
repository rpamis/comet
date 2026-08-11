---
name: comet-runtime-diagnose
description: Diagnose Comet Hook, install, routing, platform, generated-runtime, or lifecycle behavior by separating stale configuration from source defects and executing the real packaged Runtime path. Use when a Hook or install report may be a configuration issue, generated asset drift, unsupported platform, or cross-project attribution bug.
---

# Comet Runtime Diagnosis

Load `../comet-github/references/maintainer-contract.md` first. Diagnose before changing source or reinstalling anything.

## Identify the boundary

Classify the report as one or more of:

- stale or incomplete local installation;
- project/global configuration or path attribution;
- source/runtime logic defect;
- generated asset drift;
- platform registry, install, or uninstall mismatch;
- documentation or lifecycle-contract mismatch.

Inspect the current source, installed files, generated assets, platform metadata, lifecycle JSON/configuration, and relevant tests. Static configuration alone is not enough when the claim concerns execution.

## Execute the real path

- Invoke the generated/packaged Router or Runtime with the host-provided project `cwd` and the actual platform identifier when available.
- Check both guarded and allowed phases, plus missing/ambiguous project context where relevant.
- For cross-platform work, compare against the canonical platform registry and inspect every affected adapter; do not substitute a short hand-written platform list.
- When source changes are suspected, compare the source entry, generated bundle, manifest, and installed copy.
- Keep project/global Hook attribution separate and remain neutral when trusted host context is missing.

## Report the diagnosis

Return the observed command/path, expected contract, actual result, classification, evidence, and smallest next action. State whether the problem is reproducible, configuration-only, generated-output-only, or a production defect.

Do not modify source, generated assets, installation state, or GitHub issues unless the user asks. If a fix is authorized, route it through `comet-github-issue-fix` and rebuild the generated Runtime from source before verification.
