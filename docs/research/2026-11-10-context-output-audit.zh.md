# Comet 执行时的上下文体积调查

日期：2026-11-10。分支 `053`，调查基线 `630ce380` 加当前未提交优化；本次仅调查，不改产品、Skill 或测试。所有字节数为真实公开命令 stdout 的 UTF-8 长度，不代表模型 token 数。

## 用户补充为 0.5.2 后的版本核对（本次结论基线）

用户确认反馈来自 **0.5.2**，平台、workflow、调用轨迹和压缩现场均未知。以下 0.5.2 实测优先于后文最初按 053 开发态进行的探索。不能将 053 新增接入的问题当成 0.5.2 用户的已证根因，也不能承诺升级必然解决。

核对 tag `0.5.2`，SHA `a61a2e5b4766e1ad62377dec598e402560a259b6`，package.json 为 0.5.2。使用 `git show 0.5.2:<asset-path>` 将该 tag 已提交的 Native、Classic 全部自包含命令 bundle 提取至系统 Temp；没有 checkout、安装依赖、运行 build 或修改当前源码。该证据是 tag 的生成 Runtime，不等同用户机器的安装记录或重新安装 npm 发布包。

### 完整隔离与原始记录

正式比较根目录为 `C:/Users/BENYM/AppData/Local/Temp/comet-052-context-audit-B6v5RL/`。目录包含：

- `assets/`：0.5.2 tag 原始 bundle；`assets-053/`：测量时冻结的当前 053 bundle。
- `native-measurements.json`、`classic-measurements.json`：0.5.2 原始 stdout、参数、退出码及字节数。
- `native-053-comparable-measurements.json`、`classic-053-comparable-measurements.json`：当前 053 同场景对照。
- `isolated-summary.json`、`skill-sizes.json`：体积及上下文字段核对结果。
- `comet-052-context-native.mjs`、`comet-052-context-classic.mjs`、`comet-053-context-comparable-native.mjs`、`comet-053-context-comparable-classic.mjs`：保留的重放脚本。

所有子进程显式覆盖 COMET_DATA_DIR、HOME、USERPROFILE、APPDATA、LOCALAPPDATA、CODEX_HOME 及 XDG_DATA_HOME / XDG_STATE_HOME / XDG_CONFIG_HOME / XDG_CACHE_HOME，全部指向本临时根。Windows 的知识存储确实优先使用 LOCALAPPDATA，Runtime 优先使用 COMET_DATA_DIR，故不能只修改 HOME；来源为 `platform/paths/project-knowledge-storage.ts:12-23` 与 `platform/paths/workspace-runtime.ts:101-122`，0.5.2 tag 也有同样 COMET_DATA_DIR 路径选择。

54 次公开 bundle 命令均退出 0；这是隔离调查中的模拟需求及批准，不是实际功能实现或模型 Eval。输出均无实际 `contextDelivery` 或 `context` 正文字段，只有获取上下文的描述，故本次没有测到真实记忆投递正文成本。Classic 仅测量正常 Open 入口与读取，没有测完整 Build、底层 runtime dispatch claim 或远端交付。

最初 053 单条/50 条探索没有显式覆盖用户环境变量；虽然项目身份在临时目录且没有 contextDelivery，它不构成完整用户存储隔离证据。本节已在新的全隔离目录重放两版本对照，并将其设为正式结论基线。先前原始文件保留，不把它们悄悄改成已隔离。

### 相同范围的输出对照

两版本使用同样的完整 brief、Spec、原始请求和单条 A1 文本，项目路径等长；各自按该版本公开协议推进，不拿 053 的 Shape Action 或 v4 检查结果字段套进 052。0.5.2 普通新 Run 为 v3，当前 053 普通新 Run 为 v4；来源为两版本的 `domains/comet-native/native-runtime-ownership.ts`。Shape 的执行入口在两版本不同，表中低层状态仅作同一业务边界的比较。

