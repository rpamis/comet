# Issue #568 独立修改与 Native 取消选择

来源为 <https://github.com/rpamis/comet/issues/568>。实现分支为 `055`，比较基线为最新 `origin/master` 的 `d31d310e6d8c8223a08646c6e022c4de9ee75b91`。基线版本为 0.5.4，本次版本为 0.5.5。

## 行为与根因

用户在已有未完成 Shape 的项目使用其他 Skill 修改独立 UI，明确要求本次不走 Comet，仍收到 `implementation writes are only allowed in Build`。0.5.3 tag 和 0.5.4 生成 Router 均已在隔离项目重现。

原 selection 只有已选和缺失两种读取结果。Router 将项目 current change 作为普通编辑的归属，selection 缺失时推断唯一活跃 change。恢复探测的 `out_of_scope / user-opted-out` 只读返回意图，并未记录工作区取消选择。

两项行为分别登记为 `native-independent-work-selection` 和 `native-no-selection-resume-contract`。预期是用户明确退出后独立修改可以执行，原 Run 可恢复，正式材料与 Runtime 状态继续受保护。禁止为了普通小改强制确认或取消 Shape，以及通过唯一候选回退重新进入原流程。

## 实现

`comet native select --none` 写入共享 `comet.selection.v2` 的 `workflow: none`，`change` 与 `branch` 均为 `null`。读取返回明确的 `status: none`。缺少文件仍沿用历史推断行为，旧 Native、Classic 和 application 记录保持兼容。旧版本读取新增 none 记录会拒绝未知 workflow，使用新版公开命令重新选择后可恢复已有格式。

Router 在项目归属与 Runtime 路径保护后处理 none，普通编辑放行，工作流材料要求先选择其所属 change。恢复探测返回 `out_of_scope / no-change-selected`。`comet native select <name>` 恢复原阶段检查。该选择作用于整个工作区，同目录内多个会话共享，独立 Git worktree 分别记录选择。

中文及英文平台 Rule、CLI 帮助、Shape 拒绝消息和 opt-out 探测消息说明用户明确要求独立修改后的公开命令。`already-in-comet-flow`、普通只读请求和其他 `out_of_scope` 原因不会自动取消选择。恢复探测保持只读。

## 验证

- 同一新增公开 CLI 测试在修改前 3 项失败，均为 `select --none` 返回 exit 64，错误为 `change name is required`。
- 首轮 5 个相关测试文件通过 65 项，3 项环境条件跳过。
- 扩展检查中 CLI、恢复探测、Classic 选择、共享选择和发布元数据通过。首次生成资产检查因版本更新后的 bundle 尚未刷新失败，重新生成后 Native/Entry 资产 16 项全部通过。
- `pnpm test:core-regressions --case native-independent-work-selection --case native-no-selection-resume-contract` 通过 2 组、6 项精确案例。覆盖退出、重入、原 Shape 状态保留、重复取消选择、工作区隔离、正式材料保护、探测只读、冲突参数、缺失记录与 none 区别，以及 none 的迁移与校验。
- `pnpm build` 通过，随后为 0.5.5 重新构建 Classic、Native、Entry Runtime 并执行 TypeScript 编译和 Native facade 构建。构建保留 Dashboard 产物体积提示。
- `pnpm lint` 的 ESLint 通过。原工作区架构检查因现有聊天附件目录 `.codex-attachments/` 不在顶层白名单失败。使用只排除该目录的临时目录视图重跑相同架构检查通过，未移动或删除附件。
- badcase 登记与历史基线保留检查、受影响源文件 Prettier 和 `git diff --check` 通过。
- 本地 `npm pack --ignore-scripts` 生成 0.5.5 包。首次命令的 JSON 解析受 prepare 提示污染，包已成功生成，随后直接解包验证。隔离消费者复用当前依赖，通过包内公开 CLI 和 Router 验证 0.5.3 创建的 Shape，依次得到拒绝、取消选择后放行、探测尊重 none、重新选择后拒绝。该证据覆盖本地打包产物，未执行公共 npm 安装。

## 待验证

真实 Claude Code 平台 Hook 和真实模型根据自然语言调用退出/恢复命令尚未验收。用户截图中的原环境不可用，本次只重放其 Hook 事件格式。未获 Eval 启动授权。负责人为 benym，后续在原平台复验真实 Edit 成功与重新选择后的拒绝，并在明确授权 Eval 后验证模型行为。两项附加验收保留 pending，Issue 保持打开。

本地未运行全量测试，验证范围为本次 CLI、共享选择、Hook Router、恢复探测、兼容与发布资产的相关检查。
