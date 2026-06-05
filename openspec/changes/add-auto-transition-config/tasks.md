## 1. 状态脚本与 schema

- [x] 1.1 在 `comet-state.sh init` 中读取 `openspec/comet.yaml` 的 `auto_transition`，并在新 Change `.comet.yaml` 写入默认值
- [x] 1.2 在 `comet-state.sh set` 中允许并校验 `auto_transition: true|false`
- [x] 1.3 在 `comet-yaml-validate.sh` 中将 `auto_transition` 纳入 required fields、known keys 和 enum 校验

## 2. 中文 Skill 自动流转

- [x] 2.1 更新 `assets/skills-zh/comet-open`、`comet-design`、`comet-build`、`comet-verify` 的自动流转说明，按 `.comet.yaml` 决定继续或提示
- [x] 2.2 更新 `assets/skills-zh/comet-hotfix`、`comet-tweak` 的连续执行说明，按 `.comet.yaml` 控制 preset 内部自动推进
- [x] 2.3 更新 `assets/skills-zh/comet` 字段说明和阶段流转原则，记录 `auto_transition` 的默认值与读取规则

## 3. 测试覆盖

- [x] 3.1 增加 `comet-state.sh init` 默认 `true`、项目配置 `false`、缺失字段和非法值回退 `true` 的测试
- [x] 3.2 增加 `comet-state.sh get <change> auto_transition`、`comet-state.sh set` 与 `comet-yaml-validate.sh` 对 `auto_transition` 的校验测试
- [x] 3.3 增加中文 Skill 文案扫描测试，覆盖手动模式提示和下一 Skill 名称

## 4. 验证与收尾

- [x] 4.1 运行 `npx vitest run test/ts/comet-scripts.test.ts` 验证脚本测试
- [x] 4.2 运行必要的 Skill 文案测试或全量 `npx vitest run`，确认文档扫描无回归
- [x] 4.3 用户验收：向用户说明 `auto_transition: false` 时的手动流转效果，用户确认符合预期后才能标记完成
