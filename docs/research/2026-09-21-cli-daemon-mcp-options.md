# Comet CLI 常驻执行与 MCP 开源方案调研

调研日期：2026-09-21。本文是待讨论的方案建议，不是已实现能力或性能承诺。

后续方向更新：下文“增加可选 MCP”是早期候选，不是当前实施决定。本次任务先保持既有 CLI + Skill，测量全流程开销并优化重复工作；当前需求与待确认事项见[任务准备记录](2026-09-21-workflow-cli-performance-brief.md)。

## 基线与范围

本地基线为 master 的 c8db743f（Comet 0.4.2，PR #441），调研开始时工作区干净。现有 daemon 路由仅覆盖 Classic state current/next 和 Native status/show/root 的受限查询，来自 bin/comet-daemon-router.js。

目标仍是覆盖 Classic 和 Native 流程使用的全部 Comet CLI，包括写状态、检查执行、确认、恢复和 Archive。流程调用的外部 Git、OpenSpec、测试程序需要保留各自的子进程语义；完整覆盖不意味着把任意第三方程序改为常驻。

## 开源项目实际做法

| 项目                         | 已核对做法                                                                                                                   | 对 Comet 的意义                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Microsoft Playwright CLI/MCP | README 建议 coding agent 考虑 CLI + Skills；Node CLI 通过 socket 向后台 Node daemon 发送 args 和 cwd；保留 workspace/session | 与当前 Skill 最接近；复用重执行环境，但每次 CLI 仍启动 Node                          |
| Vercel agent-browser         | 当前主分支采用 Rust CLI 与 Rust daemon，首次自动启动、空闲退出；全局安装可直接启动原生二进制，npx 路径仍有 Node wrapper      | 保留 CLI 且去掉 Node 客户端启动，但不符合当前不引入 Rust 的偏好                      |
| Nx                           | 每工作区 daemon、Unix socket/Windows named pipe、文件观察与增量 project graph；可禁用，CI 默认禁用                           | 收益来自减少重复分析，不只是换进程；不能用其构建收益推算 Comet                       |
| MCPorter                     | 把 MCP 暴露成 CLI/TypeScript 调用，支持 keep-alive daemon                                                                    | 可用于已有 MCP 的外部兼容，但 Comet 仍需先实现 MCP；增加一层代理不能自动解决流程性能 |
| 官方 MCP TypeScript SDK      | 提供 server/client、stdio 和 HTTP 协议能力；当前官方仓库已有 v2 稳定线                                                       | 可直接复用协议实现；工作区、确认、事务和恢复仍由 Comet 负责                          |

这些是代表性项目的实践，不是行业使用率统计，也不构成“所有 Agent Skill 应优先 MCP”的结论。Playwright 对上下文成本的判断是其产品选择，不能直接外推所有宿主。

来源：

