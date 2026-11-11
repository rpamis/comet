# 四个 Entry / Dashboard 历史工厂引用的测试迁移审查

日期：2026-11-11。只修改本系统 Temp 中的原型、映射和报告；未修改仓库产品、测试、registry，未运行 Eval、模型、容器或真实平台安装 Hook。

四文件可整体应用。57 个原声明全部保留，没有退休声明；AST 逐项核对原 199 条独立 expect 表达式及其重复次数，缺失为 0。新增 3 个声明展开 4 个反例/合法例。repo-ready 与实际执行副本在去掉 import 路径及格式差异后的 AST 相同。

## 应用文件和完整旧文

repo-ready 文件位于 repository-ready/test/domains 下，保留仓库相对 import。repository-ready-before-after-cas.json 含四份完整 before/after；生成时四个仓库文件仍逐字等于 before，根 Agent 应在应用前再次做 CAS，保护并发修改。original-four-files-all-declarations.json 保存原 57 声明及四文件全文；all-57-declaration-migration-map.json 保存每条原正文到当前相同名称正文/精确 selector 的映射，未缩窄替换。

| 文件 | 原声明 | 当前声明 | 迁移方式 |
| --- | ---: | ---: | --- |
| comet-entry/project-status.test.ts | 21 | 21 | 只读历史资料改已有 storedNativeChangeFixture；原真实 v4 Portable 投影仍真实创建 |
| comet-entry/resume-probe-intent.test.ts | 8 | 10 | 历史 intent 资料显式 SIMULATED；当前 Run 不推进保护仍使用真实 SDK 创建；新增无 Runtime Shape 与两个无写拒绝反例 |
| comet-entry/hook-router-runtime.test.ts | 13 | 13 | 正常任务用 current Portable 创建，Build 经过 confirmNativePortableShape 真正持久化批准；不直接改 phase |
| dashboard/server.test.ts | 15 | 16 | 多条历史文档分页资料标为 SIMULATED，不假冒可同时创建多个 current Run；另补真实单条 current Shape HTTP 分页/detail/原 state bytes 不写 |

辅助依赖均已在仓库：test/helpers/native-change-document.ts 的 storedNativeChangeFixture，test/helpers/native-portable-confirmed-transition.ts 的 confirmNativePortableShape。没有恢复旧 factory、执行器、content snapshot 或进程停止逻辑。Hook 测试执行已有发布资产 Router，属于隔离确定性命令边界，不能称真实平台 Hook 已安装验证。

## 实际缺陷及 RED → GREEN

仅有 legacy Shape 业务文档、run_id=null，且用户 Runtime change 子目录不存在时，显式“继续”原先被 inspectNativeRunConsistency 捕获的 Node ENOENT 判 invalid，返回 ask_user。原旧工厂会额外建立空 runtime/checkpoints 和旧快照，掩盖该只读边界。

explicit-legacy-resume-red-results.json 和 red-explicit-legacy-probe-observation.json 保存实际 RED：native-change-invalid，lstat 当前用户隔离 Runtime changeDir ENOENT。根 Agent 已在 native-run-consistency.ts 只为 ENOENT + run_id=null + Shape 返回原 findings；不创建目录、不迁移、不恢复 Run，不放宽 declared Run 或坏 JSON。

最终原 8 声明展开 14 例均继续通过。新增合法 Shape 用 resolveCometEntryResumeProbe 明确 auto_resume，前后整个项目树相同，Runtime changeDir 仍不存在；declared-run-missing 和 malformed-run 两例均实际到达产品边界、保持 ask_user/native-change-invalid，state/Runtime 原 bytes 不变。一次中间复测 malformed-run 因探针错拼 runtime/runtime/run-state.json 而在创建样本前失败；已改复用 nativeRuntimeRefFile，最终 17/17 通过，不能把这次 harness 失败说成产品缺陷。

原 commit-only 四种 empty/single/multiple/selected context 继续保持原全部断言；仅 beforeRuntime fixture 读改为存在则记录 bytes、不存在则记录 null；没有 mkdir 来满足旧工厂副作用。

## 验证结果与边界

组合证据为 76 通过、0 失败、1 原平台 skip，来源两次真实运行，不是单次四文件全绿：

- entry-dashboard-pre-malformed-fix-results.json 中其他三文件：Hook 21、project-status 22、Dashboard 16 通过；Dashboard 原 closes static file descriptors after aborted responses 只适用于 Linux，Windows 原条件 skip，未改 skip。
- resume-final-green-results.json：17/17，10.96 秒。运行命令和输出在 resume-final-green-run.log，配置 vitest-resume-final.config.cjs。
- combined-executed-evidence.json 明确按两份原始报告组合，未把其他文件的旧 resume 失败写成通过。
- 仅对四份 Temp repo-ready 运行了 Prettier --write。没有构建 Runtime/dist，没有任何安装，也没有跑其他大组/全量。

全程 setup.ts 将 COMET_DATA_DIR、HOME/USERPROFILE、APPDATA/LOCALAPPDATA、CODEX_HOME 和 XDG 路径设在系统 Temp，并禁用 daemon/telemetry。正常 currentShape/Build 及 Git/HTTP 资源均隔离临时项目。没有修改用户真实项目或Runtime数据。

## 登记结论

effective-registry-links.json 为 []：当前有效末端没有引用这四源文件，迁移自身无需追加 testMigration，registry-noop-plan.json 记录依据。不要把历史关联误当当前末端。

本批发现并由根 Agent 修复的 legacy Shape 缺 Runtime 只读误判，是新产品行为修复；若需新增 report 稳定 ID 由根 Agent 统一登记，本子任务未抢占 ID，也不以“迁移末端零引用”代替该修复的 badcase 记录。