| 动作                             | 0.5.2 输出 B | 当前 053 新 Run 输出 B |
| -------------------------------- | -----------: | ---------------------: |
| Native new                       |       10,429 |                 10,400 |
| Native Shape status              |       12,061 |                  9,652 |
| Native Shape 批准返回            |       18,399 |                 14,446 |
| Native Build 高层任务首次领取    |        2,398 |                  3,172 |
| Native Build 同任务重复读取      |        2,398 |                  2,534 |
| Native Build status              |       14,693 |                  9,499 |
| Native Build status --details    |       16,870 |                 10,588 |
| Native Verify 高层任务           |        2,789 |                  2,912 |
| Native Verify status             |       16,621 |                 10,133 |
| Native Verify status --details   |       21,168 |                 11,593 |
| Classic SDK state next           |       12,167 |                 12,110 |
| Classic SDK state next --details |       13,558 |                 13,501 |
| Classic SDK state check open     |       12,391 |                 12,334 |
| Classic Compat state next        |        7,035 |                  6,957 |

052 已有 Build/Verify 高层入口，约 2.4/2.8 KB；不能声称是 053 才首次压缩输出。053 首次 Build 领取增加当前任务 contextRequest 描述，故高层响应也没有全面变小。

052 的 Native 低层 status 确实更大：Build 的当前 Action input 为 4,426 B，Verify 为 5,704 B，主要是前序 outputs；当前 v4 同场景为 728/884 B，并去掉受管检查模板与说明。总输出分别减少约 35.3% 和 39.0%。052 的 `--compact` 可将这两个 status 降到 13,333/15,261 B，但仍明显大于其高层任务响应。Classic Open 的约 12 KB 正常入口在当前 053 基本没有缩小。

**旧 Run 不会因升级自动变成新 v4。** 升级后仍沿用原 v3 定义、领取身份和恢复协议，以上“当前 053 新 Run”比较不能解释成每个旧需求升级后都获得同样减幅；历史兼容路径和用户现场需单独核对。Skill 也明确旧 change 不自动迁移。

### 052 的 Skill 与插件边界

| 内容                    | 0.5.2 UTF-8 B | 当前 053 UTF-8 B |
| ----------------------- | ------------: | ---------------: |
| Native 主文（中文）     |        19,540 |           20,304 |
| Native 主文（英文）     |        22,215 |           23,558 |
| Native 命令参考（中文） |        56,571 |           59,031 |
| Native 命令参考（英文） |        59,998 |           63,128 |
| Classic 主文（中文）    |        13,434 |           13,434 |
| Classic 主文（英文）    |        13,755 |           13,755 |
| Open 主文（中文）       |        22,429 |           22,489 |
| Open 主文（英文）       |        23,432 |           23,544 |

这些正文没有随升级整体变短。两版本本来都要求按当前阶段读取、复用已有有效状态，实际是否整份读取仍需用户调用记录才能判断。

0.5.2 tag **不存在** `plugin/codex`、`plugin/dsh` 或 `domains/skill/plugin-hook-entry.ts`。因此，后文同聊天三次 10,196 B 的插件 SessionStart 重复是真实的 053 开发接入证据，不能解释为 052 已发布插件的问题。本轮短 bootstrap 修正属于 053 接入的预防优化；新 Shape 高层回报补齐决定命令也主要服务 053 新增 Shape Action 入口，不能拿它冒充 052 反馈的根因。

### 对用户反馈可以成立的结论

052 有可观的常驻 Skill 正文和偏大的低层状态包，重复读取时会积累上下文成本；高层 Build/Verify 入口已经较小。未知用户是否使用 Native、Classic、高层或低层协议，更不知道压缩时是否在反复读参考、测试日志或平台规则，所以仍无法确认其具体根因，也不能保证升级后频繁压缩自然消失。当前可交付的是已测输出及本轮确定性优化；真实平台事件、模型按需读取和压缩次数仍未验证，未启动 Eval。

## 最初 053 探索结论

当前代码确实有可消除的上下文开销：Native 的低层状态包有重复协议字段，Classic 正常续行反复带三份接近相同的上下文获取说明，Native 高层 Shape 回报丢失了确认命令，迫使执行者另查更大的 status。普通高层 Native 任务响应已经明显小于 status，不能把二者混为同一路径。

这些测量证明存在输出冗余，尚不能证明某个用户的频繁压缩由 Comet 单独造成。没有取得该用户的平台、版本、命令轨迹、压缩阈值与完整会话记录；本次也未启动模型 Eval。大任务验收正文、项目 AGENTS、平台注入、实现阅读和测试日志都会占上下文，不能只以 CLI 字节数归因。

## 方法与原始证据

在本机临时目录创建独立最小项目，调用已生成的公开 Native/Classic `.mjs` 命令 bundle；Shape 准备、确认、Build 回报和 Verify 领取均通过 CLI 正常推进。批准是隔离调查中的模拟用户批准，不属于真实 change 授权。没有执行模型、真实远端交付或平台 Hook。

