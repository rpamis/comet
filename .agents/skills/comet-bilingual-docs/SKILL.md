---
name: comet-bilingual-docs
description: Synchronize Comet Chinese and English documentation, README, Skills, release notes, and website pages while preserving accepted semantics, repository structure, submodule boundaries, and focused validation. Use when a documentation change must stay bilingual or when a Chinese wording change needs an English counterpart.
---

# Comet Bilingual Documentation

Load `../comet-github/references/maintainer-contract.md` first. Keep documentation changes scoped to the requested surfaces.

## Establish the source meaning

1. Identify the authoritative behavior, release scope, or accepted Chinese wording.
2. Update and review the Chinese semantics first. Do not silently reinterpret an approved user-visible term while translating.
3. For Skill content, pause after the Chinese version when user confirmation is required by the project workflow; synchronize English only after that confirmation.
4. For an explicitly requested release sync, keep the main Changelog and English/Chinese website pages on the same user-visible semantics and information architecture.

## Synchronize carefully

- Preserve examples, command names, configuration keys, links, anchors, and code fences exactly unless the change requires them.
- Keep Chinese terminology natural; do not translate workflow “gate” as “门”.
- Avoid adding technical implementation detail that users do not need.
- For `D:\Project\comet-website-docs`, treat the website as an independent repository. Commit its changes before updating a parent gitlink when delivery is authorized.

## Validate and report

Run affected-file Prettier and `git diff --check`. For website changes, run `mint validate --disable-openapi` from the website repository or report the exact fallback/timeout. For repository README or contract changes, run the focused repository contract test when available.

Report the source language, synchronized surfaces, validation results, and any intentionally deferred translation. Do not commit or push unless explicitly requested; use `comet-safe-delivery` for delivery.
