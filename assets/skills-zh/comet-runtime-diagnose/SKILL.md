---
name: comet-runtime-diagnose
description: 通过区分过期配置与源码缺陷，并执行真实打包 Runtime 路径，诊断 Comet Hook、安装、路由、平台、生成 Runtime 或生命周期行为。Hook 或安装报告可能涉及配置、生成资产漂移、不支持的平台或跨项目归属问题时使用。
disable-model-invocation: true
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