- [Playwright CLI README](https://github.com/microsoft/playwright-cli)
- [Playwright MCP 的 CLI 对比](https://github.com/microsoft/playwright-mcp#playwright-mcp-vs-playwright-cli)
- [Playwright Node CLI 入口](https://github.com/microsoft/playwright-cli/blob/main/playwright-cli.js)
- [Playwright session 的 spawn、socket 与 cwd](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/cli-client/session.ts)
- [Playwright workspace/session registry](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/cli-client/registry.ts)
- [agent-browser 架构](https://github.com/vercel-labs/agent-browser#architecture)
- [agent-browser Node wrapper 与全局安装说明](https://github.com/vercel-labs/agent-browser/blob/main/bin/agent-browser.js)
- [Nx daemon 官方文档](https://nx.dev/docs/reference/nx-daemon)
- [MCPorter README](https://github.com/steipete/mcporter)
- [MCPorter daemon 当前实现](https://github.com/steipete/mcporter/blob/main/src/daemon/host.ts)
- [官方 MCP SDK 路线与版本](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/ROADMAP.md)

Playwright/Nx 的 daemon 是产品内部实现，本次未找到它们承诺兼容的独立通用 daemon SDK。MCPorter 的旧设计文档和变更历史存在版本差异；当前 host.ts 的错误处理明确返回未重放请求，不能按旧文档中的自动重试描述为 Comet 设计写重试。

## 建议方向

保留 CLI + Skill 默认调用，所有流程命令共用现有命令分派与领域实现，增加可选 MCP 长连接入口。分别验收命令覆盖和执行加速：全部命令必须可达，只有通过长驻安全验证的路径才获得进程复用。

1. 先为全命令列出调用清单，覆盖主入口、独立 bundle、Classic 子 Skill、Native continuation，以及流程需要的共享 Comet 命令。不能仅统计两份顶层注册表。
2. 显式传递 projectRoot、invocationCwd 和执行上下文，按工作区/版本隔离常驻执行环境；不通过修改进程全局 cwd 或 env 切换请求。权限由宿主和服务端验证，不能把客户端传入的权限标签当授权。
3. 全命令适配复用 argv、输出 envelope、状态版本和既有确认逻辑。首次接入不同时重写状态机、Runner JSON 契约与缓存规则。
4. CLI 保持默认；可选 MCP 使用官方 SDK，注册一次后由宿主持有连接。MCP 内部调用同一实现，不能每次再 spawn 整套 Comet CLI 并声称消除了冷启动。
5. 尚未通过常驻验收的操作可暂时走隔离执行路径，但必须报告该命令尚未加速。最终验收包括全部流程命令，不以只读 MVP 当完成。
6. 同一状态资源的写操作协调继续使用磁盘锁与事务；同一个 Git 工作区中的分支/索引操作还需考虑跨 change 冲突。长检查不能占据唯一全局队列而阻塞状态、诊断和取消。
7. Hook 保持独立可执行路径；MCP 工具权限与 shell 权限可能不同，接入要验证宿主授权，不能假定先前 shell 审批自动覆盖 MCP。

## 断线、重试与取消

连接建立前失败与请求已发出后丢失响应必须区别处理。后者可能已经写盘或推送，不能自动通过 CLI 重放。复用现有状态版本、事务日志和交付恢复记录对账，必要时增加绑定工作区、参数摘要的持久化 operation 记录。

JSON-RPC request ID 或短期内存结果缓存不能独立提供跨进程崩溃的 exactly-once 保证。普通 status 也未必能证明一次远程副作用是否完成，应使用对应操作的恢复证据。

MCP 取消是协作机制，接收端可以因操作完成或不可取消而忽略请求。测试进程应在安全点终止，Archive 事务应返回已提交、已取消或待恢复的真实状态，不能把取消当回滚。[MCP 2025-11-25 cancellation 规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation)

## 选型与性能验收

| 方案                       | 接入影响                               | 能否消除每次 Node 客户端启动       |
| -------------------------- | -------------------------------------- | ---------------------------------- |
| 完善 CLI + Node daemon     | 对 Skill 影响最小；长驻安全仍需验证    | 不能，只减少模块加载和重复工作     |
| 可选 MCP 长连接 + 共享实现 | 需要宿主注册与传输选择；能覆盖全部命令 | 连接复用期间可以                   |
| 原生 CLI + daemon          | 新语言、跨平台构建与安装维护           | 原生入口可以                       |
| MCPorter 代理              | 额外依赖和配置；需要已有 Comet MCP     | 不能假定，取决于代理入口与发行形态 |

建议先决定“CLI 默认、MCP 可选、全命令共用实现”的方向，再用独立实验测量短查询、短写操作、长检查、恢复和 Archive。每类同时测首次、热调用、CLI 与 MCP、主仓库与 worktree，并记录实际进程次数、Git/文件读取次数、P50/P95 和完整流程耗时。

本轮没有重新运行此前 benchmark，也不把历史 5% 或预估 75%–90% 当作 0.4.2 新基线。先确认时间究竟花在客户端启动、Git、文件摘要还是状态投影，再选择优化项。

## 验证边界

已读取官方 README、部分直接相关源码和规范，并核对本地 0.4.2 版本、提交与 daemon 路由。没有安装或运行上述第三方项目，没有做跨平台 benchmark、真实宿主 MCP 或模型 Eval；本轮不证明任何方案的实际加速倍数。仅新增这份中文研究记录，不修改 Runtime、Skill、版本或网站。
