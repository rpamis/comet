# Native Skill 路由及平台检查文案

授权来源：report:2026-11-10-agent-platform-execution。用户本轮已授权 Native/Classic 普通执行交还 Agent 平台及中英文同步；Root 明确授权本批薄改 Skill Build 残留，其他 Runtime 源码保持冻结。

本批改 assets/skills-zh/comet-native/SKILL.md、assets/skills/comet-native/SKILL.md 的对应 Build 一段，以及 native-sdk-skill-routing.test.ts 四个相关声明（中英文恢复路由两个、产物位置合同两个）。原完整测试全文和两个 Skill 修改前后正文保存在 tests.json，9 个声明/13 个展开项的正文是否变化见 mapping.json；没有删除/skip 原测试。

## 调查与改动

原 routing 整组 11 passed / 2 failed，均为测试要求恢复文档无条件列出 doctor--repair--confirmed 固定命令。当前中英文实际已经要求先用 doctor--json 只读检查，按返回的明确恢复/导入入口继续，并保留已保存阶段、Action、claim 和有效批准，status 不写记录，未知任务先核原平台、不能重放副作用。此合同正确，因此只迁对应两项断言，其他 owner 路由/SDK 与 Compat 分支/用户提案绑定/unknown 不重派/按需读取条款均保留。

另发现英文 Build 真残留“current Runtime check plan”，并有旧 literal 测试强制它。中文对应段原本已经是平台检查。按授权先更新中文，再同步英文：Agent 选择适用自动检查，平台工具核对原文件实际内容并记录对象与结果。保留 brief 原位置、章节/格式、补齐遗漏产物、不能拿另一文件同类内容代替、修改批准内容仍走原修订/确认；不添加强制检查轮次、独立 Agent 或 CLI 检查计划。

## 验证与边界

- routing-before.json：原 routing 13 项中的 11 passed / 2 failed。
- routing-and-skill-after.json：最终一次组合 41 passed / 0 failed / 0 skipped，分别 routing 13 与 native-skill 28。
- 使用显式空 ignore 文件执行两个 Skill Markdown 和测试文件 Prettier 检查，通过；默认 assets ignore 不作为 Markdown 已检查证据。
- 这是静态 Skill 文案合同，不证明真实 Agent 会遵循或压缩次数下降。未执行 build、Runtime bundle、安装、真实平台 Hook 或模型/容器 Eval。
- 没有单独追加开发期内部修正文案的 Changelog；发布可见“普通检查由平台执行”归并到 Root 本轮最终变更记录。

## 登记

受影响的唯一有效 ID 为 native-user-artifact-location-retention；它两个现有 requiredNames 和原测试映射都保留。新增 tests-moved 首段，cas-plan.json 给出原 record expected 与 next，不修改原 ID/来源/行为/其他字段。native-rule-skill-review-and-learning-alignment 只选中本批未改 Rule 声明，不动。另两个恢复路由声明无登记引用。

四 artifact registry/tests/mapping/patch 的摘要绑定在 draft-case.json。sourceDoc before/after 映射及全部正文一同保留，不将旧计划文案以新名字恢复。
