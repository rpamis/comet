# Runtime SDK 实施与验收

目标：将 Comet 的持久化编排能力作为可复用 SDK 提供。宿主负责推理和工具选择，Runtime 负责执行契约、状态提交、确认、证据与恢复。实现分支为 `044`，比较基线为 `899d1fb0`（master 0.4.3）。

这份清单记录完整交付范围。完成某一阶段不代表整个 SDK 已完成。

## 领域与兼容边界

- 深化 `domains/engine`，不另建平行的 Harness Engine。
- 工作流 Run 与宿主 session 独立；沿用 Action / Outcome 概念。
- Native、Classic 保留各自阶段、确认、候选、验收和恢复规则。通用核心不依赖 Native 或 Git。
- Native 的实际外部 Verifier 路径消费共享 Action 生命周期；Action 与 Native 权威状态同一次提交，不另外写一份 SDK Run。
- 旧 `comet skill`、Native/Classic CLI、生成 Runtime 与已发布深路径保持兼容。
- Skill/Rule 提供上下文；Hook 保护依赖宿主真实能力。SDK 不声称控制宿主全部工具、恢复模型内部上下文或提供外部副作用 exactly-once。

## 交付清单

| 要求                                                      | 实现与证明                                                                                                   | 状态     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------- |
| Action 身份、attempt、输入绑定、领取、终态、重复/陈旧结果 | 共享纯生命周期；公共接口行为测试                                                                             | 完成     |
| 一致性 Store                                              | 单聚合快照 CAS；Memory/File 两种实现；真实进程竞争和重启测试                                                 | 完成     |
| 工作流定义与 Runtime                                      | 创建、查询、下一步、结果提交、等待决定、取消、显式恢复；无 LLM 依赖                                          | 完成     |
| 确认与验证                                                | 提案绑定、schema/业务验证、结果与验收区分、陈旧确认失效                                                      | 完成     |
| 图执行                                                    | 分支、有界循环、并行依赖/join、Child 生命周期；合法兄弟结果不因全局 revision 变化失效                        | 完成     |
| 扩展                                                      | 按版本固定的工作流注册、执行适配器、验证器、Store；observer 不直接改状态；能力不足显式失败                   | 完成     |
| 恢复与版本                                                | 持久化等待；未知副作用不盲目重试；protocol/schema/definition 版本校验与固定                                  | 完成     |
| Native 消费者                                             | 实际 Verifier 派发/启动/回传/request-checks/恢复；旧状态迁移与原有信任边界                                   | 完成     |
| 非开发消费者                                              | 无 Git、无 Native、无 init 的资料收集/批准/报告示例，跨进程恢复                                              | 完成     |
| 宿主调用                                                  | 结构化 CLI 与 SDK 共享命令实现；显式请求上下文；机器可读错误；未知执行的核对与显式重试                       | 完成     |
| 发布 SDK                                                  | 精选 typed ESM `@rpamis/comet/runtime`；兼容旧深路径；真实 tarball consumer JS/TS/CLI 互通                   | 完成     |
| 文档与版本                                                | 中文接口/扩展/恢复文档、可运行示例、0.4.4 用户视角 Changelog；不修改 website                                 | 完成     |
| 最终验证                                                  | 构建/生成物、架构/lint、打包消费者与分层测试通过；最终全量测试仅有已在干净 master 复现的 Windows Broker 失败 | 基线限制 |

## 执行顺序

1. 先写共享 Action 和 Store 契约测试，观察失败，再实现。
2. 将共享生命周期接入 Native；同时实现工作流服务与非开发消费者。
3. 增加 CLI、公开 package 入口和安装包消费者验证。
4. 按实际行为补文档、版本与发布记录，再做分层验证和独立审查。

## 已确认的存储决策

独立 SDK FileStore 使用不可变 revision 快照与原子排他发布。一次快照包含权威状态、待执行任务、已接受结果和恢复事实，不分散为相互独立的写入。文件系统不支持严格原子发布时明确失败，不退化成可读到半写内容的复制。Native 继续使用自己的锁与提交边界，共享纯生命周期，不同步两套权威 Store。

## 验证记录

- 初始：工作区干净；从 master 创建 `044`；website 未修改。
- 通过：最终候选的 `pnpm build`、`pnpm check:generated`、`pnpm lint`、`pnpm exec tsc --noEmit`、`pnpm test:package-e2e`，以及受影响源码、测试和文档的 Prettier 检查。打包消费者实际安装 0.4.4 tarball，验证新 JS/TS Runtime 入口、旧深路径和结构化 CLI 共享持久化 Run。
- 通过：修复后的 Runtime Engine/CLI 定向套件（10 个文件、135 个测试）；`pnpm verify:changed --base 899d1fb0` 中的架构、TypeScript、格式和生成物检查；其 app 组 31 个文件、661 个测试通过，另有 1 个 daemon 用例失败。中断后单独补跑 scripts、Native、Engine、workflow-contract 组，171 个文件、1729 个测试通过，33 个跳过。
- 最终全量测试：`pnpm test` 完成一轮，427 个文件中 426 通过、1 失败；5562 个测试中 5504 通过、57 跳过、1 失败。唯一失败为下述 Windows daemon 基线用例。前两轮全量测试还暴露了 Native Supervisor 完整收据恢复与租约安全检查的顺序冲突；已用失败测试定位并修复，相关 2 个测试文件 9 个用例及最终全量运行均通过。整仓测试命令本身因 daemon 基线退出码为 1，不能记作全绿。
- Windows daemon 基线：`test/app/comet-daemon-router.test.ts` 的 Broker 启动用例在当前分支及干净 master 工作树均以相同错误失败；Broker 与 daemon router 不在本次 SDK 差异内。手动启动 daemon 能成功，自动启动测试仍失败；原因尚未确定，未扩大本次修复范围。
- 真实宿主演练：Codex Agent 通过公开 `@rpamis/comet/runtime` 入口跨进程领取、回传两个 Skill Action，在持久化 Wait 处恢复并用本地测试决定完成 Run；该决定只用于演练，不代表真实用户批准。
- 独立代码审查已执行多轮。发现并修复定义内容只读检查、被拒绝 Outcome 持久化、CLI/SDK Outcome 解析差异、工具构造器命名、验证器抛错后的结果丢失，以及已记录结果经 `markUnknown` 绕入“未执行重试”的路径；相关回归测试已通过。最后一项经复审确认封住，未见同等级直接绕过路径。
