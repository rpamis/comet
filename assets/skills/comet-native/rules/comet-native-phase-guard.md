# Comet Native 阶段规则

本规则只在项目的 `.comet/config.yaml` 启用了 `native` 工作流时生效。Native 是 Comet 自有的轻量流程，不依赖外部 Skill。

- 开始或恢复工作时，先读取 `.comet/config.yaml`，再读取配置的 `<artifact_root>/comet/changes/` 状态。
- Shape 阶段用于澄清目标、边界、约束和验收条件；不要修改实现代码。
- Build 阶段可以修改实现代码，并持续维护 change 产物和检查点。
- Verify 阶段只运行验证、记录证据和修复验证暴露的问题；若需要继续实现，先按 Native 状态机回到合适阶段。
- Archive 阶段只归档已经通过验证的 change，不再修改实现代码。
- 遇到需要用户选择的产品决策时暂停自动推进；其余阶段由同一个 Native Skill 按状态自动继续。

Hook 会拦截 Shape、Verify、Archive 阶段的普通代码写入。不要绕过 Hook；请恢复 `/comet-native`，让状态与实际工作保持一致。
