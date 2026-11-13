# 性能优化审查发现的两项回归修复

来源：`report:2026-11-08-workflow-performance-review`。修复基线为 `053` 的 `641807084c1eedd1ba1248feec6ea9457859aeab`。本次仅修复审查中已确认的两项确定性 Runtime 回归，不修改 Skill 指令，不启动 Eval。

## Classic 升级后的首次受管检查

`hotfix`、`tweak` 经用户批准升级为 `full` 后，业务阶段改用 full，原 Run 的 workflow 身份继续保留最初的 preset。首次检查准备使用了 `inspectClassicSdkRun` 返回的有效 profile，因而加载 full 定义，却没有改变原 Run 身份。公开 CLI 返回退出码 70，报 `INVALID_RUN: WorkflowRun.workflow 与固定定义摘要不一致`，检查进程没有启动。

修复后，应用定义按照原 Run 的 workflow ID 选择；待执行步骤仍按照当前 `state.workflow` 选择。保留原 Run、已有升级和阶段批准，以及真实检查收据。

案例 `classic-upgraded-preset-first-managed-check` 在源码 CLI 和生成 Runtime 两种入口分别覆盖 hotfix、tweak：

- 升级提案尚未批准时，检查不能执行。
- 隔离夹具模拟批准升级、设计与实施配置后，首次 Build 检查保持 Build，正式 Guard 再进入 Verify。
- 首次 Verify 检查不代表验收通过；提交真实测试报告并执行正式 Guard 后才进入 Archive。
- 原 Run ID、workflow 身份和已接受的批准记录保留；两个检查命令分别只执行一次，正式 Guard 复用其有效收据。

夹具中的用户决定均为明确标注的测试模拟，不代表真实需求已经得到用户批准。

## Native 新能力的空基线 Delta

既有格式允许新 capability 提供 `base_hash=sha256('')` 的 Delta，以及与该 Delta 一致的完整目标 Spec。旧 `b0a2fc5d` 的自包含 `native next` 命令能将相同材料推进到 Shape 待批准；`64180708` 新增的生成器却无条件读取正式基线，因文件不存在而退出 65 / `ENOENT`。

自动生成目标的需求只涉及已有能力。修复将生成范围限定为 `modify`；新能力沿用原有完整目标与空基线 Delta 校验，不引入空基线文件，也不自动生成或覆盖新能力的手写目标。已有能力仍执行原有输入复核和独立编辑保护。

案例 `native-create-delta-shape-compatibility` 使用源码公开 CLI 和实际 `new`、`next` 命令 bundle，分别验证：

- 合法目标进入 Shape 待批准；重复 `next` 不授予批准，不改变目标原文，不提前创建正式 Spec。
- 手写目标与 Delta 不一致时，报告具体不一致并保留目标，不通过覆盖文件使校验通过。

## 验证结果

同一组 8 个新增用例在修复前全部失败：Classic 四项得到 `INVALID_RUN`，Native 四项得到缺失基线错误；修改源码并重新生成 Runtime 后，8 项全部通过。

```powershell
pnpm exec vitest run test/domains/comet-classic/classic-sdk-verify-rounds.test.ts test/domains/comet-native/native-shape-materialization.test.ts -t 'runs first managed checks after|empty-baseline Delta' --reporter=dot
```

另外完成：

- 原有 Native 关联 Delta 生成、只读不生成、独立目标编辑保护的精确选择器：1 项通过。
- Native、Classic、Entry 三个 Runtime 资产测试文件：25 项通过。
- TypeScript `--noEmit`、改动源码的定向 ESLint、受影响文件的 Prettier 和差异格式检查通过。
- Native、Classic、Entry Runtime 构建及 `check:generated` 通过。首次生成新鲜度预检指出 Entry 的 Hook Router bundle 依赖也已变化，补建 Entry 后通过；未把该次预检失败记为测试通过。
- badcase 登记及相对 `64180708` 的历史覆盖保留检查通过。精确测试名列表与两个新增 case 的 `requiredNames` 一致；筛选未执行的用例不计入通过数。

`test:core-regressions --case ...` 会把指定 case 合并进同文件的历史测试组。本轮发现实际范围扩大后停止该轮，改用上述精确 Vitest 选择器，未将中断轮次计为通过。

架构检查仍被工作区已有的 `.ruff_cache` 顶层目录阻断；保留该目录，不删除无关内容换取通过。未运行全仓测试、完整 npm 安装升级、真实平台 Hook、跨平台验证或真实模型 Eval；本次缺陷与修复证据覆盖确定性 CLI 和生成命令边界，不作上述层级的通过结论。

当前 `package.json` 为 0.5.3，`origin/master` 和上个发布 tag 为 0.5.2。两项问题均来自尚未发布的 0.5.3 优化，现有 Changed 条目已经描述最终能力；按 Changelog 的发布视角规则，不新增内部迭代修复条目，也不升级版本。

未提交、推送或操作 GitHub。原有归档状态和 website 子模块修改保持不动。
