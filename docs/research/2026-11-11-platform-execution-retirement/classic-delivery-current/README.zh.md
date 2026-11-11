# Classic 交付测试迁移与独立 Review

授权来源：report:2026-11-10-agent-platform-execution。比较基线为 `630ce380787f446e803f94b4b90cbbdbf8663364`。本组只处理三个交付测试文件，不改其他已冻结组，也不改登记原字段或既有迁移节点。

原完整正文保存在三个 `*.test.ts.txt` 和 `tests.json`；`declaration-mapping.json` 保留 48 条原声明、各自完整正文及当前去向。当前为 49 条声明，新增一个显式批准旧 draft 的合法交付正例。`tests.patch` 是原正文到当前测试的完整差异，不以摘要替代旧断言归档。

## Review 结论

本组业务保留方向通过独立 Spec Review。退休的是普通流程的自动 peer-worktree 搜索、旧检查策略/glob、受管检查执行和对旧 draft 的自动内容 baseline 分类。真实 Archive 仍由 CLI 启动 OpenSpec，相关执行前准备、已启动后 unknown、显式恢复、原批准与恰好一次副作用断言保留；不能借撤掉普通检查而删除这些责任。

- **原批准与显式交付范围**：`hotfix()` 通过公开 `state propose-archive --delivery-path` 创建提案，再用原 `proposalHash` 决定同一 Archive Wait。源码 `classic-sdk-archive-preflight.ts` 从该已决定 Wait 的 `proposal.outputs[profile.archive.prepare]` 读取 `deliveryPaths`，不另建批准或结果 ledger。新正例确认该 Wait 已 resolved、包含三条实际选择路径，交付修改后的初始 draft，同时保留未选择的 `private-notes.ts` 原字节与未跟踪状态。遗漏已选择 draft 的反例仍拒绝。其标题改为 `requires delivery of an explicitly selected initial draft`，不再暗示旧自动内容分类仍存在。
- **默认排除与不信任公开 baseline**：未选择的原有 draft 仍以原字节留在工作区；公开 dispatch start 中伪造的旧 `workspaceBaseline.files` 不能让实际 `source.js` 被省略。受管检查策略/glob 不再决定当前交付文件，具体路径由原 Archive 提案承载。
- **明确工作区与无重复导入**：amend=false/true 场景在原 completed Run 所在 worktree 执行 next/checkpoint，保留完成状态与 select 拒绝归档需求。合并到 integration 的副本不再自动寻找另一个 worktree；它明确报告缺少原完成历史，保持归档字节、原 Run、不创建当地 owner，OpenSpec 实际调用仍只有一次。原 worktree 被删除后同样拒绝，不能从交付前 portable checkpoint 合成 done。
- **完整性不能靠缺历史错误代证**：综合 worktree 场景中，integration 的有效副本本来就因缺当地完成历史而拒绝；仅在该处改坏 hash 并观察非零退出，不能单独证明持有原 authority 时的完整性。因此 `classic-527-archived-copy-integrity` 同时精确选择 `rejects changed archived checkpoint and branch state after completed delivery`：它在真实原 completed Run 根修改 archived checkpoint hash/branch state，每次拒绝后原 Run 全等。
- **其余交付断言**：旧 Run 的跨 change 路径污染与越界仍拒绝；已接受归档材料/manifest 恢复不重复 OpenSpec；原 checkpoint 不因交付结果变脏；缺依赖在 claim 前保持 pending，启动后变更文件不能伪装成未执行；父级提交、merge/disconnected/foreign commit、私有草稿和符号链接边界保留。文件输入的单次 Git 批量查询预算与 staged/unstaged 删除正反例保留。

## 兼容影响

自动从 merged archived copy 搜索其他 worktree 并宣称 done 的行为明确退休。用户或父 Agent 应进入原 worktree，或从原工作区/备份恢复匹配的完成历史。当前副本缺少原历史时会明确失败；不将该变化描述为旧自动路由仍支持，也不通过导入归档前 checkpoint 伪造完成。

旧内容 baseline 自动判断“原 draft 是否发生实际修改”的合同退休。默认不交付旧 draft；若属于本次交付，由 Agent 将路径放进同一 Archive 提案，得到原业务批准后再交付。已批准选择的文件必须实际出现在交付提交中，其他旧文件保持不动。

## 登记追加

`operations.json` 提供四条完整 expectedEntry 的 CAS 追加计划，配置由 Root 应用，本子任务不写 `config/workflow-regressions.json`：

| 原 case ID                                   | 本节点类型      | 保留/替代目标                                                                     |
| -------------------------------------------- | --------------- | --------------------------------------------------------------------------------- |
| classic-527-archived-worktree-routing        | feature-removed | 明确原 worktree 的两种 amend 历史读取；副本禁止自动 peer 导入                     |
| classic-527-archived-copy-integrity          | tests-moved     | 上述两参数，加原完成 Run 的 checkpoint/branch 完整性反例                          |
| classic-527-missing-original-history         | tests-moved     | 两参数中缺原历史前后均拒绝、不导入、不假 done、不重放                             |
| classic-preexisting-workspace-delivery-scope | feature-removed | 默认排除、显式选择遗漏拒绝、同原批准实际交付、不动 private notes、拒伪造 baseline |

原来源、行为、预期、禁止结果、原测试、已有迁移链及未触及选择器全部保留。四个 evidence artifact 为 `registry.json`、`tests.json`、`mapping.json`、`tests.patch`；完成静态校验后冻结，不再格式化或覆写。

## 实际验证

三文件独立当前源码定向运行实际 **58 pass /0 fail /3 原平台 skip**，无收集错误：Archive preflight 为 16 pass/2 skip，delivery scope 为 35 pass/1 skip，delivery inputs 为 7 pass。运行期间修改的 draft 标题另以新精确选择器重跑，实际 **1 pass/0 fail/35 未选择**，没有把旧名称的执行记录冒充新选择器结果。

原始结果分别为 `independent-current-three-results.json` 与 `independent-renamed-draft-results.json`；汇总、skip 原因及静态校验见 `independent-review-results.json`。三项 skip 来自既有 Windows 可执行权限和文件符号链接条件，没有新增 skip 或缩窄原业务反例。

`publicStateRuntime` 只在临时 fixture 目录 esbuild 单命令入口，不运行仓库 build，也不写根 dist/assets。这属于当前源码与测试临时 CLI bundle 证据，不能替代正式构建或安装包验证。OpenSpec 由确定性测试脚本模拟，真实启动进程、移动文件并记录调用次数；未运行外部 OpenSpec 发布包或 Eval。两项 legacy deliveryInputs 场景在当前有效 Run 上模拟旧路径编码，不宣称是实际 0.5.0 发布 Run。

四条 CAS、登记结构、全部旧/新链 evidence 校验通过；`tests.patch` 在当前根 reverse 检查和原正文镜像 forward 检查均为 0。三个测试文件与本 README 的 Prettier 检查通过。未执行全仓库测试、真实平台 Hook、正式构建或安装包验证；Root 的批次构建与检查单独报告。
