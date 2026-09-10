---
generated_from_state_version: 20
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 4
- 验证器尝试次数: 2
- 完成时间: 2026-09-10T13:56:44.560Z
- 摘要: 最终全新只读Verifier已读取原样dispatch、brief/四Spec、两页全部验收、实现与正式证据，A1–A26全部通过。复用完成全量与17项成功检查，以最终预算测试18项、格式和独立重算1507文件不变证明唯一失败已消除；性能/宿主/模型与原工作区lint边界如实保留。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1：legacy/docs 布局、空格和中文路径下，Agent 直接使用 Runtime 返回的路径引用登记 design_doc、plan 和任务 authority 均成功；默认布局说明与现有配置解析一致，越界和其他 change authority 仍被拒绝。 | Classic recovery 返回独立 artifactRefs；legacy/docs 中文空格路径回归实际登记并执行返回动作，既有 protected-path/authority 拒绝测试保留且完成全量通过。 |
| A2 | passed | brief.md | A2：同一合法设计在项目根和嵌套 src 运行 Build entry、Design transition/Guard 得到一致结果；显式检查 cwd 保持原有语义。 | Design evidence 与 Build entry 改用项目根受保护解析；classic-agent-cli-contract 对根目录及 src 的入口、恢复、complete-design 与 Build 检查取得相同成功结果。 |
| A3 | passed | brief.md | A3：设计已登记后中断，普通和冷恢复入口保留有效成果并只返回剩余动作；缺文件、过期 handoff 或错误归属得到准确诊断，不能清空有效设计或绕过确认。 | inspectClassicDesignReadiness 只观察 metadata/文件/hash；普通和冷恢复保留有效设计，返回剩余 complete-design，错误归属精确失败，协调操作保留既有 Guard 与授权语义。 |
| A4 | passed | brief.md | A4：Classic 快捷/完整入口对四个 --comet-* 参数、COMET_TASK、help、-- 分隔符及成功/失败结果等价；需要记录的成功检查点恰好一次进入公开插件 Bridge，插件失败不改变主命令结果。 | 快捷入口注入同一 runClassicFacade，集成参数在 -- 前解析；完整门面及插件测试覆盖 COMET_TASK、四参数、help、字面子参数、恰好一次记录及插件失败隔离。 |
| A5 | passed | brief.md | A5：从 docs 布局项目根按 OpenSpec adapter 返回动作依次执行 new、status、instructions，始终定位同一 change；上游原结果与退出码仍可读取，JSON 既有消费方式保持兼容。 | OpenSpec --agent-json 返回控制 cwd 与 adapter argv，保留 upstream cwd/data/stdout/stderr/exitCode；默认原始输出不变，实际 new/status/instructions 与 adapter 回归完成。 |
| A6 | passed | brief.md | A6：Windows 实际受支持 Node CLI/shim 的空参数、空格、中文、引号、反斜杠、百分号、感叹号和 & 按字面传递；fixture 环境变量不被展开，未知且不能安全解析的 shim 明确失败；非 Windows 继续直接传 argv。 | resolveNodeCliCommand 用 shell:false 执行受支持 Node/npm/pnpm shim；Windows 字面参数和 NODE_PATH 测试覆盖特殊字符，未知 shim 明确拒绝，非 Windows argv 保持直接传递。 |
| A7 | passed | brief.md | A7：Classic 非法参数、入口失败和 Guard 失败直接提供可解析的错误代码、字段/期望及安全恢复动作；整体失败不因内部子检查 passed 而被误判，Agent 不必解析 ANSI 或二次解码 JSON 字符串。 | Classic issues 提供稳定 code、field、actual/expected/remediation；入口及 Guard 整体退出码独立于子检查 passed，JSON 直接暴露结构化诊断。 |
| A8 | passed | brief.md | A8：Native Build、dispatch、等待 Verifier 的每个输入选项均是一份可独立提交的对象；按返回条件选项并只填写业务字段，可完成正常流程及 request-checks/error/unavailable 分支。 | individualRunnerInputs 将互斥模板分别投影为对象并标记 exclusiveGroup/描述；公开 Native 生命周期测试执行正常、request-checks、error、unavailable 输入及绑定。 |
| A9 | passed | brief.md | A9：Native 错拼、缺失或额外字段返回准确路径和 missing/unknown 信息及当前输入结构；有效 UTF-8 BOM 文件成功，非法 JSON 和错误验收字段仍拒绝。 | NativeInputValidationError/共享 exactKeys 提供 nested JSON pointer、missing/unknown/expected；BOM 输入回归通过，非法 JSON 与验收字段严格校验未放宽。 |
| A10 | passed | brief.md | A10：Supervisor Builder、checks、Verifier 和 integration 的任务返回完整控制目录、实现目录、回报 argv 与预填身份模板；按任务包回报成功，过期 runId 和错误候选仍拒绝。 | projectNativeSupervisorTask 包含实现 projectRoot、controlProjectRoot、完整回报 argv 与预填 child/runId/acceptance/receipt；Supervisor 回归涵盖 checks、集成和过期候选拒绝。 |
| A11 | passed | brief.md | A11：new/status/next 提供统一且有界的 Agent 观察与执行上下文，旧 data 保持兼容；成功变更后直接消费返回的下一步，只有恢复、并发失效或外部变化才重新查 status；跨 worktree 不需要猜 cwd。 | 统一 agent 投影使用实际 executionCwd，selected worktree 回归覆盖跨工作区；Classic set 保留 data.updated 并增补恢复观察，Native 保留旧 data，Skill 消费成功返回的下一步。 |
| A12 | passed | brief.md | A12：Classic 同一授权边界内的成果登记、handoff 和阶段推进可恢复地协调，失败保留成果和证据；连续成功阶段不要求重复 next/entry/逐字段 get，Open 未发生修改的首轮 status 和同次操作的上游读取可复用，变更后重新验证。 | complete-design 协调登记/handoff/Guard 并支持完成后的幂等重试；失败保留成果，命令级内容指纹缓存与 Open 首轮 status 复用在源变化后失效。 |
| A13 | passed | brief.md | A13：固定空上下文 task 场景中同一项目的身份解析有 origin 最多一次 Git、无 origin 最多两次；ID、名称、插件记录和工作区索引归属不变，下次调用修改 remote 能重新解析。 | request-scoped identity observation 保留原 identity/name 算法且 finally 清空；当前正式基准 task origin 为1Git、无origin为2Git，remote 变化与记录作用域回归通过。 |
| A14 | passed | brief.md | A14：1/10/30 个真实 worktree 各有一个唯一活跃 change 的场景，查询同一目标 Git 次数不随无关 change 增长且最多五次；不深读无关 Runtime，列表只投影当前页，仍正确检测同名活跃/归档关系与冲突。 | 命名发现先按名称筛选，列表仅深投影当前页，共享 worktree Git观察；1/10/30真实 worktree 正式基准均2Git，同名活跃/归档冲突及跨工作区测试通过。 |
| A15 | passed | brief.md | A15：有效 Shape prepare 的 Git 调用从九次减少至最多七次，同机同 fixture 中位耗时下降；写入前、锁内绑定和外部并发变更的必要校验继续有效。 | Shape 仅需 branch 的路径减少完整查询而保留锁内和写入绑定；同机成功 fixture 公共 next 为949.8ms/7Git，对照1060.0ms/9Git。 |
| A16 | passed | brief.md | A16：已配置项目的公开 workflow resolve --activate 走契约完整的快路径，零 Git；与完整门面的输出、退出码、激活副作用一致，未初始化/部分/非法配置、重复激活、context/help/未知参数都得到正确处理。 | 配置有效的 activation 走 package-owned 快路径，正式基准0Git；公开/完整门面对照覆盖重复、非法/部分配置、context/help/未知参数及实际 Hook 安装副作用。 |
| A17 | passed | brief.md | A17：基准使用隔离 HOME/cwd 的合法状态；spawn 错误、超时、非预期退出或错误后置状态使检查失败且不能覆盖基线；记录命令、构建身份、样本/预热、输出字节和 Git 数，状态复原在计时外。 | v2 benchmark 隔离全部用户配置/缓存与Git环境，验证退出和持久后置状态，计时外复原；失败/超时/错误状态不得写基线的回归通过，正式15目标各5成功样本。 |
| A18 | passed | brief.md | A18：Eval 保留可用的 invocation/tool ID、开始/结束/耗时、退出码、错误分类和时间来源，正确处理并发交错、重复和中断；缺失值保持未知，只有明确证据才关联重试，工具往返时间不冒充 Runtime 时间，旧事件兼容且凭据不落盘。 | Eval 按 invocation/session/tool identity 配对，显式 retry_of 才关联；时间来源与 tool-round-trip/runtime 区分，缺失保持未知，重复/中断/Classic错误/redaction及隔离shell共88测试通过。 |
| A19 | passed | brief.md | A19：回归验证状态版本、runId、候选/回执、完整验收、路径保护、同名归档身份、锁和插件失败隔离；不存在因性能修复而放宽的错误放行。 | 完成全量中的生命周期/锁/路径/归档/插件安全回归通过；源码仍校验 stateVersion、runId、candidate、完整acceptance和正式receipt，不以性能缓存跨越写入授权边界。 |
| A20 | passed | brief.md | A20：中文产品 Skill 先完成后同步英文，两者命令与行为一致；源代码、公开 CLI、生成 Runtime 和实际打包资产一致，相关格式、lint、构建、生成一致性与全量测试完成并如实记录。 | 双语Skill、实际build、source lint、Git交付快照架构、格式、三Runtime生成一致性与37平台打包验证完成。全量4862通过/1预算失败/57跳过；唯一度量误报修正后正式18测试与格式通过，独立复算确认其余1507文件不变，组合证据充分；不将原全量称全绿。 |
| A21 | passed | brief.md | A21：全部原始失败/纠正链用实际 CLI 复验，热点采用相同环境和成功 fixture 前后对照并满足进程预算；提供覆盖每项验收的证据，模型总时间收益没有数据时不作结论。 | 实际CLI纠正链、发布入口与成功fixture基准记录覆盖审核项；15目标满足进程预算。报告公开Classic恢复插件后的耗时增加及模型总时间收益未测量，没有推断用户三分之一比例。 |
| A22 | passed | specs/native-status-output/spec.md | 默认 status 返回紧凑摘要 - **Given** 一个 change 包含大量验收、历史、Builder 交接和验证结果 - **When** 客户端请求命名 change 的默认 `native status` - **Then** 响应只包含名称、phase、status、stateVersion、循环摘要、验收计数、未解决 ID、verificationResult、阻塞摘要、工作区摘要、本机操作摘要和 continuation - **And** 不内联验收正文、完整 Builder 交接、完整验证结果或历史列表 - **And** Supervisor 默认状态不内联全部 Child 详情，只保留有界摘要与 ready Child 名称 | 默认命名status与Supervisor使用紧凑有界投影，不内联完整acceptance/handoff/history；既有Native status输出契约在完成全量中通过。 |
| A23 | passed | specs/native-status-output/spec.md | details 使用固定大小分页 - **Given** 验收、历史、Builder 交接或验证详情超过一页 - **When** 客户端请求 `native status <change> --details` - **Then** Runtime 返回稳定顺序的一页带类型详情项、当前状态版本、可选下一页 cursor 和完整下一页命令参数 - **And** 后续页面不会重复或遗漏同一状态版本的数据 - **And** cursor 与当前状态版本不匹配时返回清晰的过期提示 | details 固定分页含stateVersion/cursor/nextPageArgs且保留过期校验；本次只读按两页读取完整26项并到nextCursor:null，相关分页回归通过。 |
| A24 | passed | specs/native-status-output/spec.md | next 不复制完整 portable state - **Given** Runtime 执行任意会改变 Native 状态的 `next` 动作 - **When** CLI 返回成功结果 - **Then** 结果包含与默认 status 相同的紧凑 state 摘要及最新 continuation - **And** 不把 `comet-state.yaml` 中的完整 acceptance、history、Builder handoff 或 verification 复制到响应 | Native next继续投影紧凑state与最新continuation；portable runtime及CLI表面回归覆盖状态变化，不复制完整portable state。 |
| A25 | passed | specs/native-status-output/spec.md | Verifier 按范围读取验收详情 - **Given** Runtime 准备分派一个新的 Verifier - **When** 生成 verifierDispatch - **Then** 分派内容包含当前验收范围 ID、验收总数、brief/Spec 引用、详情页读取命令、Builder 审查摘要和 Runtime 检查摘要 - **And** 不内联完整验收正文 - **And** Verifier 可以通过详情页读取当前状态版本对应的全部范围内容 | 当前原样verifierDispatch提供26 scopeIds、全部Spec/brief、detailsPageArgs和有界review/check摘要，无验收正文；两页可完整读取当前版本范围，契约回归通过。 |
| A26 | passed | specs/native-status-output/spec.md | 帮助和 Skill 默认使用紧凑入口 - **Given** Agent 创建、恢复或推进 Native change - **When** 中英文 Skill 或 CLI 帮助指导其读取状态 - **Then** 默认使用紧凑 status/next 结果 - **And** 只有 Shape、Review、Verify 或诊断确实需要正文时才读取 details 分页 | 中英文Skill及CLI帮助默认使用紧凑status/next，成功后直接消费返回动作，仅需要正文的Shape/Review/Verify/诊断读取details；18项Skill契约最终正式通过。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| budget-hash-proof | C:/Users/BENYM/AppData/Local/Temp/comet-cli-repair-final/verify-budget-hashes.cjs | . | passed | 0 | 494 ms |
| native-skill-final | node_modules/vitest/vitest.mjs run test/domains/comet-native/native-skill.test.ts | . | passed | 0 | 2172 ms |
| final-format | C:/Users/BENYM/AppData/Local/Temp/comet-cli-repair-final/format.cjs | . | passed | 0 | 4758 ms |

