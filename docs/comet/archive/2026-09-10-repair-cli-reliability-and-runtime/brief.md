# 目标

修复 2026-09-10 审核中 Classic、Native 及其公开 CLI/上游适配的全部已确认操作问题，减少 Agent 猜测命令、重写输入和重复恢复的次数，并缩短成功 Runtime 路径的实际执行时间。用户请求：用 Native 开启流程修复所有问题。不能把未经测量的“三分之一时间”当作已知基线或承诺收益。

# 范围

在当前 `0.4.1` 分支、`D:/Project/Comet` 目录使用一个普通 Native change 完成。共享 CLI 输出、平台路径/Git、插件桥接与生成物相互影响，集中验收整体契约；不建立 Supervisor 子 change。已有四份审核报告作为问题及复现依据保留。

## 审核问题覆盖

| 来源与问题                                                                     | 完整目标规格                                  | 验收          |
| ------------------------------------------------------------------------------ | --------------------------------------------- | ------------- |
| Classic 报告：绝对文件路径与相对登记/任务 authority 矛盾，legacy/docs 默认说明 | classic-efficiency；agent-cli-contract        | A1            |
| Classic 报告：嵌套 cwd 的设计定位错误                                          | classic-efficiency                            | A2            |
| Classic 报告：Design 登记后中断的恢复入口矛盾                                  | classic-efficiency                            | A3            |
| Classic 报告：快捷与完整入口参数、环境上下文、插件检查点不等价                 | agent-cli-contract                            | A4            |
| Classic 报告：OpenSpec 下一步命令的 cwd/adapter 冲突                           | agent-cli-contract                            | A5            |
| Classic 报告：Windows shell 改写字面 argv                                      | agent-cli-contract                            | A6            |
| Classic 报告：结构化错误不足、重复状态登记和上游读取                           | agent-cli-contract；classic-efficiency        | A7、A12       |
| Native 报告：Verify 数组模板不能提交                                           | agent-cli-contract                            | A8            |
| Native 报告：未知/缺失字段诊断、UTF-8 BOM                                      | agent-cli-contract                            | A9            |
| Native 报告：Supervisor 回报任务包不完整                                       | agent-cli-contract                            | A10           |
| Native 报告：动作缺 cwd、输出字段位置不一、成功后复读 status                   | agent-cli-contract；native-status-output      | A11           |
| 性能报告：task 六轮身份解析                                                    | workflow-cli-efficiency                       | A13           |
| 性能报告：命名 status 与分页先深读所有候选                                     | workflow-cli-efficiency；native-status-output | A14           |
| 性能报告：next 重复完整 Git 工作区检查                                         | workflow-cli-efficiency                       | A15           |
| 性能报告：实际 --activate 入口未采用等价快路径                                 | workflow-cli-efficiency                       | A16           |
| 性能报告：coldstart 失败命令及无效 fixture 也可计时                            | workflow-cli-efficiency                       | A17           |
| 汇总报告：Eval 逐调用时间、退出状态和重试关联缺失                              | workflow-cli-efficiency                       | A18           |
| 全部报告：安全不变量、双语/生成物/公共包一致性、实际可执行回归                 | 全部规格                                      | A19、A20、A21 |

来源是本仓库 `docs/research/2026-09-10-{classic-cli-operation,native-cli-operation,runtime-latency,classic-native-cli-reliability-and-runtime}-audit.md` 四份已完整审核的调查报告。历史模型 trace 仅说明一种纠正链；已经修复的旧问题不重复实现，未证实的版本不兼容或工作区路由错误不当作事实。上表保留所有当前有效修复项，没有以易测试的子集替换用户目标。

# 非目标

