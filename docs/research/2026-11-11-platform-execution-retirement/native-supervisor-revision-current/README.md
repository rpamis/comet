# Supervisor 修订周期的当前业务测试

来源：`report:2026-11-10-agent-platform-execution`。本组不退休两个案例的业务，不恢复旧 factory、Shape 调度节点、受管检查、内容证明或进程监管。只修正当前接口的 fixture 前提和返回投影断言；未修改生产代码或构建。

两份修改前完整正文在同名 `.ts.txt` 和 `tests.json`。`declaration-mapping.json` 逐一保留 SDK 文件 10 条声明、Compat 文件 23 条声明的完整旧/新正文，只有下述各一条改变；参数展开后共 34 项。

## Compat 的修复 Child

原 `Native Supervisor v2 state confirms an Agent-selected repair child for failed Spec acceptance after explicit Shape revision` 在源码精确执行实际 0 通过/1 失败：`coverage/native-supervisor-repair-exact-one-results.json`。失败位于第二次用户确认结果的 `data.supervisor.tasks` 断言。首次 Shape proposal 实际正确返回 `shape/await-user`；不能把这条失败误报为不再请求 Shape 确认。

当前 `nativeNextCommand` 已直接返回 `data.supervisorTasks`，这个业务 task 没有消失。只把原期待层级改为现字段，原 repair Child 名称/Builder role、完整失败 Spec 验收、显式需求修订和用户确认参数全部保留。最后两个原 Child 仍 integrated、新 repair Child 仍 active 且绑定原 task 的断言不变。

改后原完整 case：`coverage/native-supervisor-repair-projection-one-results.json`，实际 **1 通过、0 失败、22 未选择**。Temp 先取得同一字段层级修正的 1/0 后才应用。

取证中的 `coverage/native-supervisor-repair-current-one-results.json` 因首次根据任务摘要漏写标题中的 `an`，为 **0 选择、23 未选择**，不能作为通过证据。随后使用源文件精确原标题取得上方 RED/GREEN，未重命名原案例。

## SDK 的完整新需求周期

原 `preserves integrated and uncommitted Child work, then rechecks every Child in the new Shape cycle` 使用当前公开 CLI：默认 `candidateCli` 和 `baselineCli` 均是当前 `dist/app/cli/index.js`，本轮未设置对应环境覆盖；不是实际 npm 0.5.2 场景，也不将它描述为真实旧版本升级。

原完整 case 在当前 bundle 实际 0 通过/1 失败、10 未选择：`coverage/native-supervisor-revise-current-one-results.json`。原已集成的 Left、Right 未提交草稿、两次显式 Shape 修订、全部 Child 在新周期重新 Builder/Verifier/integration、保留所有原成功 Action 事实、新 parent 候选完整验收和用户批准均已完成。最后 Archive dry-run 正确拒绝 Right 工作树中一直保留的未提交 `draft.txt`，报 `cleanup found a changed worktree`。不能为使旧 ready 断言通过而放宽实际清理保护、删除草稿断言或声称这些业务已退休。

当前新增真实拒绝前提：同一个 dirty Archive dry-run 必须失败，保原 Run、目标 HEAD、三个 Child/integration HEAD 及草稿原字节不变。然后明确模拟 Agent 把该草稿原字节复制到临时工作树以外的 `f.root/preserved-right-draft.txt`，核对保存成功后才移除原 untracked 草稿。这个普通文件操作是测试中 Agent 明确选择的保留动作；Comet 没有新增自动搬运、缓存或恢复机制。

之后继续所有原 `ready:true`、原 target/integration commit 绑定、只读 Run 不变、未经授权目标漂移拒绝及目标不被修改的断言，并在最后再次核对保留下来的草稿字节。此动作不会提交或伪造未完成工作，也不把未提交草稿纳入已接受产品候选。

SDK 改后原完整 case：`coverage/native-supervisor-revise-preserved-draft-one-results.json`，实际 **1 通过、0 失败、10 未选择**。同一当前公开 CLI 边界取得 RED→GREEN，原完整新周期业务没有删除或缩窄。

## 登记与验证范围

`registry-target-audit.json` 使用正式迁移链解析器审计全部 current/covered historical 案例；两文件在原链中共九条 target，均没有匹配本次两个声明的有效末端。其他原声明正文、标题、ID、来源、selector 和所有已有链均不变，本次不新增 ID 或 testMigration。

两测试的 Prettier 检查及 `git apply --reverse --check tests.patch` 通过。未运行其他 32 项、生成物构建、仓库全量、真实平台 Hook、Eval、模型或容器。SDK 的一个精确案例自身使用当前生成 CLI，其证据与 Compat 源码命令明确分开。