- Native 单条验收：`C:/Users/BENYM/AppData/Local/Temp/comet-context-measure-ru8COB/measurements.json`；重放脚本 `C:/Users/BENYM/AppData/Local/Temp/comet-context-measure.mjs`。
- Native 50 条验收：`C:/Users/BENYM/AppData/Local/Temp/comet-context-measure-y9Qxxd/measurements.json`；脚本 `C:/Users/BENYM/AppData/Local/Temp/comet-context-measure-scale.mjs`。每条是约 140 英文字符的合成要求，用于观察规模变化，不能当成真实用户任务分布。
- Classic SDK：`C:/Users/BENYM/AppData/Local/Temp/comet-classic-context-779nJv/measurements.json`；脚本 `C:/Users/BENYM/AppData/Local/Temp/comet-classic-context.mjs`。创建时显式指定 `--runtime sdk`。
- Classic Compat：`C:/Users/BENYM/AppData/Local/Temp/comet-classic-context-g0fXCn/measurements.json`。旧配置项目不带 `--runtime sdk` 会保留 Compat，表中分开报告。

以上临时文件保留原始 JSON，未向文档复制需求全文或无关个人记忆。测试项和测量项目均与真实项目隔离。

## Native 实测

| 动作                                | 单条验收输出 B | 50 条验收输出 B |
| ----------------------------------- | -------------: | --------------: |
| new                                 |          9,956 |           9,956 |
| next --session：Shape 领取          |          2,372 |           2,372 |
| next --result：Shape 回报           |          2,688 |           2,688 |
| Shape status                        |          9,496 |          28,414 |
| Shape status --details              |         10,583 |          40,575 |
| next --confirmed：Shape 批准        |         14,138 |          49,044 |
| next --session：Build 领取          |          2,411 |          13,771 |
| Build status                        |          9,339 |          36,537 |
| Build status --details              |         10,431 |          48,703 |
| 同一 Build 任务重复 next --session  |          2,411 |          13,771 |
| Build next --session --details      |         10,286 |          59,916 |
| next --result：领取 Verify          |          2,789 |          17,726 |
| Verify status                       |          9,921 |          40,982 |
| Verify status --details             |         11,365 |          53,786 |
| 同一 Verify 任务重复 next --session |          2,789 |          17,726 |

正常路径应直接沿用结果，不是按表全部查询。表中 status、details、重复 next 是有意测量的额外调用，不能把总和解释成每次任务必定花费。

单条验收的 Build status 中：`data.continuation` 为 2,011 B，包含同一内容的 `agent` 观察头为 2,230 B；`data.activeActions` 为 3,290 B，携带完整输入及结果模板。50 条时 `activeActions` 增至 30,484 B。普通任务响应仅保留当前任务与业务结果模板，因此小得多。来源：`domains/comet-native/native-sdk-status.ts:118`、`:220`；`native-sdk-continuation.ts:1723`；`native-sdk-task-command.ts:154`、`:363`。

批准响应中 `pendingAction` 为 2,221 B，同时存在包含它的 `pendingActions`（2,929 B）；虽已用 `inputRef` 避免复制输入，结果模板、领取协议等仍重复。来源：`native-sdk-continuation.ts:1748`。

### 已复现的高层 Shape 缺项

Shape 结果回报成功，状态为 `await-user`，但 `data.next.commandArgs` 为 null，`data.next` 没有 `commandAlternatives` 或可供批准的请求。返回说明要求使用 `commandAlternatives`，它却仅存在于随后 `status` 的 `data.continuation`。这会增加一次 9.5 KB 查询；50 条验收时增加约 28.4 KB。来源：`native-sdk-task-command.ts:185-241`、`:394-415`。

建议在高层结果直接返回等待中的决定信息、批准及修订的完整受保护命令，并保留原用户确认条件、版本及提案绑定。Shape 尚未批准时不能自动执行。这样消除额外 status，不影响任务打勾或用户选择执行方式。

## Classic 实测

| Runtime / 动作              | 输出 B |
| --------------------------- | -----: |
| SDK init                    | 12,000 |
| SDK state next              | 11,840 |
| SDK state next --details    | 13,231 |
| SDK state check open        | 12,064 |
| Compat state next           |  6,687 |
| Compat state next --details |  6,712 |