## 阻塞项

_无。_

## 风险与跳过的工作

- 未执行真实模型前后对照或真实宿主 Hook；37 平台证据仅证明打包安装与路由，不能证明所有宿主执行或用户三分之一纠正成本下降。
- Classic current/next 恢复原快捷入口遗漏的插件后为760.2/713.7ms，对照245.9/168.1ms；行为不完全等价且实际较慢，未宣称这两条提速。
- 原工作区既有忽略目录 .codex-remote-attachments 仍使架构 lint 失败；交付快照通过，不能称原工作区 pnpm lint 全绿。
- 完成全量为4862 passed、1预算测试failed、57 skipped；预算测试修正后的18项正式检查及1507文件不变哈希消除了该唯一失败，未重跑完整套件。
- 曾有Windows UNKNOWN(-4094)构建失败及中断检查；后续独立完整build成功，原因未证实。早期Eval PATH隔离不足超时，无法事后断言未启动真实CLI；后续fixtures隔离并断言假CLI。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A11, A19, A20, A21 | 候选 08c3d1d7-cc81-4210-8068-612baa4fa598 的独立验收失败：A11、A20 failed；A19、A21 blocked；其余 22 项 passed。确定的产品问题是新增 Classic 观察覆盖既有 data.updated；另须修复测试 fixture 与 Skill 契约同步、三文件格式，并明确 website 失败边界后重新提交候选。 | 2026-09-10T12:40:32.963Z |
| 1 | 2 | 1 | execution-error | — | Native Verifier response was invalid: Native fail requires at least one failed acceptance criterion | 2026-09-10T13:07:10.779Z |
| 1 | 2 | 1 | recovery | — | 恢复构建后修复验证计划：先验证公开CLI产物，再运行全量；既有候选的检查计划不可更改，返回Build重新提交，产品代码不变。 | 2026-09-10T13:09:29.139Z |
| 1 | 3 | 1 | fail | A20 | 独立验收通过 A11、A19、A21；A20 因唯一明确的 Native Skill 物理行预算测试失败而未通过，返回 Build 修复该测试指标并验证。 | 2026-09-10T13:42:41.151Z |
| 1 | 4 | 1 | recovery | — | Repair verification passed for A20; final full verification is required. | 2026-09-10T13:51:40.673Z |
| 1 | 4 | 2 | pass | — | 最终全新只读Verifier已读取原样dispatch、brief/四Spec、两页全部验收、实现与正式证据，A1–A26全部通过。复用完成全量与17项成功检查，以最终预算测试18项、格式和独立重算1507文件不变证明唯一失败已消除；性能/宿主/模型与原工作区lint边界如实保留。 | 2026-09-10T13:56:44.560Z |



## 结论

最终全新只读Verifier已读取原样dispatch、brief/四Spec、两页全部验收、实现与正式证据，A1–A26全部通过。复用完成全量与17项成功检查，以最终预算测试18项、格式和独立重算1507文件不变证明唯一失败已消除；性能/宿主/模型与原工作区lint边界如实保留。
