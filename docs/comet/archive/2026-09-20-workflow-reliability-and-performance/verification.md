---
generated_from_state_version: 47
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 13
- 验证器尝试次数: 1
- 完成时间: 2026-09-20T03:55:53.377Z
- 摘要: 第 13 轮通过。Classic Hook 的 active/archive owner 检查已位于所有通用允许规则之前，18 项验收全部通过。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | 从检查通过开始，依次经历实现内容变化、Git 提交、进程重启、检查超时、重试耗尽、无关 change 损坏和归档后交付中断时，Runtime 只复用仍与当前输入一致的证据；每条自动 continuation 能执行或进入带合法出口的暂停状态；无关对象和可选插件不会阻塞当前合法写入，已完成的工作保持可恢复。 | 两组当前候选绑定的定向回执和三组生成一致性检查均通过；检查身份、恢复停止、归档交付、Hook owner 隔离和可选上下文路径共同满足连续操作的收敛与可恢复要求。 |
| A2 | passed | specs/workflow-reliability/spec.md | Classic 显式失败检查不能被自动发现的其他命令覆盖 - **GIVEN** 某阶段已经记录一个明确的 Runtime 检查要求，且其最新执行失败、失效或被中断 - **WHEN** Guard 评估是否可以离开该阶段 - **THEN** Guard 保留原检查身份和失败原因，不执行或采用另一条自动发现命令来替换它 - **AND** 返回的恢复动作针对原检查，且在当前 shell/平台可执行 - **AND** 只有从未声明检查要求时，自动发现才可以作为待用户或 Agent 执行的候选动作 | Classic Guard 保留显式检查要求及其最新失败、中断或失效结果，不以自动发现命令覆盖。 |
| A3 | passed | specs/workflow-reliability/spec.md | Classic 证据跨提交复用绑定检查时内容 - **GIVEN** 一个 Classic 检查已经成功并保存输入 manifest - **WHEN** 工作区内容发生变化后提交，使 Git 相对新 HEAD 再次 clean，或者切换到内容不同的分支 - **THEN** Runtime 比较当前内容与证据建立时的内容身份，不因当前 Git clean 而复用旧成功 - **AND** 只有提交元数据变化、实际检查输入内容不变时仍可以复用 | Classic 可复用证据绑定逐文件内容，只有实际输入内容不变时复用。 |
| A4 | passed | specs/workflow-reliability/spec.md | Native dirty 文件内容变化使检查证据失效 - **GIVEN** Native 候选的 tracked 文件已修改并通过 Runtime 检查 - **WHEN** 该文件再次修改，但 Git porcelain 仍显示相同的修改状态 - **THEN** dispatch、handoff 和 retry 都检测到内容身份变化并重新执行相关检查 - **AND** tracked、untracked、submodule 和声明的生成输入使用与其语义匹配的内容身份 | Native 输入指纹覆盖 tracked、staged、untracked、分支、dirty submodule 和声明的忽略生成输入。 |
| A5 | passed | specs/workflow-reliability/spec.md | 同一检查证据可以满足多个阶段要求 - **GIVEN** 相同 argv、cwd、输入内容、相关环境和检查语义的一次成功 Runtime 执行 - **WHEN** Build 与 Verify 都声明该检查满足自己的本地可重放要求 - **THEN** 两个阶段引用同一有效执行证据，不因阶段名称不同重复运行 - **AND** 独立 Verifier 的语义判断和不同检查要求仍分别执行 | 相同命令、cwd、内容、环境和语义可跨 Build 与 Verify 引用同一次成功执行，Verifier 判断仍独立。 |
| A6 | passed | specs/workflow-reliability/spec.md | 检查输出不构成自己的可变输入 - **GIVEN** 检查会生成时间戳、构建产物或其他声明输出 - **WHEN** Runtime 在执行前后计算输入身份 - **THEN** 声明输出不会仅因本次检查重写而使同一次成功执行无效 - **AND** 受版本管理的生成资产仍通过独立一致性检查验证 - **AND** 未声明的重复自修改会返回具体变化路径和配置动作，而不是无限建议重跑 | 声明输出从自身输入身份排除，未声明自修改返回具体路径和 outputs 配置恢复动作。 |
| A7 | passed | specs/workflow-reliability/spec.md | 恢复后保留已经固定的检查计划 - **GIVEN** handoff 已解析并持久化检查计划 - **WHEN** 进程重启、上下文压缩，或 Agent 通过 status、show、next、错误恢复重新取得 continuation - **THEN** Runtime 从持久状态与本机执行记录投影同一个计划或稳定 plan ID - **AND** 将返回模板原样提交时不会因空计划或不同计划而被 Runtime 自己拒绝 | 检查计划及稳定身份持久化，status、show、next 和恢复路径从同一记录投影。 |
| A8 | passed | specs/workflow-reliability/spec.md | 可重复检查耗尽次数后进入可恢复停止状态 - **GIVEN** 一项 repeatable 检查持续超时或执行中断并达到配置的尝试上限 - **WHEN** Runtime 处理最后一次中断结果 - **THEN** Runtime 不再返回必然失败的 retry-checks 动作 - **AND** 已通过检查证据保持不变，状态记录耗尽原因，并提供调整 timeout、修复环境或返回 Build 的合法出口 | 可重复检查耗尽三次后返回可恢复的 Build repair，并保留已有成功证据和耗尽原因。 |
| A9 | passed | specs/workflow-reliability/spec.md | 验收失败预算在阈值处产生有效状态 - **GIVEN** Builder handoff 检查连续失败并达到 `max_verify_failures` - **WHEN** Runtime 写入停止 blocker - **THEN** blocker、acceptance ID 和 loop 字段满足 portable schema，状态原子进入 await-user - **AND** candidate、失败摘要和已有证据保持可恢复，不留下 Verify active 的半提交状态 | 失败预算达到阈值时 blocker 和 acceptance ID 通过 portable schema，原子进入 await-user。 |
| A10 | passed | specs/workflow-reliability/spec.md | 用户批准的新目标使用新的失败预算 - **GIVEN** 当前目标已消耗部分失败预算 - **WHEN** 用户通过 revise-requirements 修改用户可见目标并重新确认完整 Shape - **THEN** 新 goal cycle 使用新的失败预算 - **AND** 原目标仅因实现或正式产物漂移返回 Shape 时保留原预算，不能借漂移无限重置 | revise-requirements 新目标重置预算，普通漂移继续保留预算。 |
| A11 | passed | specs/workflow-reliability/spec.md | 非语义格式变化不重置 Shape - **GIVEN** 完整 Shape 已确认并进入 Build 或 Verify - **WHEN** brief 或 Spec 只改变换行风格、文件末尾空行或行尾空白，规范化后的语义文字不变 - **THEN** Runtime 保留当前 goal cycle、acceptance、Builder handoff 和验证进度 - **AND** 范围、约束、验收、决定或其他语义文字变化仍返回 Shape 并要求重新确认 | Shape 内容身份规范化非语义空白变化，正文语义变化仍返回 Shape。 |
| A12 | passed | specs/workflow-reliability/spec.md | Classic 归档后待交付任务可以自然恢复 - **GIVEN** Classic 产物已归档，但授权范围内的 commit、push、PR 或交付核验尚未完成 - **WHEN** 进程重启或 Agent 查询当前任务 - **THEN** Runtime 能发现并选择该 pending delivery，不要求把 archived change 重新当成 active change - **AND** 只有交付达到授权范围内的终态后才清除恢复索引 | pending delivery 保留归档 change 的选择和恢复索引，授权交付终态后才清除。 |
| A13 | passed | specs/workflow-reliability/spec.md | 无关损坏 change 不阻塞当前合法写入 - **GIVEN** 当前 selection 和写入目标可以唯一归属到一个健康 change，项目中另有损坏或不兼容的 change - **WHEN** Hook Router 判断当前写入 - **THEN** Router 只深读目标 owner，依据该 owner 的 Guard 结果允许或拒绝 - **AND** 无关损坏由 Doctor 或状态列表报告，不扩大成当前写入失败 - **AND** 目标 owner 自身损坏时仍 fail closed | Classic Hook 在所有通用允许规则之前统一解析 active/archive target；跨 active owner、archive、嵌套 .comet/handoff 和 Windows 大小写变体均拒绝，无关 malformed change 不再被深读。 |
| A14 | passed | specs/workflow-reliability/spec.md | 可选插件工作不进入写入许可关键路径 - **GIVEN** Guard 已经允许写入，但 Personal Memory、Project Knowledge、学习、索引或 outbox 不可用、锁争用或超时 - **WHEN** Hook Router 返回写入决定 - **THEN** Router 在有界总预算内只读取已准备的上下文，并保留原许可决定 - **AND** 刷新、学习和 outbox 重放在任务边界或独立执行路径完成，其失败可诊断但不阻塞写入 | 同步写 Hook 不执行可选上下文收集，上下文失败返回有界诊断并保持许可决定。 |
| A15 | passed | specs/workflow-reliability/spec.md | 自包含 Runtime 使用构建时版本 - **GIVEN** Entry Runtime 被复制或安装到不含源码目录结构的位置 - **WHEN** 插件 bridge 需要当前 Comet 版本 - **THEN** Runtime 使用构建时注入或显式传入的版本，不从 bundle 相对路径猜测 package.json - **AND** 真实安装布局测试覆盖版本可用和插件上下文初始化 - **AND** 插件上下文失败提供有界诊断，不被完全静默吞掉 | Entry bundle 使用构建时注入版本，installed-only Router 不依赖源码 package.json。 |
| A16 | passed | specs/workflow-reliability/spec.md | 锁 owner 绑定具体进程实例 - **GIVEN** 锁文件中的 PID 已被操作系统复用给另一个存活进程 - **WHEN** Native 或插件锁诊断 owner - **THEN** Runtime 使用 hostname、PID 和进程创建身份区分原 owner 与新进程 - **AND** 只自动回收确认属于已结束进程实例的锁；身份未知时保留受控 repair，不按锁年龄强制抢占 - **AND** 锁忙、遗留锁和状态版本冲突返回不同错误类别及可执行恢复动作 | Native 和插件锁记录 hostname、PID 与进程创建身份，PID 复用和 unknown owner 使用正确恢复路径。 |
| A17 | passed | specs/workflow-reliability/spec.md | Skill 与 Runtime 使用同一检查和恢复语义 - **GIVEN** Agent 按中文或英文 Classic/Native Skill 推进 - **WHEN** 首次执行检查、跨阶段复用、恢复失败检查或归档交付 - **THEN** Skill 指令与 Runtime 行为一致，不要求先裸跑成功再重复录制，也不返回 JSON argv 伪装的 shell 命令 | 中英文 Skill 与 Runtime 的首次检查、跨阶段复用、精确失败恢复和归档交付语义一致。 |
| A18 | passed | specs/workflow-reliability/spec.md | 发布资产和连续操作回归保持同步 - **GIVEN** Classic、Native、Entry、插件或平台锁源码发生变化 - **WHEN** 构建和验证候选实现 - **THEN** 所有对应自包含 Runtime 由构建脚本更新且 generated check 通过 - **AND** 自动测试严格消费 Runtime 返回的 continuation，覆盖修改后提交、dirty 再修改、进程重启、超时耗尽、阈值边界、格式变化、无关损坏 change 和归档后交付中断 - **AND** 普通单元测试、生成资产、宿主 Hook、真实模型 Eval 和生产性能证据分别报告，不互相替代 | Classic、Native、Entry 生成一致性检查及两组共 484 项定向测试均通过，覆盖本次可靠性和连续操作边界。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| Focused workflow reliability regression suite | node_modules/vitest/vitest.mjs run test/domains/comet-classic/classic-executed-checks.test.ts test/domains/comet-classic/classic-command-checks.test.ts test/domains/comet-classic/classic-hook-guard.test.ts test/domains/comet-entry/hook-router.test.ts test/domains/comet-entry/hook-adapter.test.ts test/domains/comet-native/native-check-input-fingerprint.test.ts test/domains/comet-native/native-portable-runtime.test.ts test/domains/comet-native/native-lock.test.ts test/platform/process/process-identity.test.ts test/platform/plugin-store.test.ts test/repository/comet-entry-runtime-assets.test.ts test/domains/skill/workflow-optimization-contract.test.ts | . | passed | 0 | 89799 ms |
| Focused convergence and recovery regressions | node_modules/vitest/vitest.mjs run test/domains/comet-native/native-loop-runtime.test.ts test/domains/comet-native/native-cli-v4-surface.test.ts test/domains/comet-classic/classic-archive.test.ts test/domains/comet-classic/classic-current-change.test.ts test/domains/comet-native/native-doctor.test.ts test/scripts/transient-file-write.test.ts | . | passed | 0 | 250402 ms |
| Classic runtime generated consistency | scripts/build/build-classic-runtime.mjs --check | . | passed | 0 | 472 ms |
| Native runtime generated consistency | scripts/build/build-native-runtime.mjs --check | . | passed | 0 | 779 ms |
| Entry runtime generated consistency | scripts/build/build-entry-runtime.mjs --check | . | passed | 0 | 260 ms |