SDK 的 `data.continuation` 为 5,281 B，`agent` 观察头 3,400 B。相同的上下文获取命令和约 1,100 英文字符说明分别位于顶层 `continuation.contextRequest`、`continuation.current.actions[0].contextRequest`、`agent.continuation.contextRequest`。观察头已经把 `current` 改为 `currentRef`，但其他长字段仍复制。来源：`domains/comet-classic/classic-sdk-output.ts:263`、`:321`；`domains/workflow-contract/output-envelope.ts:93-110`。

该次测量的 tasks 命令因 tasks.md 尚不存在而失败，SDK 错误响应为 12,389 B，附带相同完整续行信息。它不能作为合法 Build 的任务打勾体积证据，也不能据此删除任务 CLI。合法 Build 的精确规模需另测。

## Skill 与上下文投递

| Skill 正文    | 中文 UTF-8 B / 字符 | 英文 UTF-8 B / 字符 |
| ------------- | ------------------: | ------------------: |
| comet         |       2,668 / 1,450 |       2,748 / 2,744 |
| comet-native  |      20,304 / 9,894 |     23,558 / 23,552 |
| comet-classic |      13,434 / 6,848 |     13,755 / 13,729 |
| comet-open    |     22,489 / 12,165 |     23,544 / 23,502 |
| comet-build   |       8,861 / 5,103 |       9,548 / 9,548 |

正文已要求按阶段读取参考、复用当前结果、不反复 status。Native 中文 `reference/commands.md` 为 59,031 B；其恢复、Compat、SDK 与 Supervisor 章节共存在一个文件，整份读取会增加可观上下文。但本次没有真实执行轨迹证明 Agent 总会整份读取，不能把潜在成本写成已测行为。

上下文选择器默认预算为 6,000 字符；SDK claim 使用 incremental，恢复才 snapshot。`contextDelivery` 已有时应读已交付正文而非再查一次。来源：`domains/agent-learning/context-director.ts:527`、`:559-623`；`app/commands/runtime.ts:410-495`；`domains/workflow-contract/task-context.ts:29-41`。因此没有证据说明它在正常路径无限投递记忆，也没有理由新增一层项目预算或降低要求覆盖。

## 可实施顺序与兼容边界

1. 先补全 Native 高层 Shape 决定，消除因缺字段触发的大包查询；同时审视其他 wait 和 reconcile 的高层必要动作是否被隐藏。
2. 观察头继续保留 phase、status、工作区、Run ID、动作和命令等可直接推进的信息；对同响应的长输入、上下文获取描述及模板使用明确引用，或只投影必要摘要。保留 `--details` 完整数据。不能靠 JSON 截断、head/tail、隐瞒错误或删验收条目减小输出。
3. Classic 去掉同响应相同 `contextRequest` 的冗余副本；真实执行方仍必须取得带自己会话标识的命令，不能把未绑定会话的模板当作已领取执行身份。
4. 合并 CLI 中反复出现的长说明，保留获取时机、空结果处理、真实身份、独立审查与批准边界。固定应用、旧 Run 及低层 SDK 客户端的字段读取须用兼容测试确认，不直接删除历史协议。
5. 任务首次交接要完整传递范围；同 Agent 的重复状态读取应尽量引用已交付正文，并保留清晰恢复入口。50 条验收确实需要比单条多的正文，不能据体积削减完整验收。
6. Skill 后续可按普通 v4 / 旧 SDK / Compat / Supervisor 分文件，让入口只指向当前分支；按仓库要求先提交中文确认后再同步英文。本次未修改 Skill，未宣称模型遵循效果改善。

验证应分别覆盖：普通任务完整流转、Shape 未批准不推进、修订不等于批准、原 Action/Run 恢复、独立审查要求、50 条验收不遗漏、旧 Run 与 details 保留完整输入。只有这些确定性边界通过后，再比较相同场景的新旧字节数；模型压缩次数须在获得 Eval 授权和相同平台设置后另测。

## 补查：插件 SessionStart 与工具 Hook

### 当前聊天已有真实重复输出

当前聊天的 Hook 输出目录 `C:/Users/BENYM/AppData/Local/Temp/hook_outputs/01a1c46a-677a-7871-b366-734f68121714/` 有三份逐字节相同的文本，均为 10,196 B：

