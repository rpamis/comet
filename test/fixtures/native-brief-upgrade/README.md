# 已确认 Native brief 升级样本

这两个样本由历史发布 Runtime 在独立临时 Git 项目中生成，没有手工构造 Build 状态。

- `v1.json`：发布 tag `0.4.3` 的 Native Runtime，完整 brief，文档约束 v1。
- `v2.json`：提交 `0fd42a02`（0.4.4）的 Native Runtime，四节 compact brief，Spec 场景引用 `Acceptance: A1`，文档约束 v2。

每个 JSON 保存 Runtime 的完整来源提交、brief、Spec 和确认后生成的 `comet-state.yaml`。样本不包含机器路径、凭据或进程数据。

生成步骤：从对应 Git 提交读取 `assets/skills/comet-native/scripts/comet-native-runtime.mjs`，初始化临时 Git 项目，执行 `init` 与 `new legacy-change --isolation current`，写入样本文档，再执行 `next legacy-change --summary "Prepare legacy Shape"`。读取返回的 `confirm-shape` 命令，将 summary 占位替换为确认说明后执行，保存生成的正式产物。

回归测试将原始正式产物恢复到新的临时 Git 项目，用当前 Runtime 执行查询、续跑及实现写入检查，核对阶段、验收项、确认绑定和历史记录。真实实现输入改变后的检查证据失效规则由原有候选绑定测试覆盖。
