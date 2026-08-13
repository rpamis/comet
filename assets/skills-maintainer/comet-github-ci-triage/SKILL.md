---
name: comet-github-ci-triage
description: 使用 PR 当前准确 head、失败 job 日志、本地复现边界和可合并状态，诊断 Comet PR 的 GitHub Actions 与覆盖率检查。PR 出现 CI 报错、Codecov 问题、过期检查或无法解释的红色 job 时使用。
disable-model-invocation: true
---

# Comet GitHub CI 分诊

先读取 `../comet-github/references/maintainer-contract.md`。默认只做诊断；只有用户要求时才实施修复。

## 检查准确的远端状态

1. 解析 PR，记录当前 head SHA 和目标分支。
2. 运行 `gh pr checks <pr> --json name,state,bucket,link,workflow,startedAt,completedAt`。
3. 对失败 job 使用 `gh run view <run-id> --log-failed` 或最小范围的 job 日志检查真实失败边界。不要在没有日志证据时相信聚合助手摘要。
4. 检查可合并状态，并确认显示的检查属于当前 head。过期 run 不能证明当前代码有问题。
5. Codecov 页面信息不完整时，通过可用 API 检查受影响文件和 patch coverage 元数据，并报告准确 head 和覆盖率范围。

## 分类失败原因

判断红色结果属于：

- 生产代码；
- 测试 fixture 或冻结契约投影；
- 生成 Runtime 漂移或构建输出不确定；
- 依赖、工具链或平台环境；
- 凭证、权限或 Runner 配置；
- 过期检查或合并冲突；
- 未解决的覆盖率阈值。

用户要求实施时，在本地复现最小决定性边界。Windows 环境需要先区分沙箱、凭证或占位可执行文件噪音与真实 CI 失败，再修改产品代码。

## 准确报告状态

返回当前 head SHA、失败 job、根因、证据和最小动作。把远端状态与本地检查分开报告。超时、缺失、过期或尚未启动的检查都标记为“未验证”。

在准确最终 head 的新检查成功前，绝不宣称 CI 全绿。如果需要修复，将已确认范围交给 `comet-github-issue-fix`，获得授权后再使用 `comet-safe-delivery`。