| 文件                                     | 文件修改时间 UTC        | 大小 B |
| ---------------------------------------- | ----------------------- | -----: |
| 164e4152-b25c-4c65-b029-9d83b5475cdc.txt | 2026-11-10 07:44:34.570 | 10,196 |
| 75b9edda-9473-4e29-8b77-4a8379113db7.txt | 2026-11-10 08:19:17.477 | 10,196 |
| d50d597b-ef1c-4d53-b601-8d998b35e328.txt | 2026-11-10 09:11:23.913 | 10,196 |

每份均含“Comet 插件已接入”、完整 workflow guard Rule 和 CLI 入口。本机已安装 0.5.3 缓存的 Rule 为 9,967 B，三份日志均完整包含它；当前工作树源 Rule 为 10,060 B，两者不可冒充同一版本的字节基线。未修改安装缓存。

这些文件证明同一聊天已经重复收到全量 Rule。文件没有保存 Hook 原始事件的 `source`、`reason` 或输入 payload，因此不能仅据时间断言它恰好是每个用户 turn、每次 resume 或每次 compact。也不能将这三份输出当成三次工具写入事件。

### 源码所定义的触发时机

| 路径                                             | 配置事件                          | 实际输出                                                           |
| ------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------ |
| Codex 插件内置 `hooks/hooks.json`                | SessionStart，matcher 为 `startup | resume                                                             | clear                                          | compact` | `cli-setup-entry.ts` 输出简短 CLI 准备提示，随后准备全局插件接入 |
| `preparePluginIntegration` 安装的 Codex/DSH Hook | SessionStart，matcher 为空        | `runPluginHook` 每次读取并输出全量 workflow Rule；没有会话投递去重 |
| 同一接入安装的 Codex PreToolUse                  | matcher 为空                      | 调用 Router；普通允许操作 stdout 为空，不输出全 Rule               |
| 同一接入安装的 DSH PreToolUse                    | matcher 为 `write                 | edit`                                                              | 调用同一 Router，普通允许操作同样不输出全 Rule |
| Router 的 BeforeAgentStart 上下文事件            | 被平台调用时才进入                | 选择任务记忆正文；不读取整份 workflow Rule                         |

来源：`plugin/codex/hooks/hooks.json:3-35`、`plugin/codex/cli-setup-entry.ts:15-23`、`domains/skill/plugin-integration.ts:123-139`、`domains/skill/plugin-hook-entry.ts:95-152`、`platform/process/hook-adapter.ts:347-356`、`:434-496`、`domains/comet-entry/hook-router.ts:367-382`。

Comet 的插件接入只注册 SessionStart 和 PreToolUse，没有注册 UserPromptSubmit。配置合并会移除旧的 Comet 同类 Hook 再添加当前定义，防止安装多次累积；这是配置去重，不是上下文投递去重。来源：`domains/skill/platform-install.ts:1738-1765`。当前机器的其他插件确有 UserPromptSubmit 配置，不能把它们算作 Comet 注册行为。

DSH 的 `loadBundledSkills` 把每个 Skill 的 name、description、content 注册到平台 Skill 服务，并在插件进程中缓存读取结果；源码没有逐 turn 主动向模型打印全部 Skill 正文或 Skills 清单。平台如何展示注册表属于 DSH 的上下文组装行为，本次未启动真实 DSH，不能据注册了 content 就声称每轮注入全部正文。来源：`plugin/dsh/index.js:65-104`、`:568-577`。

### 调查比较方案：按项目状态决定投递（未采用）

SessionStart 根据当前项目是否存在工作流需求决定注入内容：

1. 复用 `discoverNativeProject(request.cwd)` 找到真正项目根，避免在子目录中误判。来源：`domains/comet-native/native-paths.ts:78-103`。
2. 用 `readCometCurrentSelection` 读取轻量 selection。只要 selected，包括 application 或尚未证实有效的旧选择，保留完整 Rule；读取失败也保留完整 Rule，以免丢失错误恢复约束。
3. selection 缺失时，复用 `resolveHookWorkflowOwner` 枚举真实活跃 Native/Classic change。只有结果明确为 `none` 才输出简短入口说明；`owned`、`inferred`、`ambiguous`、`stale` 和异常均保留完整 Rule。来源：`domains/comet-entry/hook-router.ts:183-323`。此函数对 application selection 返回 none，所以必须先执行上一步，不能直接拿 none 判断不存在应用需求。
4. 使用同一次读取缓存，不额外执行 CLI status，不迁移、不创建 selection、不推进 Run。每次 SessionStart 重新判断；resume、clear、compact 后不能沿用“过去已经投递”的持久标志而省略所需规则。

