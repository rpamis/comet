# Comet 全流程 CLI 性能优化：准备记录索引

日期：2026-09-21。需求已迁入 Native change `workflow-cli-performance`，不再在本文件维护第二份需求。

- [正式需求与验收](../comet/changes/workflow-cli-performance/brief.md)
- [完整目标规格](../comet/changes/workflow-cli-performance/specs/workflow-cli-performance/spec.md)
- [前期开源方案调研](2026-09-21-cli-daemon-mcp-options.md)（背景资料，不表示本次实现 MCP）

用户先选择 B（当前目录新分支），随后自行建立并切换到 `043`、处理原有未提交文件。Comet 已复用 `043` 创建 branch 类型 change，目标分支为 `master`，工作目录仍为 `D:\Project\Comet`；未执行 stash，也未创建其他分支或 worktree。

本轮仅准备和澄清需求。完整 Shape 确认前不进入 Build、不修改运行时代码；正式状态以 Runtime 管理的 `comet-state.yaml` 为准。此前草案和已解决的工作区问题保留在 Git 历史中。