### Builder 报告的证据

以下为 Builder 报告，不等同于 Runtime 检查凭据或独立验收结果。

- Classic whitelist-order red-green regressions: passed — Installed-only Router tests for another active owner's .comet subtree and the archive .comet subtree both returned exit 0 before the fix and exit 2 after ownership enforcement moved ahead of whitelists.
- Focused Classic and Entry Hook tests: passed — 3 files passed: 108 tests passed and 1 platform-specific test skipped.
- Production build: passed — pnpm build completed successfully, including Classic, Native, Entry runtime bundles, TypeScript, and Dashboard assets.
- Generated runtime consistency: passed — pnpm check:generated passed for Classic, Native, and Entry bundles.
- Static and formatting checks: passed — pnpm lint passed with no errors and two existing Native unused-symbol warnings; pnpm format:check and git diff --check passed.
- Full repository test suite: not-run — Not run by explicit user instruction; focused tests were selected for the affected modules.
- 已知限制: The full repository test suite was intentionally not run at the user's request.
- 已知限制: No live third-party host Hook or real-model evaluation was run; installed-only generated Hook Router tests cover the packaged process boundary.

## 阻塞项

_无。_

## 风险与跳过的工作

- 按用户明确要求未运行仓库全量测试；结论基于当前候选绑定的两组定向 Runtime 回执、三组生成一致性回执和源码只读审查。
- 未执行真实第三方宿主 Hook、真实模型 Eval 或生产性能采样；installed-only 生成 Router 测试证明发布包进程边界。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 0 | recovery | — | Builder handoff Runtime checks failed: full-test | 2026-09-19T14:21:29.126Z |
| 1 | 2 | 0 | recovery | — | Builder handoff Runtime checks failed: full-test | 2026-09-19T15:02:59.536Z |
| 1 | 3 | 1 | fail | A1, A2, A4, A8, A12, A17, A18 | Return to Build to fix argv recovery rendering, dirty submodule fingerprints, passed-check preservation on retry exhaustion, and selection-owned delivery clearing. | 2026-09-19T15:25:07.355Z |
| 1 | 4 | 0 | recovery | — | Builder handoff Runtime checks failed: focused-regressions | 2026-09-19T15:51:01.210Z |
| 1 | 5 | 0 | recovery | — | Builder handoff Runtime checks failed: format | 2026-09-19T15:54:01.486Z |
| 1 | 5 | 0 | recovery | — | 格式化最终同步的 workflow contract 回归断言；需求与实现语义未变化。 | 2026-09-19T15:55:08.648Z |
| 1 | 6 | 0 | recovery | — | Builder handoff Runtime checks failed: build | 2026-09-19T15:56:18.624Z |
| 1 | 6 | 0 | recovery | — | 修复 Runtime 构建脚本在 Windows 短暂文件占用时直接失败：抽取共享写入重试并覆盖 Classic、Native、Entry builders，新增定向测试。 | 2026-09-19T15:59:06.024Z |
| 1 | 7 | 1 | fail | A1, A2, A15, A16, A18 | A4, A8, A12 and generated-file retry are fixed. Return to Build for interrupted Classic check identity, host-visible plugin initialization diagnostics with installed-layout coverage, and conservative lock handling when process identity is unavailable. | 2026-09-19T16:11:27.469Z |
| 1 | 7 | 1 | recovery | — | 继续修复实现：保留中断检查的原始命令身份；让插件上下文初始化失败产生有界宿主诊断并补安装布局覆盖；进程身份不可用时让锁进入保守 unknown 而不是仅凭 PID 判 active。 | 2026-09-19T23:18:40.399Z |
| 1 | 8 | 1 | fail | A1, A4, A6, A17, A18 | 当前候选未通过：A1、A4、A6、A17、A18 未满足。前次重点 A2、A15、A16 已修复；仍需修复 Native 忽略生成输入的错误复用、Classic 自修改检查的具体恢复诊断，以及中英文 Skill 的重复裸跑要求，并补充对应自动回归。 | 2026-09-19T23:44:03.566Z |
| 1 | 8 | 1 | recovery | — | 继续修复实现：让 Native 快速 gate 绑定被忽略但属于检查输入的生成内容；为 Classic 自修改检查返回具体变化路径和 outputs 配置恢复动作；同步删除中英文 Verify Skill 的重复裸跑要求。 | 2026-09-20T00:17:36.739Z |
| 1 | 9 | 1 | fail | A1, A13, A18 | 当前候选仍未通过。A2-A12、A14-A17 已有实现与当前候选绑定的定向证据；A13 仍遗漏 selected Classic 的定点 owner 路径，同 workflow 的无关损坏 Classic change 仍能阻塞合法写入，因此 A1 和 A18 也不能通过。下一轮应给 Classic 增加与 Native getNative 对称的 targeted owner/Guard 读取，并补一个健康 selected Classic + 无关 malformed Classic change 的生成 Hook Router 回归。 | 2026-09-20T00:44:15.630Z |
| 1 | 9 | 1 | recovery | — | 继续修复实现：采用与 Native 对称的 Classic 定点 owner 读取路径，避免明确 selection 时枚举无关 Classic change；补充健康 selected Classic 与无关 malformed Classic change 的 Hook Router 回归。 | 2026-09-20T01:44:10.469Z |
| 1 | 10 | 1 | fail | A1, A13, A18 | 当前候选未通过。iteration 10 修复了 selected Classic 被无关 malformed change 阻塞的问题，A2-A12、A14-A17 可通过；但 Classic Guard 未校验 change-dir 目标 owner 与当前 selection 一致，生成 Hook Router 可在 selected=A 时静默允许写入 B 的 tasks.md。需修复该跨 change 所有权边界并补 installed-only 回归，因此 A1、A13、A18 失败。 | 2026-09-20T02:09:37.242Z |
| 1 | 10 | 1 | recovery | — | 继续修复实现：在 Classic 目标归属解析后校验目标 change owner 与当前 selection 一致；跨 change 正式产物写入必须 fail closed，并补 selected A 写入 B tasks.md 的 installed-only Hook Router 回归。 | 2026-09-20T02:10:51.723Z |
| 1 | 11 | 1 | fail | A1, A13, A18 | 当前候选未通过：A2-A12、A14-A17 已有当前候选绑定的实现与定向证据；A13 仍存在 Classic change 根路径大小写和 archive 子树的跨 owner 绕过，因此 A1、A13、A18 失败。下一轮应使用平台一致的路径比较识别 changes 根，先解析并限制 active/archive 正式产物 owner，再应用阶段 allow 规则，并为 installed-only 生成 Router 增加 Windows 大小写路径与 archive 路径回归。 | 2026-09-20T02:30:27.867Z |
| 1 | 11 | 1 | recovery | — | 继续修复实现：集中解析 Classic active/archive 目标路径 owner，使用平台一致的大小写比较；目标 owner 与当前 selection 不一致时统一 fail closed，之后才应用阶段规则，并补 Windows 大小写与 archive 子树的 installed-only Router 回归。 | 2026-09-20T02:32:30.085Z |
| 1 | 12 | 1 | fail | A1, A13, A18 | 第 12 轮未通过。A2-A12、A14-A17 通过；A1、A13、A18 失败。应把 active/archive owner 检查前移到所有白名单之前，并补 archive 与其他 active owner 的 .comet 子树回归。 | 2026-09-20T02:55:04.727Z |
| 1 | 12 | 1 | recovery | — | 继续修复实现：将 Classic active/archive change 目标归属检查整体前移到所有 .comet、文档与配置白名单之前；统一拒绝其他 active owner 和全部 archive 子树写入，并补 installed-only Router 回归覆盖两类 .comet 路径。 | 2026-09-20T03:39:36.755Z |
| 1 | 13 | 1 | pass | — | 第 13 轮通过。Classic Hook 的 active/archive owner 检查已位于所有通用允许规则之前，18 项验收全部通过。 | 2026-09-20T03:55:53.377Z |



## 结论

第 13 轮通过。Classic Hook 的 active/archive owner 检查已位于所有通用允许规则之前，18 项验收全部通过。
