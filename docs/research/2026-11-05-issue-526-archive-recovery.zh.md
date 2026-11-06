# Issue #526：归档拒收后的恢复

来源：[Issue #526](https://github.com/rpamis/comet/issues/526)，以及 [2026-11-05 新评论](https://github.com/rpamis/comet/issues/526#issuecomment-6646478011)。比较基线：`895fc96496403127ab580a08220745ce543bb148`，分支 `052`。本机 Windows，Node 22.20.0。

## 已复现与未复现的行为

- **已复现：结果拒收后无法恢复。** 在隔离 Git 项目中通过 Runtime 正常完成 Shape、Builder 提交、确定性检查、模拟独立 Verifier 回报和用户接受，再运行真实 Archive 执行器。仅在结果校验器注入一次拒收，构造报告中的 `running + rejectedOutcomes` 状态。`archive.execute` 和 `archive.finalize` 都返回了结果，但公开 `archive --recover` 返回 73，提示没有单一可恢复 Action。此复现证明拒收后的恢复缺口，不能证明最初拒收的触发原因。
- **未复现：新建未跟踪 Spec 导致正常归档候选漂移。** 当前分支和从 npm 下载的 `@rpamis/comet@0.5.1` 都通过了普通 Git 首次归档。旧包另测 Git 在 Shape 前已存在、Spec 操作为 `create`、执行一条真实 Node 检查后归档，也通过。没有运行报告者的 Maven、数据库清理及前端项目，未取得其 checkpoint、原始输入摘要和事务文件，不能断言原始候选漂移已解决。
- 报告者手工移动目录、暂存并提交后留下的历史现场未取得。本次用实际 finalize 完成后拒收回报验证持久收据恢复，不声称已经验证其手工搬迁后的现场。

## 根因和方案

公开恢复命令只把已返回但被拒收的 `archive.prepare` 从 `running` 转为 `unknown`。`archive.execute`、`archive.finalize` 未覆盖，后续筛选只接受 `unknown`，因而形成死锁。

修复沿用这个入口，只接受内置 Archive step、tool ref、executor 匹配，且拒收结果的 Action ID、attempt、inputHash、claimToken 全部对应当前执行的记录。使用原 revision 将同一 Action 标为结果未知，再走既有事务或持久收据核对。恢复不创建替代 Action，不把失败回报直接当作成功，不降低候选、Spec 或归档材料校验。没有匹配拒收记录的活跃执行仍保持阻塞。

不改变 SDK 通用拒收规则；其他执行器的拒收不能据此自动重试。归档产生的材料继续由现有事务和候选绑定逻辑验证，本次没有扩大文件排除范围。

## 验证记录

1. 基线新增的两个公开恢复断言均失败，错误为 `no single recoverable delivery, Archive, or cleanup Action`。同样的真实执行后拒收场景也在 npm `0.5.1` 上确认其恢复入口失败。旧包测试读取该发布包的 `dist/` 模块，使用该版本 tag 的测试夹具；夹具中的 Agent 和用户回报均为确定性模拟。
2. 修复后恢复断言覆盖 apply、finalize 已完成持久收据、finalize 写入前返回 `candidate-drift` 失败且原事务仍在三个场景。apply 走公开 CLI，finalize 走生成的 `comet-native-archive.mjs`。均核对原 Action/claim/attempt、拒收历史、Spec mtime、唯一 apply Action 和重复恢复。apply 恢复前插入实现漂移，验证仍拒绝；恢复原内容后继续成功。
3. 定向相邻验证包含普通 Git 归档、finalize 前实现漂移及恢复、旧 finalize 在目录移动后恢复。编排反例覆盖缺少拒收记录、错误 Action、attempt、inputHash、claimToken、executor 和 tool ref。
4. 编排测试原夹具缺少 Run `input`，基线原文件 29 项中 17 项因读取 `input.task` 失败。只补齐合法夹具输入后，该文件与发布元数据测试合计 40 项通过；未为此修改产品 continuation 行为。
5. `pnpm build`、`pnpm check:generated`、badcase 基线保留检查、受影响文件 Prettier 和 `git diff --check` 通过。`pnpm lint` 的 ESLint 部分无错误、有 8 个现存 Dashboard 警告；架构检查被工作区顶层 `.ruff_cache` 非许可目录阻断。保留该无关目录，没有删除它来换取通过。
6. `pnpm test:core-regressions --case native-archive-rejected-apply-recovery --case native-archive-rejected-finalize-recovery` 将精确案例合并到了较大的既有历史测试组；发现实际范围后停止该进程树，该次登记执行器运行未完成，不计为通过。上述新案例及相邻断言使用 `vitest -t` 精确执行并取得结果。
7. 最后一轮精确执行 `vitest run test/domains/comet-native/native-sdk-application.test.ts -t 'recovers a returned but rejected' --reporter=json --outputFile=coverage/issue526-archive-recovery.json`，三个恢复场景全部通过；每个场景还断言 canonical Spec 确实未跟踪且未被 Git 忽略。

可执行登记：`native-archive-rejected-apply-recovery`、`native-archive-rejected-finalize-recovery`，位于 `config/workflow-regressions.json`。

未运行仓库全量测试、真实平台 Hook 和真实模型 Eval；本次是确定性 Runtime 恢复修复，用户未授权 Eval。没有发布 npm、创建 PR 或向 GitHub 发表评论。

后续由维护者依据报告者提供的脱敏 checkpoint、`portable-archive-<change>.json`、原检查输入及完整 Git 状态继续核对首次候选漂移。取得现场前，该行为保持“未复现/未解决”。
