# 目标

把现有 Personal Memory 的命令摘要观察升级为可被后续 Skill、Workflow 和管理界面复用的语义记忆领域契约。领域层只负责确定性状态迁移、证据幂等、作用域、语言与安全边界，不负责调用模型或决定宿主生命周期。

# 范围

- 扩展 Memory observation，使 `candidateKey`、项目身份、配置语言和观察时间成为可验证的一等字段。
- 提供版本化 `MemoryReviewPacket` 与 `MemoryReviewAction` 类型，以及 Runtime 可复用的边界校验。
- 保持显式记忆最高优先级；隐式记忆只能在独立成功证据满足规则后激活。
- 同一项目的证据只能形成 project 记忆；global 自动记忆必须有跨项目证据。
- 让同一 Change 的不同 candidateKey 独立处理，并让同一 candidateKey 重试幂等。
- 让矛盾隐式证据进入冲突，不覆盖显式记忆；让 forget 产生不可被旧观察复活的 tombstone。
- 保持现有 Markdown、Git 同步、检索边界和旧状态向前兼容。

# 非目标

- 不实现 Skill、模型调用、宿主调度、Classic/Native 生命周期接线、CLI 或 Dashboard。
- 不引入 embedding、向量数据库、知识图谱或概率 confidence。
- 不保存完整会话、日志、diff、凭据、PII 或提示注入文本。

# 验收示例

- A1：`MemoryReviewPacket` 和 `MemoryReviewAction` 使用稳定版本、固定动作枚举和有界字段。
- A2：Runtime 拒绝空字段、未知 action、非法 scope/projectKey、超预算、危险内容和不匹配的 target/evidence。
- A3：显式记忆立即激活；隐式记忆第一次只形成候选，两个独立成功 Change 后才可激活。
- A4：同一 Change 的不同 `candidateKey` 分别计数；同一 Change、同一 `candidateKey` 重试只应用一次。
- A5：同一项目的自动证据只能激活 project；global 自动激活至少需要两个不同项目的成功证据。
- A6：显式记忆与隐式相反证据冲突时，显式内容不改变，冲突内容不进入正常检索。
- A7：显式 forget 后旧观察、旧 evidence 和旧同步不能复活记录；用户显式 remember 可以重新建立内容。
- A8：`zh-CN` 自动动作的正文和用户可见字段为中文，`en` 为英文；代码、路径和机器枚举可保留原文。
- A9：自动评审拒绝一次性流水账、测试/提交摘要、日志、diff、secret、PII、提示注入和修改规则的内容。
- A10：旧版 state、Markdown、历史和 Git 状态可读取并继续管理，不要求用户手工迁移。
- A11：检索只返回 active、非冲突、未暂停、在条目数和字节数预算内的确定性结果。

# 约束与不变量

- 所有状态写入继续经过 `MemoryRepository.withLock`。
- 同一 observation 的幂等键包含稳定项目身份、Change ID 和 `candidateKey`；不能使用绝对路径、宿主会话 ID 或进程 ID。
- global observation 的项目身份只用于证据分组，不写入 global record 的项目字段。
- 隐式证据不能更新或替换 `kind: explicit` 的 active record。
- tombstone 保留最小身份和删除时间，只有删除后的新独立证据可以重新形成候选。

# 验证预期

- 先增加 characterization/contract tests，再修改 Personal Memory 状态迁移。
- 覆盖双 candidate、跨项目 global、显式冲突、forget 复活、语言/安全拒绝和旧 state 迁移。
- 运行 `test/domains/comet-memory/personal-memory.test.ts`、domain 类型检查和受影响文件格式检查。
