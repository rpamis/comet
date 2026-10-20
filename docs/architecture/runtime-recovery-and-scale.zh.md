# Runtime 恢复与规模化读取

SDK Run 是流程推进的权威。Native 与 Classic 保留各自的业务状态机；索引、Dashboard 摘要和诊断只消费权威事实，不能代替执行与验收。

## 请求和提交

公开操作在异步等待前捕获请求。扩展回调得到隔离视图，输入修改不能静默改变已经绑定的 inputHash。布尔及控制返回值也需要严格校验；原 AbortSignal 保留实时取消语义。

提交与冷读共用语义约束。可信且已经验证、冻结的历史可以增量复用，外部 Store 和冷记录必须重新验证。CAS 重试不重放外部执行；验证器与能力探测也不得包含不可重复副作用。

## 执行身份和恢复

每次执行绑定 workflow、Run、Action、attempt、inputHash 和原领取身份。executionOrigin 记录领取时的定义；经批准升级工作流时保留旧执行来源，重试新 attempt 则清除旧来源并重新捕获。迁移保留同一次执行的原收据身份，但不恢复旧领取权限。

业务终态、执行实际停止、存储事务收尾是不同事实。缺 PID 或本机执行文件不能证明停止；成功、失败或取消也不自动证明整个执行进程树已停止。缺证据时明确阻塞，不能伪造 not-executed 或 stopped。

`acknowledge-stopped` 可独立确认已结束调度的具体执行，不修改业务结果。请求需要当前 expectedRevision 和非空 stoppedActions，每项提供原 actionId、attempt、inputHash、claimToken 及实际 evidence。模板占位符不是证据。

Native 的正常续行、取消和显式修复可以持久化已经核验的停止事实。只读诊断不写入。Classic 补交必须核验原始收据，不能用可编辑 recovery JSON 代替。归档收据只要仍承担历史校验义务，就不能因 Action 进入终态而丢弃。

定制 Native / Classic 应用丢失 Runtime 存储但仍有合法 portable 记录时，只读检查会返回固定应用文件、项目路径及 `next` 恢复请求。按返回参数显式恢复，不要反复执行 `inspect`；恢复只推进 Runtime，不替代宿主执行。普通独立应用没有可验证的原始恢复记录时，不能凭同名 Run 重建事实。

## 存储协调和诊断

FileRuntimeStore 可以幂等完成已有 closing / reopening 意图，保留 revision、摘要和文件身份验证，不重放业务 command 或 Skill。协调完成后重新检查调用者 revision。

诊断分别呈现 stateReadable、executionReconciled 和 storageSettled，并提供问题码及恢复动作。正常等待用户批准不是损坏；仅能解析状态也不代表可以继续派发。状态输出在同一次投影内共享执行观察，独立请求仍重新读取。

固定应用索引只追踪实际资源持有者；未知执行和未确认停止的取消任务仍持有资源。库存、提交意图、epoch 和写入协议共同防止恢复时遗忘占用。注册已经发布后成员失踪必须拒绝恢复，不能当作未执行注册清掉占用。

升级前先停止旧版本写入者，再统一升级 CLI 和宿主。不得手改索引、删除锁或让旧进程继续写入新协议存储。普通领取不读取全部 pending 正文，但首次索引、显式审计及故障恢复仍可能全库验证；新增库存登记也有随规模增长的成本。

检查、审计和重建使用固定应用入口：

```sh
comet runtime dispatch --application <应用ID> --project-root <项目目录> --request request.json
```

请求分别为：

```json
{ "operation": "inspect-storage-index" }
```

```json
{ "operation": "audit-storage-index", "expectedEpoch": "inspect返回的epoch" }
```

```json
{ "operation": "rebuild-storage-index", "expectedEpoch": "inspect返回的epoch" }
```

重建只能从完整原始记录恢复派生索引，不能凭当前目录现状忘记已登记成员。详见 [存储协调协议](runtime-store-coordination.md)。

## 有界查询和 Dashboard

显式 inspect 仍返回完整结果。有限查询使用 query：

```json
{ "operation": "query", "runId": "example", "view": "history", "limit": 25 }
```

- current：当前调度状态，保留全部并行待办。
- summary：运行摘要。
- history：每页 1–100 项，默认 25；可传 cursor 与 filter，筛选 actions、waits、evidenceWaits 或 all。
- action：用 actionId 读取选定动作。
- artifact：用 actionId 和可选 artifactId 查询已绑定工件引用，不读取任意外部资源。

游标绑定真实存储范围、Run、revision 和筛选条件。状态变化后不能继续拼接旧页。Dashboard 默认加载有限历史，并保留当前项和选中项；旧 revision 的历史必须标明快照状态，不能继续作为当前操作授权。

紧凑读取仍读取、验证整个紧凑 checkpoint，只避免逐个展开所有历史累计输入。Native / Classic 同时核验实际 portable 正文及权威 Run 的规范化摘要，不能仅信任可编辑 marker。该实现不是物理历史分区，也不承诺常量 I/O。

累计输入通过持久化树共享不变部分。冷读取后的相同值按规范值标识复用，不依赖内存对象身份；无变化的树更新保留原节点，提交只保留历史根可达的节点，避免把中间更新产生的废弃节点反复写入磁盘。显式完整读取仍可能产生很大的逻辑结果，调用方应优先使用有限查询。

## Eval 证据

Python 与 TypeScript 共用用例身份、预期矩阵及协议样例。在线验收、历史、基线、比较和重跑采用一致校验。执行生命周期、证据完整性、样本质量及完整评测结论分别表达；完整失败结果可作基线，失败子集通过不能冒充全量通过。

全部评分维度参与统计，显示裁剪不改变事实。报告原子发布，分页绑定代际与内容摘要。大输入不复制进索引清单；全文搜索必须读取并核验原报告，且有明确预算。大量未完成验证按公平队列推进，不能被缓存淘汰反复重头开始。

损坏结果只允许根据完整、有效原用例重建派生摘要，需要 expectedRevision 和已停止执行的确认，并保留原始坏字节。没有原始事实就不能恢复通过结论。collect 是只读收集，不为此创建用户配置。

## 验收边界

真实执行、收据提交中断、冷迁移、恢复命令执行及下一任务应贯通验收，并核对执行次数。单元测试、打包安装、平台 Hook、浏览器和真实模型评测是不同证据层级。

单机规模样本不能替代生产 SLA。容量验收应明确活跃 Run、历史量、链长、报告体积、并发查询和故障恢复目标，分别测量冷启动、稳定请求和延迟分位。

本轮实际执行的检查、规模样本及未覆盖项见[核心修复验证记录](core-recovery-validation-2026-10-20.zh.md)。
