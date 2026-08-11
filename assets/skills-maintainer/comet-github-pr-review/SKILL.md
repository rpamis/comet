---
name: comet-github-pr-review
description: 以只读、证据优先的方式审阅 Comet 社区 PR，包括最新 diff、关联 Issue、review thread 状态、可合并性和 CI。用户要求审阅 PR、判断评论是否仍然有效，或准备简洁的合并阻塞评论时使用。
disable-model-invocation: true
---

# Comet GitHub PR 审阅

先读取 `../comet-github/references/maintainer-contract.md`。除非用户另行授权修复或回复 GitHub，否则保持只读。

## 刷新目标状态

1. 解析 PR 编号或 URL，并确认仓库。
2. 获取当前 PR 元数据：目标分支、源分支和 SHA、作者、关联 Issue、标签、可合并状态和更新时间。
3. 阅读完整 PR 正文、提交、diff、评论和 review thread。确认 thread 是否已解决或过期，不要把所有可见评论都当作仍然有效。
4. 查询准确 head 对应的当前检查。如果有失败检查，将详细调查交给 `comet-github-ci-triage`。

结论必须基于当前 PR head/base。测试通过不能证明 PR 可合并，因为 head 可能落后于 base 或存在当前冲突。

## 审阅实现

针对每个声明的行为：

- 找到真实的生产调用路径；
- 将实现与关联 Issue/spec 对照；
- 必要时检查相关测试和生成 Runtime 资产；
- 报告 Bug 或阻塞项时复现可达的失败路径；
- 检查当前 head 是否已经修复该问题。

Review bot 输出只能作为调查线索，不能直接作为结论。区分生产逻辑、测试/fixture 漂移、生成物漂移、环境噪音和合并冲突。

## 只报告必须处理的问题

优先报告会阻塞正确性、数据完整性、安全、用户可见行为或合并的问题。除非仓库契约明确要求，否则省略纯风格建议、理论边界和推测性改进。

每个问题包含：严重程度、简洁标题、准确的文件/行号或 Runtime 路径、当前行为为何失败、最小修正方向以及证据状态。

结尾给出明确结论，例如“没有必须修复项”“存在必须修复项”“需要先处理合并/CI 问题”或“证据不足”。

## 评论和修复边界

- 用户要求评论时，在分析后提供可直接复制的 Markdown。
- 未经明确要求不得发布评论。
- 用户要求修复时，将已确认范围交给 `comet-github-issue-fix` 或现有 Comet workflow；不要基于未确认的 bot 建议直接修改。
