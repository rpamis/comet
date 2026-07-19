# Comet Native 阶段规则

本规则只在项目的 `.comet/config.yaml` 启用了 `native` 工作流时生效。Native 是 Comet 自有的轻量流程，不依赖外部 Skill。

- 开始或恢复工作时，先读取 `.comet/config.yaml`，再读取配置的 `<artifact_root>/comet/changes/` 状态。
- Shape 阶段用于澄清目标、边界、约束和验收条件；不要修改实现代码。
- Build 阶段可以修改实现代码，并持续维护 change 产物和检查点。
- Verify 阶段只运行验证并记录证据；若验证暴露实现问题，先记录失败结果并返回 Build，再修复实现。
- Archive 阶段只归档已经通过验证的 change，不再修改实现代码。
- 遇到需要用户选择的产品决策时暂停自动推进；其余阶段由同一个 Native Skill 按状态自动继续。

Hook 会拦截 Shape、Verify、Archive 阶段的普通项目写入，包括点号开头的项目文件；无法确定目标的写入也会失败关闭。Native 控制产物仍可写入。不要绕过 Hook；请恢复 `/comet-native`，让状态与实际工作保持一致。
