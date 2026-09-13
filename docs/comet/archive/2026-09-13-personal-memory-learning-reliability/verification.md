---
generated_from_state_version: 16
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 2
- 迭代: 1
- 验证器尝试次数: 3
- 完成时间: 2026-09-13T16:47:08.775Z
- 摘要: All seven currently unresolved acceptance items passed. Existing 31 passed items are retained; Runtime checks for the current candidate all passed. Real Agent evidence completes the learning loop and no-preference control.

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1: 新存储中首次提交合格偏好形成候选，同一 change 的重复提交和恢复不增加独立成功证据，第二个独立成功 change 才能晋级并被新进程检索。 | 候选、去重、晋级和新进程检索测试通过。 |
| A2 | passed | brief.md | A2: 评审异常或超时后观察已持久化且显示待重试；进程退出后恢复同步能处理一次，不丢失、不重复晋级，不能无限阻塞主任务。 | 待评审观察持久化、恢复和重试测试通过。 |
| A3 | passed | brief.md | A3: 上次晋级后提交一次性摘要，输出和后续状态都显示本次跳过及原因，不显示延后或沿用上次晋级；确定性拒绝不进入无限重试。 | 语义 skip 能替换旧诊断且不增加证据，相关测试通过。 |
| A4 | passed | brief.md | A4: 零观察、其他 change 或其他项目的观察不能证明当前任务 submitted；已有持久化观察能显示其真实候选、跳过或待评审结果。 | submitted 按 project/workflow/change 绑定，相关测试通过。 |
| A5 | passed | brief.md | A5: Native、Classic、Hotfix、Tweak 均提交带稳定项目、workflow、change、主题和可信成功证据的合格观察；失败/取消不增加成功证据，同一 change 的路径切换不重复计数。 | Four workflow integration tests and Runtime checks cover stable project/workflow/change/topic binding, trusted success evidence, failure/stop handling, and same-change path dedupe; passed. |
| A6 | passed | brief.md | A6: 新旧中英文评审契约统一为首次可创建候选、Runtime 决定晋级；没有合格偏好时允许无观察或 skip，不要求每次任务产生记忆。 | 中英文评审契约和候选晋级边界测试通过。 |
| A7 | passed | brief.md | A7: CLI 和 Dashboard 对同一任务显示一致的最近检查、结果和原因；从未检查、未检查、无观察、待重试、跳过、已形成候选和已晋级能被正确解释，不暴露内部证据正文。 | CLI、Dashboard 和当前项目隔离诊断测试通过。 |
| A8 | passed | brief.md | A8: 远程服务支持诊断时展示真实结果；不支持、认证失败或超时时显示可读的不可用状态，不伪造开启/成功，不访问本地记忆作为替代。 | 远程权威状态、不可用诊断和无本地 fallback 测试通过。 |
| A9 | passed | brief.md | A9: 旧存储缺少诊断字段仍可读取已有显式记忆、候选和删除历史，不虚构过去检查；新增诊断、并发和队列恢复不损坏既有数据。 | 旧状态兼容读取和诊断缺失处理测试通过。 |
| A10 | passed | brief.md | A10: 待重试时暂停学习或用户纠正/删除记忆，恢复处理尊重最新策略、显式修改和 tombstone，旧观察不能复活删除项或覆盖显式偏好。 | Pause, user correction, permanent forget/tombstone, and pending-review replay tests confirm latest policy wins and deleted content cannot revive; passed. |
| A11 | passed | brief.md | A11: 发布包内 CLI、生成 Runtime 和中英文 Skill 与源码一致；正常安装后支持 Hook 和无 Hook 的工作流都能取得新指引，安装测试不修改用户真实记忆。 | 当前 pnpm check:generated 通过，包含 Classic、Native 和 Entry/Hook Router。 |
| A12 | passed | brief.md | A12: 使用安装产物运行真实 Agent 的受控跨 change 场景：用户提供合格纠正，Agent 自主提交观察；独立成功 change 再次验证后晋级；后续任务实际采用并记录真实 application outcome。无偏好对照任务不产生垃圾记忆。 | Real 0.4.1 natural Agent evidence: first candidate-created, independent second change candidate-promoted, later proven-memory retrieval and used-successfully application outcome, plus no-preference control with zero memory pollution. |
| A13 | passed | brief.md | A13: 记忆评审、存储或远程故障不改变主工作流原有成功/失败退出结果；错误仍可通过诊断发现。 | 记忆故障被隔离，不改变主 workflow 结果，相关测试通过。 |
| A14 | passed | brief.md | A14: 无 change 的普通任务不新增自动观察；自动学习仅写当前项目，显式全局记忆仍正常工作，不混入其他项目或 Project Knowledge。 | 无 change 普通任务和无用户证据任务不自动新增学习。 |
| A15 | passed | specs/comet-memory-skill/spec.md | 单条合格观察可冷启动 评审包只有一条可信且可复用的用户协作偏好。评审允许创建隐式候选，Runtime 不立即晋级；第二个独立成功 change 提供一致证据后才有资格晋级。 | 单个合格观察形成 trial candidate，测试通过。 |
| A16 | passed | specs/comet-memory-skill/spec.md | 确定性与模型评审遵循同一边界 中文和英文正反样例覆盖首次候选、显式请求、一次性摘要、冲突和不安全内容。默认评审及真实模型分别验证，不用确定性测试冒充模型验证。 | Deterministic and real glm-5.2 semantic review evidence cover positive, one-time, injection/secret, correction, and explicit-memory boundaries; passed. |
| A17 | passed | specs/memory-experience/spec.md | 有可靠命中 - **WHEN** 用户以任务、路径、操作、类别、标签、关键词和作用域查询 - **THEN** 只返回 active、无未解决冲突、未被暂停且匹配的记录 - **AND** 结果遵守 maxEntries/maxBytes，排序稳定，记录内容来自权威状态 | 可靠命中和有界状态检索测试通过。 |
| A18 | passed | specs/memory-experience/spec.md | 无可靠命中 - **WHEN** 查询没有可靠匹配 - **THEN** 返回空结果并 abstain - **AND** 不注入泛化、冲突、inactive、tombstoned 或暂停记录 | 无可靠命中返回空结果并 abstain，测试通过。 |
| A19 | passed | specs/memory-experience/spec.md | 纠正与遗忘 - **WHEN** 用户显式纠正或遗忘一条记忆 - **THEN** 当前检索立即使用新内容或不再返回旧内容 - **AND** 旧证据和旧 Git 同步不能使已遗忘内容复活 - **AND** 用户可以查看历史并回滚，永久删除需要明确的管理操作 | 纠正、遗忘和历史状态测试通过。 |
| A20 | passed | specs/memory-experience/spec.md | 后台操作 - **WHEN** 后台评审、候选形成、重复计数或同步在运行 - **THEN** 默认不向普通消息输出过程 - **AND** 只有首次实际改变处理方式或发生冲突时才显示简短说明 | 后台 skip/deferred 诊断保持简短且不泄漏过程正文。 |
| A21 | passed | specs/memory-experience/spec.md | 语言选择 - **WHEN** 配置语言为 `zh-CN` 或 `en` - **THEN** 自动生成的用户可见内容分别使用中文或英文 - **AND** 直接输入正文不被静默翻译 | 中英文配置和 Skill contract 测试通过。 |
| A22 | passed | specs/memory-experience/spec.md | 同源管理 - **WHEN** 用户通过 CLI 修改记忆 - **THEN** Dashboard 后续读取到相同的权威状态、冲突、历史和同步状态 - **AND** 反向通过 Dashboard 修改也能被 CLI 读取 | CLI、Dashboard 和公开 plugin context 使用同一权威服务。 |
| A23 | passed | specs/memory-experience/spec.md | 手工编辑与同步失败 - **WHEN** 用户编辑、删除 Markdown，或专用 memory Git 同步失败 - **THEN** 下次管理/检索按确定性规则更新状态并保留必要历史/tombstone - **AND** 本地记忆继续可用，返回清晰的非阻塞同步状态 | 手工编辑和同步失败保持本地可用并返回诊断。 |
| A24 | passed | specs/memory-experience/spec.md | 同一任务的诊断一致 通过 CLI 提交观察后打开 Dashboard，同一任务显示相同的时间、归属、当前结果和简短原因；跳过或待重试不会显示成晋级。 | CLI 与 Dashboard 使用同一 status 数据路径，跨项目诊断隔离回归通过。 |
| A25 | passed | specs/memory-experience/spec.md | 远程不可用不伪造结果 远端支持诊断时读取真实值；不支持、超时或认证失败时显示不可用及原因，既不声称已开启/已学习，也不回退本地个人记忆。 | 远程不可用时返回可读失败状态，不伪造学习成功或回退本地。 |
| A26 | passed | specs/memory-workflow-integration/spec.md | 完成检查绑定当前观察 当前任务没有观察、只有其他 change 或项目的旧观察时，submitted 不能被标记为已验证。存在本任务已持久化观察时返回实际提交证明和候选、跳过或待评审状态。 | 当前观察和 submitted 检查绑定测试通过。 |
| A27 | passed | specs/memory-workflow-integration/spec.md | 四类工作流有条件提交 分别运行 Native、Classic、Hotfix、Tweak，有合格偏好和可信成功结果时提交当前项目观察；只有普通任务摘要时不生成偏好；无 change 的普通任务不新增学习。 | Native, Classic, Hotfix, and Tweak integration evidence covers conditional learning, trusted success binding, and no-observation ordinary tasks; passed. |
| A28 | passed | specs/memory-workflow-integration/spec.md | 安装后的真实 Agent 学习 通过正常安装的产物运行受控真实 Agent 任务。首次用户纠正由 Agent 自主提交为候选，独立成功 change 再次验证后晋级，后续任务检索并实际采用、回写真实 application outcome。无偏好对照任务不产生垃圾记录。分别记录真实宿主/model、Hook 和无 Hook 的验证证据，脚本直接提交不能替代 Agent 行为证据。 | Four real natural Agent logs establish autonomous first observation, cross-change promotion, later retrieval/application outcome, and a no-preference control with no scripted observe substitute. |
| A29 | passed | specs/self-evolving-personal-memory/spec.md | 显式记忆立即生效 用户要求记住一条全局偏好或项目命令。服务立即更新对应 Markdown 和 Runtime 元数据，下一次 `retrieve` 返回该内容及来源类型。 | 显式记忆立即写入并可检索，测试通过。 |
| A30 | passed | specs/self-evolving-personal-memory/spec.md | 两个独立成功 change 自动学习 两个不同 change 在成功检查点提供同一规范化行为且无冲突。第一次只保留候选，第二次后服务自动写入当前作用域，不要求用户确认；同一 change 的重复事件不改变计数。 | 两个独立成功 change 晋级且重复事件去重，测试通过。 |
| A31 | passed | specs/self-evolving-personal-memory/spec.md | 用户编辑高于自动更新 用户直接编辑或删除 Markdown 中的项目记忆。服务检测到文件指纹变化，把编辑视为显式纠正或移除并保留历史；旧观察不能直接写回被移除内容。 | 用户编辑和删除优先于旧自动观察，测试通过。 |
| A32 | passed | specs/self-evolving-personal-memory/spec.md | 作用域检索有界 项目任务按项目 key、路径和任务类型检索时返回相关项目记忆及适用的全局画像，不返回其他项目详情，并遵守固定条数与字节上限。 | 项目作用域检索和条数/字节边界测试通过。 |
| A33 | passed | specs/self-evolving-personal-memory/spec.md | Git 同步失败不阻塞任务 专用 Git 适配器报告 remote 不可用或冲突。服务保留本地文件和历史，返回可读诊断，后续 `sync` 可重试；当前 workflow 不因同步失败而失败。 | Git 同步失败不阻塞 workflow，后续可重试。 |
| A34 | passed | specs/self-evolving-personal-memory/spec.md | 插件公开接入 宿主用公开插件接口创建个人记忆插件描述符。插件只消费带来源事件、按作用域提供上下文并调用领域服务；停用或卸载后停止新处理但不删除记忆数据。 | 公开 plugin lifecycle 和 context 接入测试通过。 |
| A35 | passed | specs/self-evolving-personal-memory/spec.md | 中断后的观察恢复 观察已经持久化而评审暂不可用。新进程在既有同步入口恢复评审，成功后只记录一次处理与独立证据；主任务不因等待评审而无限阻塞。 | 待评审观察能在新进程恢复并只处理一次。 |
| A36 | passed | specs/self-evolving-personal-memory/spec.md | 本次跳过取代旧诊断 同一项目上次观察已经晋级，本次提交一次性摘要。当前任务和最近状态显示本次跳过及原因，不显示待重试或此前晋级；不增加成功证据。 | 本次 skip 替换旧诊断且不增加成功证据。 |
| A37 | passed | specs/self-evolving-personal-memory/spec.md | 恢复尊重用户修改 观察等待重试时用户暂停学习、纠正或删除目标记忆。恢复时按最新状态处理，暂停期间不学习，旧证据不覆盖显式纠正、不恢复已删除项。 | Natural control and recovery tests plus latest-policy handling confirm pause/correction/delete are respected during retry and old evidence cannot override them; passed. |
| A38 | passed | specs/self-evolving-personal-memory/spec.md | 旧状态兼容和并发去重 读取没有学习诊断的既有状态并并发重试同一观察，原记忆、候选和删除历史仍可用；诊断缺失显示未知，同一 change 的独立证据只计一次。 | 旧状态兼容、并发去重和单 change 证据计数测试通过。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| focused-memory-learning-regression | exec vitest run test/domains/comet-plugin/plugin-integration.test.ts test/domains/comet-memory/personal-memory.test.ts test/domains/comet-memory/memory-experience.test.ts test/app/personal-memory-command.test.ts | . | passed | 0 | 31356 ms |
| typescript-regression | exec tsc --noEmit | . | passed | 0 | 8979 ms |
| generated-runtime-regression | check:generated | . | passed | 0 | 2172 ms |