- 不合并 Classic/Native 状态机，不删除五阶段或 Shape/Build/Verify/Archive 的职责、确认和完整验收。
- 不修改上游 OpenSpec/Superpowers 原始 Skill，不绕过公开 Comet CLI 让用户或 Skill 找内部 bundle。
- 不新增常驻服务、调度器或跨命令不失效缓存，不修改 website。
- 不改变仓库级身份或迁移用户记忆/知识归属，不以关闭插件、删掉检查或隐藏错误获取速度。
- 不把没有原始数据的工具时间、失败率和缺失 usage 补零，不宣称已消除“三分之一”纠正成本。此次修复测量能力并进行真实 CLI 前后基准；付费模型批量 Eval 不自动启动。

# 验收示例

- A1：legacy/docs 布局、空格和中文路径下，Agent 直接使用 Runtime 返回的路径引用登记 design_doc、plan 和任务 authority 均成功；默认布局说明与现有配置解析一致，越界和其他 change authority 仍被拒绝。
- A2：同一合法设计在项目根和嵌套 src 运行 Build entry、Design transition/Guard 得到一致结果；显式检查 cwd 保持原有语义。
- A3：设计已登记后中断，普通和冷恢复入口保留有效成果并只返回剩余动作；缺文件、过期 handoff 或错误归属得到准确诊断，不能清空有效设计或绕过确认。
- A4：Classic 快捷/完整入口对四个 --comet-* 参数、COMET_TASK、help、-- 分隔符及成功/失败结果等价；需要记录的成功检查点恰好一次进入公开插件 Bridge，插件失败不改变主命令结果。
- A5：从 docs 布局项目根按 OpenSpec adapter 返回动作依次执行 new、status、instructions，始终定位同一 change；上游原结果与退出码仍可读取，JSON 既有消费方式保持兼容。
- A6：Windows 实际受支持 Node CLI/shim 的空参数、空格、中文、引号、反斜杠、百分号、感叹号和 & 按字面传递；fixture 环境变量不被展开，未知且不能安全解析的 shim 明确失败；非 Windows 继续直接传 argv。
- A7：Classic 非法参数、入口失败和 Guard 失败直接提供可解析的错误代码、字段/期望及安全恢复动作；整体失败不因内部子检查 passed 而被误判，Agent 不必解析 ANSI 或二次解码 JSON 字符串。
- A8：Native Build、dispatch、等待 Verifier 的每个输入选项均是一份可独立提交的对象；按返回条件选项并只填写业务字段，可完成正常流程及 request-checks/error/unavailable 分支。
- A9：Native 错拼、缺失或额外字段返回准确路径和 missing/unknown 信息及当前输入结构；有效 UTF-8 BOM 文件成功，非法 JSON 和错误验收字段仍拒绝。
- A10：Supervisor Builder、checks、Verifier 和 integration 的任务返回完整控制目录、实现目录、回报 argv 与预填身份模板；按任务包回报成功，过期 runId 和错误候选仍拒绝。
- A11：new/status/next 提供统一且有界的 Agent 观察与执行上下文，旧 data 保持兼容；成功变更后直接消费返回的下一步，只有恢复、并发失效或外部变化才重新查 status；跨 worktree 不需要猜 cwd。
- A12：Classic 同一授权边界内的成果登记、handoff 和阶段推进可恢复地协调，失败保留成果和证据；连续成功阶段不要求重复 next/entry/逐字段 get，Open 未发生修改的首轮 status 和同次操作的上游读取可复用，变更后重新验证。
- A13：固定空上下文 task 场景中同一项目的身份解析有 origin 最多一次 Git、无 origin 最多两次；ID、名称、插件记录和工作区索引归属不变，下次调用修改 remote 能重新解析。
- A14：1/10/30 个真实 worktree 各有一个唯一活跃 change 的场景，查询同一目标 Git 次数不随无关 change 增长且最多五次；不深读无关 Runtime，列表只投影当前页，仍正确检测同名活跃/归档关系与冲突。
- A15：有效 Shape prepare 的 Git 调用从九次减少至最多七次，同机同 fixture 中位耗时下降；写入前、锁内绑定和外部并发变更的必要校验继续有效。
- A16：已配置项目的公开 workflow resolve --activate 走契约完整的快路径，零 Git；与完整门面的输出、退出码、激活副作用一致，未初始化/部分/非法配置、重复激活、context/help/未知参数都得到正确处理。
- A17：基准使用隔离 HOME/cwd 的合法状态；spawn 错误、超时、非预期退出或错误后置状态使检查失败且不能覆盖基线；记录命令、构建身份、样本/预热、输出字节和 Git 数，状态复原在计时外。
- A18：Eval 保留可用的 invocation/tool ID、开始/结束/耗时、退出码、错误分类和时间来源，正确处理并发交错、重复和中断；缺失值保持未知，只有明确证据才关联重试，工具往返时间不冒充 Runtime 时间，旧事件兼容且凭据不落盘。
- A19：回归验证状态版本、runId、候选/回执、完整验收、路径保护、同名归档身份、锁和插件失败隔离；不存在因性能修复而放宽的错误放行。
- A20：中文产品 Skill 先完成后同步英文，两者命令与行为一致；源代码、公开 CLI、生成 Runtime 和实际打包资产一致，相关格式、lint、构建、生成一致性与全量测试完成并如实记录。
- A21：全部原始失败/纠正链用实际 CLI 复验，热点采用相同环境和成功 fixture 前后对照并满足进程预算；提供覆盖每项验收的证据，模型总时间收益没有数据时不作结论。

