---
name: comet-github-issue-fix
description: 在隔离范围内，通过所属 Native 或 Classic workflow、匹配风险的测试、生成 Runtime 检查和谨慎交付，实施已确认的 Comet GitHub Issue 或 review 阻塞项。用户明确要求修复已验证的 Issue 或 PR 问题时使用。
disable-model-invocation: true
---

# Comet GitHub Issue 修复

先读取 `../comet-github/references/maintainer-contract.md`。将 Issue 或 review 作为输入契约，不要把它当作修改 GitHub 或发布代码的授权。

## 确认工作边界

1. 阅读实时 Issue/PR，验证报告的问题确实存在。不要实施未经确认的 review bot 推测。
2. 确认目标分支、仓库状态、已有脏文件和关联 worktree。
3. 保护用户当前 checkout。目标分支或工作区较脏时，使用隔离的 worktree/branch。
4. 编辑前定义最小行为、文件、测试、生成资产、文档和非目标范围。

## 通过 Comet 所属流程实施

- Native 工作使用 Native workflow，Classic 工作使用 Classic workflow。
- 实施过程中扩大范围时，先回到所属 Build/范围确认步骤，再增加文件或行为。
- 通过支持的命令管理 Runtime 状态和生成资产，不手工编辑机器状态或把生成 bundle 当作源文件。
- 使用满足已确认 Issue 的最小生产改动；缺陷可复现时增加聚焦回归测试。

## 验证与交接

先运行最小相关测试。变更跨越对应边界时，再增加 build、生成资产、lint 或全量检查。分别报告本地结果、无关失败和远端 CI。

明确判断最终行为是否用户可见、是否需要 Changelog。开发新功能过程中发现的内部问题，不写成 Changelog 条目。

除非用户要求，不提交、推送、评论或创建 PR。获得授权后，将准确文件范围交给 `comet-safe-delivery`。
