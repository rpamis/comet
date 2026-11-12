# Native / Classic 文件大小限制审计与移除

来源：[Issue #551](https://github.com/rpamis/comet/issues/551)。用户反馈 brief 超过 1 MB 后不能继续流程，要求清查并移除 Native / Classic 内部运行的文件大小限制。

调查基线为 `e4cfe675d52159555d3452f28d85ec1293d29501`，分支 `053`。工作期间其他任务提交到同一分支，保留其修改；本任务未修改 website。当前版本为 0.5.3，远程 master 的版本仍为 0.5.2，因此追加到现有 0.5.3 Changelog，不再升级版本。

## 结论与复现边界

当前主要 brief 读取和 Shape 推进路径已经取消字节预算，不能据此确认用户原始现场的具体失败命令。原始 brief、安装版本、命令和日志尚未提供，原报告的现场复现保持未确认，Issue 不关闭。

另有五项残留限制已取得同一输入在旧源码失败、修复后通过的证据：默认 Native 产物读取超过 1 MiB、Runner 输入超过 8 MiB、能力来源超过单文件及总字节预算、selection 超过 16 KiB，以及 Git 批量原文读取默认遗漏大 blob。测试中创建真实临时文件和 Git 对象，没有以 mock 替代大小边界。

公开生成 bundle 的回归测试使用超过 1 MiB 的 brief，验证全文展示、Shape 等待确认，以及明确确认后进入 Build。这项测试保护当前已有的主流程行为，不声称它在本次基线上失败。Classic 归档测试验证超过 64 MiB 的 Spec 在归档后仍能逐字还原；这项尚未单独运行旧代码对照。

## 移除范围

| 范围                                             | 原限制                                         | 当前行为                                               |
| ------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------ |
| Native 默认产物读取                              | 1 MiB                                          | 默认完整读取；保留显式调用参数供有明确用途的读取器使用 |
| Native runner 输入及登记                         | 输入 8 MiB、登记 256 KiB                       | 完整读取和内容验证，保留登记身份及来源检查             |
| Native 能力 Spec 与发现缓存                      | 单文件 256 KiB、总内容 8 MiB、缓存 512 KiB     | 不按字节数跳过 Spec 或缓存结果                         |
| Native 归档原件备份                              | 8 MiB                                          | 完整读取原文，保留 Run、事务及候选归属检查             |
| Native 旧归档材料恢复                            | 单文件 8 MiB、总内容 64 MiB                    | 完整恢复材料；原文件数量约束保留                       |
| Native 转移回执、workspace 身份                  | 1 MiB / 16 KiB                                 | 仍校验结构及归属，不按固定字节数拒绝                   |
| Native legacy Spec sync 输入                     | 1 MiB                                          | 普通 JSON 文件完整读取，保留字段及 workflow 约束       |
| Native legacy show                               | JSON 输出 10 MiB                               | 完整输出正式材料                                       |
| Native Supervisor 转移和 Classic 交付材料        | 命令输出缓冲 100 MiB / 32 MiB                  | 不用固定缓冲间接截断大 patch / 原文                    |
| Classic 主 Spec 备份                             | 单文件及总内容 64 MiB                          | 完整备份原文；原文件数量约束保留                       |
| 共享 selection、owner、配置事务                  | 16 KiB                                         | 保留结构与归属检查，完整读取                           |
| 共享 .gitignore、旧 Runtime 标记、初始化指令材料 | 4 MiB / 1 MiB / 4 MiB                          | 完整读取，保留路径和内容判断                           |
| SDK 应用静态流程定义                             | 8 MiB                                          | 完整解析；原步骤和转换数量校验保留                     |
| 平台 workspace 的 .git 指针                      | 16 KiB                                         | 完整读取，保留 gitdir 格式和实际目录身份判断           |
| Git 原文读取                                     | 默认单 blob 1 MiB、总内容 64 MiB、固定输出缓冲 | 默认完整读取；批量缓冲按实际对象字节量计算             |

复用仓库已有的 `Number.MAX_SAFE_INTEGER` 无业务限额约定，没有新增项目预算字段，没有新增哈希或指纹机制。底层读取器仍分块读取并核对打开文件和读取后状态；运行环境的可用内存与 Node 字符串容量属于实际处理能力，不承诺无限文件大小。

## 保留的其他约束

- 展示分页、诊断摘要和有明确截断标记的文本前缀读取，不限制正式业务文件是否被接受。
- marker 前缀识别只读取必要的固定头部，大文件仍可继续走完整解析。
- 文件数量、步骤数量、执行超时、验收次数和批准规则不属于本次文件大小限制移除。
- Git 元数据缓存的字节预算只让缓存回退到 Git 查询，不拒绝业务文件，保留其现有行为。
- 独立报告示例应用的 1 MiB 报告规则、HTTP/daemon 消息协议、通用进程输出保护，以及用户配置的 Project Knowledge 检索预算不属于 Native / Classic 正式运行文件限制，本次没有修改。

## 验证

- 新增 7 个精确 badcase，来源均为 Issue #551；登记文件保留其他任务及历史条目。
- 通过 `pnpm test:core-regressions --case ...` 执行全部 7 个新增案例；执行器按文件合并为 4 组，17 项实际测试通过，汇总无失败。
- 4 个核心受影响测试文件：94 项通过，包括公开 Native 命令 bundle 和 Classic 大 Spec 归档。
- 6 个相邻领域测试文件：91 项通过，覆盖能力发现、旧归档原文恢复、应用定义、owner、.gitignore 和共享契约。
- Runtime 资产、Entry 初始化及 workspace 测试：64 项通过，2 项既有平台条件测试跳过。
- Native、Classic、Entry Runtime 构建及 `pnpm check:generated` 通过。
- `pnpm exec tsc --noEmit`、受影响源文件/测试/配置的 Prettier 检查、`git diff --check` 和 badcase 基线保留检查通过。
- `pnpm lint` 通过：零错误，另有 9 项既有 Dashboard / DSH 未使用变量警告；本次引入的临时警告已清除。

未执行仓库全量测试：定向测试已覆盖已知变更边界。未执行 npm 安装包端到端验证或真实平台 Hook：本次验证到生成 Runtime 命令 bundle。未执行真实模型 Eval：用户没有启动请求，且当前修改为确定性文件读取规则。上述边界不互相替代。