# 约束与不变量

遵守根目录及各层 AGENTS.md。当前基线为 `1617fa06`，已安装用于本次工作流的公开 CLI 是 0.4.0；修复与测试对象是工作树 0.4.1 源码及重新构建的公开资产，二者证据分开。状态仅由公开 Native Runtime 写入。

沿用 native-reliability、native-ambient-resume、native-status-output、classic-config-block、memory-workflow-integration、comet-plugin-runtime 和 project-knowledge 的既有安全语义。性能缓存只在明确的观察有效期内共享，关键写入/锁和 Git 变更后刷新；外部并发仍需检测。

版本按 master 和上一发布 tag 实时核对，用户可见修复追加到已有下一版本英文 Changelog；普通测试和开发过程不写成发布功能。只显式暂存当前 change 文件，保留报告和无关工作；不自动评论或创建 PR。

# 决策

- 用户已明确要求全部修复并使用 Native；采用一个普通 change，在当前 0.4.1 分支推进。当前未提交文件均是本任务四份审核报告，没有其他活跃 change。
- 接口采用已有 continuation 的增量扩展，保留旧 JSON data，新增一致的 Agent 观察与可执行动作；不建立另一套状态机。
- 修复顺序：先协议/恢复/适配正确性，再减少管理往返与重复 Git，最后在真实生成物上验证等价性与性能。
- 普通实施方法由 Agent 选择，独立复核和最终 Verifier 按 Native 执行；不调用外部 Superpowers 工作流。
- 完整范围和上述中文行为将在 Runtime 保存确认边界后交用户最终确认；该确认也作为对应中文 Skill 行为同步英文的语义依据。实际文本若引入新行为，另行对齐。

# 待解决问题

无未解决的范围或产品行为分歧。等待 Runtime 准备完整 Shape 的最终确认边界，不以创建 change 或用户最初请求代替该确认。

# 验证预期

每模块先运行最小回归，再构建 Classic/Native/Entry 及受影响 CLI；运行真实 OpenSpec/Windows argv、生成模板提交、插件事件等价、跨 worktree 状态与 1/10/30 规模实验。性能先冻结有效基线与协议后置条件，修复后同机比较，不使用失败快速退出作为成绩。

交付前运行受影响文件 Prettier、pnpm lint、pnpm build、生成一致性和全量测试；失败先定位明确原因，不反复盲跑。新的只读代码复核通过后提交 Builder handoff，由 Runtime 执行正式检查并启动新的独立 Verifier，逐项验收全部范围。真实外部 Hook/用户平台或模型 Eval 未执行时明确列出；没有这些证据不得宣称对应平台或模型收益。
