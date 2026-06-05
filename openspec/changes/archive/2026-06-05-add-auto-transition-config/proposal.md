## Why

当前 Comet 技能默认在非阻塞节点自动流转到下一阶段。多数场景下这能减少用户操作，但也让希望逐步手动确认、手动输入下一条指令的用户缺少项目级控制。

本变更为每个 Change 增加 `auto_transition` 状态参数，让项目可以通过 `openspec/comet.yaml` 设置默认流转策略，并让各阶段 Skill 在自动流转前按当前 Change 状态决定是继续还是提示用户手动执行下一步。

## What Changes

- 新增 Change 级 `.comet.yaml` 字段 `auto_transition`，创建新 Change 时从项目级 `openspec/comet.yaml` 读取，缺省为 `true`。
- 更新 Comet 状态脚本与 YAML 校验，识别并校验 `auto_transition: true|false`。
- 更新中文 Comet Skill，在每个自动流转节点读取当前 Change 的 `.comet.yaml`，仅当 `auto_transition: true` 时自动进入下一 Skill。
- 自动流转关闭时仍必须先完成阶段 guard/state transition；`auto_transition` 只控制是否继续调用下一 Skill，不控制状态机是否推进。
- 当 `auto_transition: false` 时，Skill 不自动流转，并输出明确提示，告诉用户下一步可以执行哪个 Skill。
- 增加脚本测试覆盖默认值、项目级配置读取、状态校验和自动流转提示规则。

## Capabilities

### New Capabilities

- `comet-auto-transition`: 定义 Comet Change 如何记录、读取并执行自动流转开关。

### Modified Capabilities

无。

## Impact

- 影响 `assets/skills/comet/scripts/` 下的状态机和 YAML 校验脚本。
- 影响 `assets/skills-zh/` 下包含自动流转说明的 Comet Skill 文档。
- 影响 `test/ts/comet-scripts.test.ts` 中的状态文件与脚本测试。
- 新增项目级配置文件 `openspec/comet.yaml` 的读取约定，但不存在时保持现有自动流转行为。
