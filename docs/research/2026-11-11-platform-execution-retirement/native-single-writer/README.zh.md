# Native 普通流程的锁协议退休

来源：`report:2026-11-10-agent-platform-execution`。

用户明确采用每个 workspace 一个写入者：并行 Child 只写自己的 worktree，将结果交给父 Agent 串行提交。普通 Native 不再创建文件锁、SQLite 协调锁、锁 token 或停止写入者的确认流程。旧锁文件原字节保留并被忽略；不能将忽略旧锁解释为原执行已停止、检查成功或用户批准。

本次物理删除 `native-lock.ts`、`native-sdk-projection-lock.ts` 和旧 mutation-lock 门面。新 `native-mutation.ts` 只保留实际未完成 root move 和 WAL 的业务核对。checkpoint 发布、恢复直接执行，保留真实 Shape Agent claim、Portable sourceRevision、partial 校验、只读拒写和实际 mutation 的 workspace 归属检查。所有 Native 文件存储构造点声明内部 `singleWriter: true`；共享 SDK 默认仍服务确实存在并发的独立应用，未增加项目配置。

完整旧测试正文保存在 `tests.json` 和 `original/`，改动在 `tests.patch`。`registry.json` 冻结原登记全部字段和既有迁移链；`mapping.json` 的 `cases` 提供可校验的精确测试去向，`behaviors` 说明退休范围和执行证据。14 项普通锁机制按 `feature-removed` 追加，不宣称修好了已删除的排他协议；另 3 项 trajectory 案例只修正此前迁移后的精确选择器，保留完整业务，类型为 `tests-moved`。

保留的业务包括：

- 原 Run、revision、claim、候选和批准不变；只读诊断不恢复或写入，显式恢复仍保原任务身份。
- 真 prepared transition、Archive 和 root move 的 WAL、源状态和文件身份仍有效；无批准不推进，重复恢复不重复事件或副作用。
- 取消后的选择清理写入失败仍须暴露，替代需求保持阻塞；修复成功才释放。测试用明确标注的实际选择写入错误替代已退休的锁年龄机制。
- 原始 root move 文件逐项等价、历史事务审计、错误目录和符号链接隔离继续保留。
- Git 本身报告的 index/ref/worktree 错误仍提供实际对象和重试指引，Comet 不删除 Git 的锁文件。
- `runtime-pid-free-lock-recovery` 与 `workflow-simplification-t09-native-short-lock` 的共享平台资源锁测试继续登记；只移除普通 Native 对其互斥协议的依赖。`native-missing-trajectory-runtime-diagnostics` 的另一条 Native diagnostics 测试也完整保留。

实际验证按独立报告记录，不能重复相加宣称全量：新增单写入者 3 项通过；checkpoint 原 22 项通过；锁/只读/业务恢复第一组 70 通过、4 个旧目录 fixture 失败、1 项 Windows skip，修正显式 fixture 后相关 21 项全部通过、1 项原 Windows skip；migration/root move 27 项通过，另 1 项原 Windows symlink skip、1 项生成 Runtime 测试待根 Agent 完成统一 build 后执行。后两类测试仍在精确登记中，未标成通过。源码 ESLint 无错误；未运行全量、模型 Eval、真实平台 Hook 或安装发布验证。

新建 Child 指引仅要求平台在自己的 worktree 执行，将原模板 JSON 返回父 Agent，由父 Agent 在 `controlProjectRoot` 串行执行既有 `returnAction`。未新增 ledger、Run 或批准。

根 Agent 统一构建后仍须运行：

```powershell
npx vitest run test/domains/comet-native/native-root-move.test.ts -t 'moves an initialized root through the generated Runtime without creating lock files'
```

登记追加脚本默认只读校验；只有根 Agent 明确执行 `--apply` 才更新 registry。它按逐 ID 完整原对象做 CAS，保留其他案例和历史链；检测并发同 ID 修改时拒绝覆盖。