不要用 `resolveCometEntryResumeProbe` 的 out_of_scope 结果决定省略 Rule。该探针会因 `already_in_comet_flow`、用户语义及 `ambient_resume:false` 提前返回，即使真实活跃 change 仍存在。来源：`domains/comet-entry/resume-probe.ts:835-890`。同样，只有 config 不存在不能证明不存在旧 Classic 或用户级 Runtime 的有效归属。

上述比较方案对普通任务、配置已启用但零活跃需求的项目有直接收益；当前项目真实有活跃需求时仍会保留完整 Rule。它不能解决活跃任务跨 SessionStart 的全部重复成本，但没有引入“压缩后把规则去重丢了”的风险。若进一步精简活跃 Rule，应单独核对规则覆盖并按中文先确认的要求处理，不能仅以减少字节数替代语义完整性。

### 定向验证建议

在 `test/domains/skill/plugin-hook.test.ts` 的既有打包 Hook fixture 上补充以下分支，避免在真实平台配置上试验：普通仓库；配置存在但无 active；显式 Native、Classic 和 application selection；selection 缺失但唯一 active；多个 active；失效或非法 selection；config 无法读取；嵌套 cwd；同一 session 再触发 SessionStart / compact 恢复。前两类确认无全量 Rule，其余保留完整 Rule 或明确恢复信息；各场景确认未初始化普通项目、未写 selection、未推进 Runtime。PreToolUse 正常放行仍保持空输出，拒绝信息和阶段保护保持有效。

本次补查仅读取现成日志与源码，没有启动真实平台 Hook、没有运行模型 Eval，也没有更改产品或测试。文档 Prettier 检查通过。

补充恢复边界：`resolveHookWorkflowOwner` 在没有项目 config 时只使用 Classic legacy fallback，Native 的 `activeNativeContextImpl` 也会因 config 缺失直接返回 null（`domains/comet-native/native-hook-guard.ts:491-494`）。因此不能将这个分支的 none 直接当成“本机不存在 Native 需求”。在准备短提示前，可复用 `listSdkChangeNames(root, workflow, { partition: 'active', readOnly: true })` 核对 Native、Classic 的用户级活跃 owner；有 owner 或读取失败时保留完整 Rule，不必加载整个 Run 或历史正文。来源：`domains/workflow-contract/change-runtime-owner.ts:683-737`。config 缺失而 `.comet` 仍存在时，也可直接保留完整 Rule，以覆盖损坏恢复；没有 config 的旧 Classic 则仍按 legacy 枚举。新增负例应包括“config、selection 均丢失但用户级 SDK owner 尚在”。

### 本轮选定方案：短入口与按需读取完整 Rule

最终实施采用更轻的接入方式：SessionStart 始终返回简短入口说明和完整 Rule 的绝对路径。Agent 先轻读项目 config 与 selection；selection 缺失时按完整 Rule 的只读发现规则确定活跃需求、歧义或恢复条件。开始或恢复 Comet 推进、写入前必须读取完整 Rule；当前上下文已有且仍有效时复用，压缩后缺失则重新读取。普通任务保持中立，不自动初始化或启动 Eval。

这个方案不在 SessionStart 加状态枚举，不增加跨领域发现依赖，也不保存“已经投递”的永久标记。实际 PreToolUse Router 和阶段 Guard 保持不变。前节按项目状态判断是否投递全 Rule 的方案仅作为调查时比较过的替代，未选用；其损坏 config、SDK owner 和旧 Classic 发现问题解释了为何启动 Hook 内自行判断会膨胀。

可验证结论应限定为相同 SessionStart 输入下输出字节减少、完整 Rule 路径可读、恢复读取条件及原 Guard 测试仍通过。现成三份 10,196 B 日志是旧安装的真实输出基线，不是新实现的真实平台证据。本次调查没有安装或启用新 Hook，没有运行真实平台 Hook、真实模型或 Eval，没有测量实际压缩次数与模型是否遵循按需读取；这些层级不能用确定性 bundle 测试替代。

## 专项复核：CLI 工具调用实际返回什么

