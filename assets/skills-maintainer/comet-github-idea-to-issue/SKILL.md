---
name: comet-github-idea-to-issue
description: 基于当前代码库，将本地 Comet 想法、观察到的回归或改进提案整理为聚焦的 GitHub Issue 草稿。用户要求把本地调查转换为 Issue、后续 Issue、Bug、Feature 或维护任务时使用。
disable-model-invocation: true
---

# Comet 本地想法转 GitHub Issue

先读取 `../comet-github/references/maintainer-contract.md`。起草阶段只读；创建 GitHub Issue 必须得到明确确认。

## 确定 Issue 内容

1. 理解本地观察，检查当前实现、测试、Runtime 路径和相关文档。
2. 按领域概念搜索已有 GitHub Issue 和 PR，判断这是重复问题、已有 Issue 的 follow-up，还是新报告。
3. 选择最匹配的仓库模板：bug、feature、task 或 question。起草字段前先读取当前 YAML 模板。
4. 区分用户可见问题和推测的实现原因。只有有助于复现或界定范围时才写入实现细节。

## 起草正文

生成以下内容：

- 使用仓库模板前缀的简洁标题；
- 受影响的 workflow、平台和版本/状态；
- 当前行为与预期行为；
- 复现步骤或触发该想法的用户流程；
- 已有证据和疑似边界，未经验证的内容标注为假设；
- 明确范围和非目标；
- 可以独立检查的验收标准；
- 相关 Issue/PR 链接和重复搜索说明。

Feature 需要先描述 workflow 问题和期望行为，再提出实现方案。Bug 需要在必要时保留准确命令、日志、版本和项目状态。

## 确认后再发布

先展示完整的标题、模板类型、标签和正文。得到确认后才能调用 `gh issue create`。创建后验证返回的 URL 和标题，并报告 Issue 编号。除非另行要求，不修改标签、不关闭相关 Issue，也不创建额外 ticket。
