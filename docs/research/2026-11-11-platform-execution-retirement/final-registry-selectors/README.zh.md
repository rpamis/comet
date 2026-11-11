# 最终回归选择器核对

授权来源：`report:2026-11-10-agent-platform-execution`。用户要求物理撤下普通 Native/Classic 检查执行器、监管和内容证明，保留业务批准、原任务、完整验收与真实 CLI 自有进程清理。这里仅核对相应回归的最终执行目标；进程半秒验收的用户批准与变更由 `approved-timeout` 独立记录，不混入本批。

原始完整登记保存在 `registry.json`；核心组原始脚本全文保存在 `original-core.json`。它们记录本轮选择器修正前的实际工作区，包含此前已经审计的迁移链，禁止据此重写或删除旧来源。

第二轮完整测试虽已实际收集 8755 项测试，仍有最终登记引用已退休或改写后的旧测试名。官方新归档案例执行 6 项通过，却因同文件的旧 requiredName 不存在而失败，说明“结构与原迁移 evidence 通过”和“最终回归确实可执行”是不同证据。

只读调查记录：`coverage/platform-execution-round2-registry-missing-audit.json`。该记录包含第二轮之后新增的两个归档测试，它们已单独实际通过，不能当作陈旧目标迁移。

处理原则：逐项核对旧完整正文与当前可观察断言；沿原迁移链追加，不覆盖旧登记或先前迁移；保留未受影响目标；区分执行器退休和业务行为仍需覆盖。旧定义、检查计划、锁、跨 worktree 自动搜索与内容指纹不因登记遗留而恢复。

核心组 `classic-composed-timeout` 原来要求组合 Classic 的受管检查时限测试。这一执行职责已按用户授权移交 Agent 平台；核心组 ID 保留，改执行三项已有平台报告业务测试：成功报告绑定原任务、真实失败不能进入验收、陈旧领取或结果不能推进。原脚本完整正文保留，不将其描述成旧检查时限仍受 Comet 执行器保证。CLI 自有进程的独立时限与真实整树停止仍由单独进程测试覆盖；已获用户批准的量化保证变更见 [approved-timeout](../second-full-suite-followup/approved-timeout/README.zh.md)，不混入本轮选择器修正。

实际运行 `pnpm test:core-regressions --case classic-composed-timeout` 退出 0：聚合执行 11 项通过，15 项未选中；包含上述三项及同文件合并的 8 项原业务验收。日志 `coverage/platform-execution-registry-classic-composed-core.log`，报告 `coverage/core-regressions/classic-composed-timeout.json`。没有降低 `minimumPassed`，没有把过滤未执行项记为通过。

其余最终选择器已准备逐项映射，覆盖 83 个当前 case 和 12 个历史 case，共 95 项链尾追加操作；56 个去重旧目标涉及 33 个原测试文件。两个第二轮之后新增的归档测试保持原登记；已获用户单独确认的进程验收变更也不混入这批迁移。当前完整登记及每个受影响条目的原链分别保存在 `registry.json`、`effective-registry.json`。

`mapping.json` 的 `targets` 逐项说明保留的业务行为、按用户授权退休的职责、当前精确测试及证据边界；`cases` 与 `caseChanges` 绑定原 case ID 及替换目标。没有修改其他原字段，未受影响的选择器原样保留。所有新尾部均为 `tests-moved`，没有借此将仍保留的业务附加验收整体豁免。

`tests.json` 保存 33 个原文件的完整可信版本，另存与其不同的实际当前版本，注明各自来源，不拼接成一个假历史文件；已有多轮冻结正文仍沿原链保留。`tests.patch` 来自这些真实旧正文与当前正文的实际差异。

旧 v4 定义选择的完整正文此前未保存在该轮 snapshot 中，已从本任务原工具记录恢复：将真实基线 `630ce380787f446e803f94b4b90cbbdbf8663364` 及当时四个实际成功的补丁严格重放到隔离诊断目录，四项全部成功。格式归一后，恢复版本的前 110 行与当时一次读取逐字相符，后续版本的前 50 行与另一次读取逐字相符。完整恢复正文、实际补丁和实际读出片段冻结在 `recovered-definition.json`。不是把当前两个测试改名冒充旧断言，也不恢复旧定义 hash 目录或执行器。

独立 Spec 核对发现的实际业务覆盖缺口已补上：在目录移动持续失败、Spec 已真正发布后，向正式 Spec 追加独立内容；解除占用恢复及重复归档均须保留原字节与事务 ID。加强后的测试实际通过，报告 `coverage/platform-execution-archive-sharing-canonical-edit.json`，没有用一般归档成功案例代替该行为。

操作保存在 `coverage/final-registry-selector-operations.json`。Standards / Spec 两轴独立 Review 均通过后，已使用既有 CAS 合并脚本逐条追加，报告 `coverage/apply-final-registry-selectors.log`。全部原字段和既有链保留，结构及全部迁移 evidence 检查通过；没有重写冻结历史登记。

只读逐断言核对见 `coverage/proposed-final-registry-assertion-audit.json`：664 个有效条目共 3126 个要求，全部名称都能对应到真实报告；3125 项要求有实际通过记录，一项正式归档 manifest 文件 symlink 反例在 Windows 属原有跳过，不计为通过。这里复用第二轮及后续定向报告，只说明逐断言对应关系，不是新的一轮全量测试。最终官方回归入口和第三轮完整测试仍待取得结果，不能提前声明全量通过。
