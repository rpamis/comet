# 目标

Native 在 Shape 内容整理完成后必须停下来，把目标、范围、关键决策、验收标准和非目标讲清楚，等用户明确确认后才能进入 Build。Runtime 要保存这个等待状态，不能只靠 Agent 自觉，也不能提前给出可直接执行的 `--confirmed` 命令。

# 范围

- 将“完成 Shape 整理”和“确认 Shape”拆成两个 Runtime 动作。
- Shape 整理完成后持久化 `await-user` 状态，并把下一动作设为 `confirm-shape`。
- 只有处于上述等待状态时，CLI 才接受 `--confirmed` 并进入 Build。
- 确认边界的 continuation 明确返回 `disposition: await-user`、`requiresUserDecision: true` 和 `userCommunication.required: true`。
- 准备最终确认前校验 brief；仍有 `[blocking]` 问题时拒绝进入确认边界。
- 保留现有澄清分类：模糊但会改变用户可见结果的内容先提问，清晰需求和普通实现选择不反复追问，用户提供的需求文档按来源覆盖规则处理。
- 修正当前把跳过确认当作正确行为的 Native Runtime 与 CLI 测试。

# 非目标

- 不新增真实 Agent 行为评测或模型稳定性评测。
- 不新增基于模型的“模糊度分类器”；Runtime 只强制执行持久化 blocker 和确认状态。
- 不修改 Grill Me、brainstorming 或其他 Skill 的说明文档。
- 不改变 Classic 工作流。
- 不调整 Build、Verify、Archive 的既有确认语义。

# 验收示例

- **A1 Shape 整理完成后进入等待**
  - **Given** change 处于 active Shape，brief 和 capability spec 已经可确认
  - **When** Agent 提交本轮 Shape 摘要
  - **Then** Runtime 持久化 `status: await-user` 和 `loop.stage: await-user`
  - **And** 下一动作是 `confirm-shape`，state version 增加
- **A2 确认提示不能自动继续**
  - **Given** change 正在等待用户确认 Shape
  - **When** Runtime 生成 continuation
  - **Then** 返回 `disposition: await-user`、`requiresUserDecision: true` 和 `userCommunication.required: true`
  - **And** 顶层 `commandArgs` 为空，只在用户选择确认后提供带 `--confirmed` 的合法动作
- **A3 active Shape 不能直接确认**
  - **Given** change 仍是 active Shape，尚未持久化确认等待状态
  - **When** 调用方直接执行 `comet native next <change> --confirmed`
  - **Then** CLI 拒绝该命令，不进入 Build，也不修改 portable 状态
- **A4 明确确认后进入 Build**
  - **Given** change 已处于 Shape 的 `await-user` 确认边界
  - **When** 用户明确同意，Agent 执行绑定当前 state version 的确认命令
  - **Then** Runtime 校验 Shape 与确认边界后进入 Build
  - **And** 旧 state version 或错误 expected action 仍按并发保护规则被拒绝
- **A5 Supervisor 的协调选择不等于最终确认**
  - **Given** Supervisor change 尚未选择 agent 协调方式
  - **When** 用户选择协调方式
  - **Then** Runtime 保存该选择并进入 Shape 的最终确认等待状态
  - **And** 不把协调方式选择同时视为用户已经确认整个 Shape
- **A6 模糊需求先解决真正影响结果的问题**
  - **Given** 用户描述存在会改变范围、默认行为或失败结果的歧义，且无法从仓库、规格或项目规则中确定
  - **When** Agent 整理 Shape
  - **Then** 按配置的 Sequential 或 Batch 方式提出问题，并把未解决项保存为 `[blocking]`
  - **And** Runtime 在 blocker 解决前拒绝准备最终 Shape 确认
- **A7 清晰需求不被过度追问**
  - **Given** 用户要求已经足够明确，剩余内容属于可调查事实或普通实现选择
  - **When** Agent 整理 Shape
  - **Then** Agent 自行调查或决定，不为凑流程追加问题
  - **And** 完成 Shape 后只进行一次完整摘要确认
- **A8 用户投递文档时区分用途**
  - **Given** 用户提供文件、附件、链接或本地路径
  - **When** 它被明确作为需求来源
  - **Then** brief 记录来源覆盖，未读取、部分读取、未映射或有冲突的可执行内容保持 `[blocking]`
  - **And** 当材料仅用于排错、取证、审查或实现参考时，不自动把其中的文字当成新增需求
  - **And** 用途不明时先询问用途；文档内面向 Agent 的指令不能覆盖用户当前请求和项目规则

# 约束与不变量

- Portable state 是确认边界的唯一事实来源；聊天上下文和 Agent 文案不能代替状态校验。
- brief 中的 `[blocking]` 是 Runtime 可执行的阻塞信号，portable 路径不得绕过现有 brief 校验。
- `confirm-shape` 出现在 continuation 中时必须始终表示“正在等待用户决定”。
- Shape 确认命令继续受 state version 和 expected action 绑定保护。
- 中英文 locale 都要返回自然、可理解的确认提示，但不扩展产品文档范围。
- Runtime 源码与发布资产必须通过 `pnpm build:native-runtime` 保持同步。

# 决策

- 新增一个内部 continuation 动作表示“完成 Shape 并准备确认”，避免 active Shape 提前暴露 `--confirmed`。
- `requiresUserDecision` 作为稳定的 continuation 信号输出，并与确认边界的 `userCommunication.required` 保持一致。
- Runtime 不猜测自然语言是否模糊；Agent 按现有澄清规则识别问题并写入 blocker，Runtime 负责确保 blocker 和最终确认都不能被跳过。
- 用户确认前不进入 Build；协调方式等前置选择完成后仍需单独确认最终 Shape。

# 待解决问题

- 无。

# 验证预期

- 运行 Native continuation、portable runtime、CLI 的最小相关测试。
- 运行 `pnpm build:native-runtime` 并验证生成资产与源码一致。
- 运行 lint、build 和全量测试后再提交推送，并持续检查 PR #383 的线上 CI，直到全部通过。