### Builder 报告的证据

以下为 Builder 报告，不等同于 Runtime 检查凭据或独立验收结果。

- focused-memory-plugin-cli-dashboard-tests: passed — 28 files; 427 passed, 4 skipped
- memory-service-regression-tests: passed — 个人记忆观察、恢复、跳过、submitted 绑定与计数回归通过
- typescript: passed — pnpm exec tsc --noEmit
- lint-and-architecture: passed — pnpm lint
- generated-runtime-check: passed — Entry、Native、Classic generated check
- package-install-e2e: passed — 0.4.1 package installed, routed, and verified across 37 Native platform targets
- dashboard-build: passed — pnpm build:dashboard after restoring the local pnpm store
- real-agent-model-eval: not-run — 当前环境未提供可复核的真实宿主、模型与 Hook/无 Hook Agent 执行证据
- 已知限制: A12/A28 的真实 Agent 自主观察、跨 change 晋级、后续实际采用和 application outcome 尚未由真实宿主/model 执行验证。
- 已知限制: Remote Provider 只完成协议兼容与不可用诊断测试，未连接真实远端服务。

## 阻塞项

_无。_

## 风险与跳过的工作

- Remote Provider service was not connected in this run; protocol and unavailable diagnostics remain covered by local tests.

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 0 | recovery | — | Native Shape artifacts changed | 2026-09-13T13:58:48.401Z |
| 2 | 1 | 1 | blocked | A5, A10, A12, A16, A27, A28, A37 | 当前候选的个人记忆观察、评审恢复、项目绑定、状态诊断、CLI/Dashboard/Remote 接入和生成产物检查已由 targeted evidence 支持；真实 Agent/model 闭环及恢复组合场景尚未完成，因此 Verify 阻塞，不能归档。 | 2026-09-13T14:37:37.388Z |
| 2 | 1 | 1 | recovery | — | 用户确认补齐真实 Agent/model 与组合恢复证据，完成后直接归档。 | 2026-09-13T14:40:41.070Z |
| 2 | 1 | 2 | execution-error | — | Native Verifier response was invalid: Native Verifier acceptance coverage is invalid (duplicate: none; unknown: A1, A2, A3, A4, A6, A7, A8, A9, A11, A13, A14, A15, A17, A18, A19, A20, A21, A22, A23, A24, A25, A26, A29, A30, A31, A32, A33, A34, A35, A36, A38; missing: none) | 2026-09-13T16:41:54.283Z |
| 2 | 1 | 3 | pass | — | All seven currently unresolved acceptance items passed. Existing 31 passed items are retained; Runtime checks for the current candidate all passed. Real Agent evidence completes the learning loop and no-preference control. | 2026-09-13T16:47:08.775Z |



## 结论

All seven currently unresolved acceptance items passed. Existing 31 passed items are retained; Runtime checks for the current candidate all passed. Real Agent evidence completes the learning loop and no-preference control.
