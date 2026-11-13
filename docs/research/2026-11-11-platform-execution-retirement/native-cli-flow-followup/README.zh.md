# Native CLI 与任务验收契约迁移

来源：`report:2026-11-10-agent-platform-execution`。

用户要求普通执行由 Agent 平台负责，移除受管检查计划、重复本机状态投影、隐式旧文档迁移及同一 workspace 多写入者排他。保留用户批准、原任务身份、完整验收内容、真实失败和事务恢复。本目录保存两份完整原测试、逐声明映射与补丁，不将机制退休解释为原问题已经修好。

CLI 原 7 项失败保留全部仍活跃的业务断言：

- 新建与自定义根流程仍验证材料、分支、状态版本、完整续行和验收条目；不再生成重复 `state.json`。
- linked worktree 的调用上下文路由仍是当前实际支持的行为，保留原路由和父目录不受污染的断言，仅移除本机镜像存在要求。
- Shape 缺 guard 的批准仍返回 64，原 YAML 字节不变；合法批准仍进入 Build。修订实现沿当前响应补上现有版本/action guards，保留候选、审查记录与混合参数拒绝。
- Doctor 不再自动清理陈旧选择；原选择字节保留到用户显式 `select`，选择切换不修改原需求的材料。
- 普通 `next` 不隐式导入旧裸 YAML；先拒绝且保留原字节，再显式 Doctor 导入，原证据和进度保留，历史 pass 不冒充当前 pass，不重建 fence 或本机执行镜像。

完整 CLI 测试首轮 31 通过、1 失败。唯一失败要求两个并发会话在同一工作区排他创建，属于已撤下协议。现改为同两个请求串行提交，保留一个成功、第二个返回 73、原 `activeChanges`、隔离指引和错误码全部断言，单项通过。原完整正文及这一要求的退休原因都在映射中；不宣称仍支持同工作区并发写入。

Flow 原两项失败现在实际执行一个无副作用的 Node 内容检查，将它的真实输出记录为 Builder checks，随后显式派发 Verifier。小范围的原 A1 和 17 项范围的原 IDs、文本保持相等。17 项还通过现有 typed details 页逐页收集并核对，无丢失或重复。已删除的 `verification_checks`、自动派发、`startupInput`、`scopeCount` 和 `scopeIds` 不再作为另一套任务投影保留。整文件 13 项通过；原 Build 缺口分页和 checkpoint 不作为验收证据的独立案例也实际通过。

历史 `native-242-gap-pagination` 只追加一个迁移节点，原冻结字段不改。节点为 `feature-removed`，仅退休上述执行/重复投影机制；另一条 acceptance/gap 安全业务测试继续作为必过目标。原正文、来源、case ID 和实际测试去向完整保存。

本次还暴露了真实审批缺陷：Compat 已处于准备好的 Shape 时，无 continuation guards 的 `--confirmed` 曾返回成功并进入 Build。`compat-missing-approval-guards-red.json` 保存原案例 RED；根 Agent 已在公开 Compat next 边界恢复单次 guard 校验，内部函数的调用合同不变。原案例保持返回 64、原字节不变与有效批准可完成；七种用户决定的缺 guard 反例也保留在当前 CLI 测试。该修复由根 Agent 修改产品源码，本次子任务只修改测试及证据。

上述是确定性源码 CLI 验证。真实模型 Eval、平台 Hook 和 npm 安装发布未执行；不把它们标成通过。根 Agent 统一构建后负责产物边界的最终检查。
