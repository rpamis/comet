# Native worktree 与批准前 Spec 修订测试输入迁移

授权来源：report:2026-11-10-agent-platform-execution。本批只改 native-parallel-worktree.test.ts 与 native-document-constraints.test.ts 各一个测试的合法输入，并补同案缺授权绑定时的禁止反例。没有改产品、生成物或 registry，没有删除/skip 原断言。原两文件完整正文冻结在 tests.json，独立差异见 patch.patch。

## 原失败与当前事实

两个精确原用例 two-before.json 都失败，原因同为现有边界拒绝用户决定缺少 --expected-state-version 和 --expected-action，分别发生在 revise-implementation 与 revise-requirements。没有到达原用例后续业务断言，不是业务源码、内容快照、自动 phase reset 或 worktree 隔离回归。

修订从实际当前 status/state 取得版本并携带既有 action 名称，没有绕过 User decision 校验。原不带绑定的命令继续在同案中作为反例，必须拒绝且原状态字节不变；模拟用户输入显式标注 SIMULATED。

## 保留的业务

真实 linked worktree 用例仍运行现有发布命令 bundle，由真实 Git 建立两个不同分支与目录、并发推进各自的 Shape 批准与 Build→Verify。保留 Guard revert 禁止实现写入、真实人工 source edit、明确要求返回 Build 并重新 handoff 后进入 Verify、用户源码原字节、另一 worktree 实现和 state 不变、独立 workspace Runtime、各自 selection/分支、主仓库无两个 change 文档目录和无残留业务事务。人工编辑后不会因自动扫描文件而回退；只有绑定当前版本的明确修订决定推进。

Shape 用例仍先声明真实 original Spec，真实删除并写入 replacement Spec，显式退回需求整理再准备确认；原精确 spec_changes 指向 replacement 且仍 phase=shape/status=await-user，不提前进入 Build。补实际旧 Spec 目录已不存在、replacement 文本确实保留、缺绑定修订不写正式 state 的断言。相邻已批准目标不可误替换、豁免不能吞目标、SDK 修订等原用例正文未改。

## 验证

- two-before.json：原两项 0 passed / 2 failed。
- two-after.json：修订后精确两项 2 passed / 0 failed。
- files-after.json：两个文件完整 10 passed / 0 failed / 0 skipped，含 registry 所需相邻 Spec 边界及旧 checkpoint bundle 拒绝。
- 两个测试文件 Prettier 检查通过。
- 未运行整个 Native module；未 build、安装、真实平台 Hook、模型或容器 Eval。此处 Hook Guard 只通过 bundle 显式调用，不等同平台事件安装验证。

## 登记与链

受影响有效目标共四个 ID：current cases 的 native-explicit-pending-shape-retarget、native-516-shape-retarget-declared-spec；historicalTestMigrations 的 native-236-linked-isolation、native-302-prepare-route。当前两个新增首段 tests-moved，历史两个在原段末端追加 supersededBy；保留所有原 ID/来源/字段、既有迁移及全部其他选择器和 requiredNames。原始历史清单不改。

cas-plan.json 提供每条原 record expected 与 next，按各 collection/ID 深等 CAS 应用，不整文件覆盖登记。draft-subset.json 只供 schema 与四 artifact 连原链验证。registry/tests/mapping/patch 的内容摘要在新 migration.evidence 中，不改变前轮冻结的 history existing-run 证据。

历史两个 ID 的末端还引用三份本批未修改的外部测试：native-cli-v4-surface.test.ts 的 requires workspace isolation before creating a second current-workspace SDK change，native-status-v4-discovery.test.ts 的 finds an SDK-owned Native change with its explicit linked-worktree project root，以及 native-workspace-preparation.test.ts 的 reuses and validates an already prepared linked worktree / creates, resumes, prunes, and excludes an isolated worktree。全部 selector 原样保留并冻结完整正文（CLI4 使用其负责 Agent 本轮修改前原始副本，其他两份在本批未改时完整冻结），未在本批执行，不能将本批 10/0 说成这四个 ID 的全部跨文件验证已过；Root 后续整体验证继续覆盖它们。四 ID 的 schema、原链和完整旧 target 正文 hash 校验已经实际通过。
