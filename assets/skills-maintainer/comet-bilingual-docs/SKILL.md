---
name: comet-bilingual-docs
description: 在保留已确认语义、仓库结构、子模块边界和聚焦验证的前提下，同步 Comet 中英文文档、README、Skill、发布说明和网站页面。文档变更需要保持双语，或中文措辞需要英文对应版本时使用。
disable-model-invocation: true
---

# Comet 双语文档

先读取 `../comet-github/references/maintainer-contract.md`，并将文档变更限制在用户要求的范围内。

## 确定源语义

1. 确认权威的行为、发布范围或已接受的中文措辞。
2. 先更新并审阅中文语义。翻译时不要静默改变已经确认的用户可见术语。
3. Skill 内容需要用户确认时，在中文版本完成后暂停；确认后再同步英文版本。
4. 明确要求发布同步时，保持主 Changelog 和中英文网站页面的用户可见语义及信息架构一致。

## 谨慎同步

- 除非变更确实需要，准确保留示例、命令名、配置键、链接、锚点和代码围栏。
- 中文术语要自然，不要把 workflow 的 “gate” 翻译为“门”。
- 不增加用户不需要的实现细节。
- 将 `D:\Project\comet-website-docs` 视为独立仓库。用户授权交付时，先提交网站仓库，再更新父仓库 gitlink。

## 验证与报告

运行受影响文件的 Prettier 和 `git diff --check`。网站变更从网站仓库运行 `mint validate --disable-openapi`，或报告准确的 fallback/超时。README 或仓库契约变更时，运行可用的聚焦仓库契约测试。

报告源语言、同步的文件范围、验证结果和有意延后的翻译。除非用户明确要求，不提交或推送；交付时使用 `comet-safe-delivery`。