用户进一步明确关心的是 Agent 工具调用收到的输出内容。本报告前述 B 数均是实际返回 stdout JSON 的字节数，不是 CLI 安装文件大小；本节直接核对执行命令后的日志、结果与 Run 是否被回灌。

### 大 stdout / stderr 的实际执行

使用普通 Node 程序各打印 256 KiB stdout 和 256 KiB stderr，并分别退出 0 与 7。没有使用模型、容器、Eval、安装或构建。所有用户目录变量继续完整隔离。

Classic 公开命令是 `comet check run output-study build --json -- node check.cjs <0|7>`，先通过 Compat tweak 正常 Open Guard 进入 Build。原始 stdout、stderr、退出码、逻辑日志引用、实际日志路径及四个首尾标记保存于 `C:/Users/BENYM/AppData/Local/Temp/comet-tool-output-CqOB5b/measurements.json`，脚本为 `C:/Users/BENYM/AppData/Local/Temp/comet-tool-output-study.mjs`。

| 版本 / 操作          | 工具 stdout B | 工具 stderr B | 命令退出码 | 磁盘日志 B |
| -------------------- | ------------: | ------------: | ---------: | ---------: |
| 052 Classic 检查成功 |         2,806 |             0 |          0 |    524,318 |
| 052 Classic 检查失败 |         2,800 |             0 |          7 |    524,318 |
| 053 Classic 检查成功 |         1,899 |             0 |          0 |    524,318 |
| 053 Classic 检查失败 |         1,893 |             0 |          7 |    524,318 |

四份日志均包含 stdout 和 stderr 的首尾标记，CLI 的 stdout、stderr 都没有这些正文标记。失败保留真实退出码和 logRef，不把 512 KiB 日志塞回工具返回值。日志引用是 Classic 逻辑产物路径，真实文件保存在该隔离项目的用户级 Runtime classic-changes 目录；测量已按唯一日志文件身份找到实存文件，不把逻辑引用当作普通绝对路径。源码为 `domains/comet-classic/classic-command-checks.ts:877-922`、`classic-check-command.ts:447-484`。

上述体积不能解释成所有超大日志都无上限完整保存：Classic 该实现保留最后 2 MiB，调查日志总量小于这个边界。本次问题没有日志丢失证据，不为压缩反馈擅自改变这个策略。

052 Native v3 通过原 Verify 高层结果请求两个 managed checks，同样分别产生约 512 KiB 日志并退出 0、7。其整次工具返回为 stdout **3,320 B**，stderr 仅 **42 B** 进度；两份磁盘日志均为 **524,318 B**，四个首尾标记齐全，工具包没有长串日志正文。返回 checks 分别为 passed/0 和 failed/7，仅含身份、状态与 logRef。Native CLI 顶层退出 0 表示本次请求处理成功，不代表失败检查通过；Run 仍在 Verify。

原始数据在正式版本对照目录 `comet-052-context-audit-B6v5RL/native-large-log-measurements.json`，请求为 `native-large-log-request.json`，脚本为 `C:/Users/BENYM/AppData/Local/Temp/comet-052-native-large-log.mjs`。这次继续了隔离调查 Run，原先的 052/053 版本比较 stdout 文件未改写。当前 v4 新 Run 不再执行 managed checks，旧 Run 仍保留协议；当前 Native 执行器也将 stdout/stderr pipe 到日志流，outcome 只给结果和 logRef，来源为 `native-check-executor.ts:412-477`、`native-sdk-checks.ts:945-978`。本次没有为新 v4 伪造一个已不存在的 managed-check 路径。

**可以排除的具体猜测：** 上述成功及失败路径没有把检查的整份 stdout/stderr 回灌给 Agent，不需要再删日志或随意截断结果。未知平台自己的终端工具如何展示它直接执行的测试日志，仍需用户轨迹核对。

### 已确认的重复：Classic dispatch 的完整 Run 与紧凑投影并存

`app/commands/runtime.ts` 的 Classic 分支在 `host.output === 'compact'`、非 inspect、未指定 --details 时，仍用 `const view = { ...data, ...projection, ...claimedContext }`，其中 data 是完整 WorkflowRun。于是 cliResponse.data 仍包含 actions、actionContexts、outputs、state、input、waits、definitionHashes 等原始 Run 内容，又附加 run 摘要、continuation 和 configuration。0.5.2 tag 同一分支也有这个展开。来源为当前 `runtime.ts:1210-1240` 及 `git show 0.5.2:app/commands/runtime.ts`。

