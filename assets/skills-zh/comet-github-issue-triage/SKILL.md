---
name: comet-github-issue-triage
description: 对照当前仓库契约、源码、Runtime、测试和安装行为，验证并分类 Comet GitHub Issue。用户询问 Issue 是否真实、可复现、重复、已实现、属于配置问题，或是否适合后续处理时使用。
disable-model-invocation: true
---

# Comet GitHub Issue 分诊

先读取 `../comet-github/references/maintainer-contract.md`。除非用户明确授权 GitHub 或代码变更，否则保持只读。

## 收集当前证据

1. 阅读完整 Issue 正文、评论、标签、作者、时间、关联 PR 和此前的分诊记录。
2. 按领域概念搜索已有 Issue，而不只是复用报告者的原文措辞。识别重复、被替代的 Issue 和已经实现的行为。
3. 检查当前源码、配置、安装路径、生成资产和相关测试，以实际仓库契约作为判断依据。
4. Bug 信息充分时复现最小有效路径。环境或凭证问题需要区分本地设置和产品行为。

不要仅因描述听起来合理就认定存在缺陷。报告可能有效、夸大、过期，或由本地安装/配置不一致造成。

## 分类结果

选择一个主要分类：

- `confirmed defect`：当前行为违反用户可见行为或仓库契约，且证据能定位路径；
- `likely defect`：证据较强，但仍缺少复现或决定性边界；
- `configuration/install issue`：产品行为正确，或本地安装已过期/配置错误；
- `duplicate/already implemented`：行为或 Issue 已在其他位置存在；
- `insufficient information`：需要补充具体步骤、版本、日志、平台或项目状态；
- `feature request`：请求的是新能力，而不是回归问题。

## 报告与下一步

返回分类和置信度、检查过的证据、相关代码/Runtime 路径、已确认和未知的内容，以及建议动作：补充信息、本地修复、创建聚焦 follow-up、关联已有 PR，或按重复/已实现处理。

不得自动关闭、加标签、评论或创建 follow-up Issue。确实需要新 Issue 时，用户确认范围后再交给 `comet-github-idea-to-issue` 起草。
