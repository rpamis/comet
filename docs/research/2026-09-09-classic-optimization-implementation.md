# Classic 优化实施记录

## 边界

- 基线：`a23a2519ba75060ff9df1fec0e616fbaf63d5a9e`，本地 `master` / `origin/master`，版本及最近 tag 均为 `0.4.0`。
- 保留五阶段、Open/Design/Build/Archive 独立确认、OpenSpec 和 Superpowers 强依赖。
- 不修改上游 Skill，不改用户选择的执行方式，不默认开启 `direct_override`。
- 本批中文 Skill 已实现；英文同步等待用户确认。未升级版本或写 Changelog，未提交或推送。

## 已实现

1. `comet check run <change> <build|verify> [--local] [--cwd <path>] [--timeout-ms <ms>] -- <program> [args...]` 执行真实 argv，记录退出码、运行来源、日志引用及输入绑定。
2. `--local` 显式声明确定性本地检查；相同命令、cwd、源码输入和环境可复用，返回 `reused=true`。不指定时证据单次使用，适用于外部或环境不确定检查。强制重跑可省略 `--local`。
3. 输入指纹包含 Git HEAD/index、跟踪及非忽略的未跟踪文件、配置/锁文件、子模块内容与包管理器安装元数据；无 Git 项目扫描项目文件，排除 `.git` 和 `node_modules` 正文。Runtime 自有记录、选择指针及已登记的 Markdown 验证报告不进入输入。
4. 环境只保存摘要，不保存环境变量明文；绑定平台、Node、argv、cwd、PATH/环境和解析后的可执行文件身份。运行前后输入或可执行环境变化时不接受成功。
5. 手工 `state record-check --command` 保持只记录、不执行；不能作为自动放行的 Runtime 证据。Build 与 Verify 保持不同 scope。
6. Build Guard 先完成廉价前置检查，再尝试证据复用或构建；`state transition verify-pass` 复用 Verify Guard 的完整检查条件。
7. `state check --recover --json` 返回身份、配置、下一未完成任务、检查点与必要文件，并使旧命令证据失效；文本输出保持兼容。
8. 中文 Skill 采用信息充分即停止澄清、成果级计划、明确外部 Skill 返回边界、预期 TDD RED 例外、原 implementer 修复恢复、风险验收与按需加载上下文。

## 使用限制

- `--local` 不是 Runtime 对任意命令确定性的自动证明。外部服务、网络状态、未纳入指纹的忽略文件或无法确认的工具环境不能声明为可复用检查；应省略该参数并执行新检查。
- 非本地证据只使用一次，Guard 预览也会消耗；需要推进时直接用于本次 `--apply`，重试前重跑。
- 多条必需检查应通过项目已有的聚合验证入口执行并传播任一失败；不要把最后一条成功当成全部检查成功。
- 新接口不会解释保存过的 shell 文本。Windows 普通 npm/pnpm shim 由已有平台适配器处理，含 shell 元字符的 batch 参数被拒绝。
- 日志仅保留末尾最多约 2 Mi 字符，使用日志摘要校验防止引用损坏；完整日志仍应由项目验证工具另行保存。
- 旧审批、任务、审查记录不会因冷恢复而清空；重新运行命令不等于重新规划整个 change。

## 验证进度

- 最终定向回归：9 个文件、249 项全部通过（40.54 秒），包含最新启动失败保护、公开入口、指纹、Guard 和中文 Skill 契约。

- 定向执行与 Guard 测试：33 项通过。
- 指纹测试：3 项通过，覆盖暂存/未暂存、删除、子模块及安装元数据。
- 中文 Skill、CLI 与执行证据相关检查：4 文件、174 项通过。
- 直接验证转换回归：2 项通过，其余 219 项按本次筛选跳过。
- 公开入口参数透传：快速 Runtime 和编译后的完整 CLI 各 1 项通过，确认子程序的 `--json`、`--help`、`--comet-task` 保持原样。
- TypeScript 编译、受影响源码 ESLint、受影响文件 Prettier、`git diff --check`、`pnpm check:generated` 通过。
- 已执行一次全量测试；`test/domains/comet-native/native-user-options.test.ts` 的 worktree Supervisor 案例在 120 秒超时，此后数分钟无新进展，主动终止本轮并保留日志于系统临时目录 `comet-classic-full-suite.txt`。全量验证未完成，不视为通过；未修改 Native 或扩大测试超时。此前扩大范围的一轮有 5 项旧契约/fixture 失败，对应原因已修正并经过定向验证，不能把那一轮描述为通过。
- 架构检查被工作区已有的 `.codex-remote-attachments` 顶层目录阻塞；未删除、移动该目录或放宽产品架构规则。
- Docker Linux daemon 未运行，未启动真实模型 Eval。未验证真实宿主 Hook、最终 npm 安装包或远端 CI。

## 后续验收

### CLI 帮助补充（0.4.1 分支）

- 已从原 master 工作区创建并切换到 `0.4.1`，保留此前全部未提交优化和无关网站子模块状态；未提交或推送。
- Classic 概览区分常用入口与高级操作；state 子命令单独提供帮助，字段与枚举共用实际参数校验定义，transition 列出实际事件。
- 检查帮助明确 `--local` 确定性声明、cwd 基准、超时默认值和范围、子程序参数边界、JSON 字段、退出状态、日志与重试动作。
- Guard 明确可能执行构建且预览也消耗单次证据；恢复明确使旧证据失效；手工记录明确不执行且不能满足 Runtime 放行条件。
- 本轮扩大回归：6 文件、266 项通过；最终帮助及入口专项：4 文件、33 项通过，两者存在重叠，不累计计数。
- TypeScript、Classic bundle 构建、生成物一致性、受影响文件 ESLint/Prettier 和 diff 空白检查通过。实际公开 CLI 与独立 bundle 在项目外目录的 JSON 帮助一致性已验证。
- 未重复运行此前因 Native 超时中止的全量测试；没有真实模型 Token 测量或远端 CI 结论。基线版本和最近 tag 仍为 `0.4.0`，英文 Skill 同步获确认后统一准备 `0.4.1` 版本及 Changelog。

中文获确认后，同步英文并进行双语契约检查，再按最终用户可见变化确定版本及英文 Changelog。性能试验先运行清晰需求、完整 PRD、跨模块长任务三组成对案例，再决定是否扩大样本；以相同模型、依赖、环境和验收标准对比。

同时报告全部尝试的成功率/成本与成功配对的效率，分别统计缓存输入、非缓存输入、输出、Agent 次数和人工等待。成本中位数下降 20% 只是试验目标，不是本批代码已经实现的实测收益。恢复稳定性仍须真实模型中断实验验证。