在全隔离 Classic SDK Open Run 上，实际调用生产 `runtimeDispatchCommand`，并使用 `app/cli/runtime-command.ts:66` 的同一 JSON.stringify(..., null, 2) 序列化，首次 claim 返回 **22,950 B**。这项证据是生产命令编排函数与同一 CLI 序列化边界，没有经过 bin 安装入口。原始返回与字段清单分别为正式对照目录中的 `classic-runtime-claim-output.json`、`classic-runtime-claim-measurements.json`；脚本为 `C:/Users/BENYM/AppData/Local/Temp/comet-classic-runtime-claim-output.mjs`。

该返回实际交付了隔离项目生成的 Project Knowledge manifest：正文 1,050 B，整个 context 数组 2,472 B，未读取真实用户知识库。原程序 API 的 response.data 仍为完整 Run。

可确定的精简方向是让 **cliResponse 的 compact 层**只保留必要 Run 身份、当前工作与投影；保留程序 API response.data、显式 --details 和 inspect 的完整协议。不能因优化展示而从存储删除历史 Action、批准或原结果。首次 Run 仅一条 Action，完整历史冗余尚小；随历史增长重复传播的成本需在具体多轮场景单独测量，不能把 22,950 B 全算作可删除内容。

### 已确认的重复：Classic contextRequest 说明

常规 state next 未领取时，相同 contextRequest 在 data.continuation、data.continuation.current.actions[0] 和 agent.continuation 出现三份。claim 后三份 instruction 仍逐字相同，但当前 Action 的命令绑定了实际领取 session，顶层与 agent 头仍是通用接收方占位值。

所以不能把 claim 后不同会话的整个 contextRequest 无条件合成同一个执行命令。安全方案应保留各自真实接收身份，引用相同的 instruction；或让 agent 观察头用明确 contextRequestRef 指向同响应的顶层原件，沿用已有 currentRef 的做法。完整协议仍可通过详情入口取得。此处只给出确定的重复及兼容边界，尚未修改产品或宣称测试通过。

## 当前 Classic 紧凑返回实现核对

本轮改动位于 `app/commands/runtime.ts:1209-1257`：仅在 Classic CLI 默认 compact、未指定 details、非 inspect 的分支，将原完整 Run 的展开替换为 protocolVersion、schemaVersion、runId、revision、status、workflow 六个身份字段，随后保留完整的既有 projection 和 claimedTaskContext。程序 API 的 response、显式 details、inspect、投影失败时保留原 Run 的恢复行为均未改动。

只读核对没有发现必需的当前输入、批准或会话被删：

- `classic-sdk-output.ts:263-309` 仍保留当前 Action、Wait、Evidence Wait 和与当前执行关联的审批。
- `classic-sdk-output.ts:108-229` 仍按已知内置格式提供当前输入摘要；未知格式保留当前 Action 的原 input，并保留详情读取指令，inputHash 绑定没有改变。
- 同模块 `:797` 的 configuration 仍是 Run.state 的完整用户配置；缩减的是额外 raw state 副本。
- `runtime.ts:1230-1234` 仍由原 Action 描述调用 claimedTaskContext，真实 session、contextDelivery 与恢复/展开命令继续生成。
- `test/app/runtime-command.test.ts:164-219` 增补了原 API actions、CLI 头身份、实际接收会话、inspect 与 details 完整不变的断言；原上下文采集次数断言保留。

`test/app/classic-runtime-compact.test.ts` 用正常公开 Open 批准、两轮 Design 拒绝和当前提案生成历史，没有手工伪造 Run。它核对旧提案未回灌、当前 Wait.proposal 和 proposalHash 完整、详情相同、真实 claim/session 和 configuration；需继续明确验证原 claim 的结果提交能够推进，并将当前已批准记录、当前输入摘要与 inspect 中原 Action 对应起来。源码保持这些字段不等于该续行行为已经执行通过。具体发布包 red/green、补充用例和最终检查结果由交付记录给出。

这项修复证明的是 Classic 工具回复重复带入了完整历史 Run，并使默认回复只承载当前工作。它没有复现该 0.5.2 用户的频繁压缩现场。用户的平台、workflow、实际调用序列与压缩阈值仍未知；Native 新 v4 和 053 插件 Hook 的改善不能被混用为这个 0.5.2 报告的根因或“升级必解决”的证据。
