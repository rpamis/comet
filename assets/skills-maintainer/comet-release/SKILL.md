---
name: comet-release
description: 根据真实版本和分支范围准备 Comet 发布或发布说明更新，保持 Changelog 面向用户、双语网站文档一致、生成资产已验证，并明确 Git 交付边界。Beta、hotfix、版本检查、发布说明或发布就绪检查时使用。
disable-model-invocation: true
---

# Comet 发布

先读取 `../comet-github/references/maintainer-contract.md`。本 Skill 负责准备发布资产；commit、push、tag、GitHub Release 和 npm 发布仍然需要单独授权。

## 确定发布范围

1. 阅读 `package.json`、lockfile 元数据、当前顶部 Changelog 标题、当前分支、`origin/master`、上一发布 tag 以及 release/hotfix 分支范围。
2. 判断当前分支是否已有高于 master 的版本。如果已有，就追加或重写同一个版本，不要创建重复版本。
3. 根据真实发布范围列出候选变更，只保留用户从上一版本升级后能够感知的内容。
4. 将条目分类为 Added、Changed、Fixed、Removed 或 Security。只有已发布基线中已经存在的用户问题才归入 Fixed。

## 编写发布内容

使用专业、中性、面向用户的英文 Changelog。描述行为和价值，不写实现过程、bundle/cache 细节、生成文件名、Git 对象 ID、review follow-up 或普通测试重构。

网站发布文档在范围内时，调用 `comet-bilingual-docs`，同步主仓库与 `D:\Project\comet-website-docs` 中已确认的用户可见语义，并保持中英文结构一致。

## 验证发布就绪

根据发布风险运行检查：纯文档变更运行受影响测试和格式检查；Runtime、安装、路由或发布元数据变更再运行 build、生成资产检查、package dry-run 和全量测试。网站从自己的仓库运行可用的 Mintlify 命令，超时要标记为未验证。

展示最终版本、包含的用户可见变更、验证结果和剩余未知项。用户明确授权 commit 或 push 时使用 `comet-safe-delivery`。本 Skill 不负责 npm 发布。
