# 目标

修复 Classic、Native 和共享 Hook 在实际连续操作中出现的错误证据复用、重复检查、不可执行恢复动作、无关状态扩大阻塞、可选插件拖慢写入、无意义需求重确认以及归档后无法自然恢复等问题。最终行为应保证：检查证据只在输入身份仍一致时复用，Runtime 返回的自动动作在当前状态可执行或明确暂停，流程拒绝只影响相关对象，并且重复推进能够收敛而不丢失已经完成的工作。

# 范围

- Classic 检查要求、执行证据、输入快照、Guard 推断与恢复命令。
- Classic Build/Verify 间的有效证据复用、检查输入与输出边界，以及归档后待交付状态的恢复。
- Native handoff、dispatch、retry 和 status/next 的统一检查计划与 continuation 投影。
- Native 检查输入身份、失败预算、重试耗尽、需求重开和 Shape 非语义格式变化。
- Entry Hook Router 的 owner 定位、无关损坏 change 隔离、插件上下文关键路径和版本注入。
- Native 与插件文件锁的进程身份、诊断类别和可恢复行为。
- 中英文 Skill 中与实际检查复用和恢复行为冲突的说明。
- Classic、Native、Entry 生成 Runtime，同步的回归测试和 0.4.2 Changelog。

# 非目标

- 不合并 Classic 与 Native 状态机，也不改变两者各自的产物格式和阶段名称。
- 不降低独立 Verifier、候选身份、目标 change 自身状态、交付授权或语义需求变更的安全检查。
- 不自动修复与本 change 无关的历史损坏归档 `native-document-constraints`。
- 不根据本机受控锁争用样本承诺生产环境的固定平均耗时或百分位。
- 不新增外部服务、后台守护进程或必须联网的工作流依赖。

# 验收示例

- 从检查通过开始，依次经历实现内容变化、Git 提交、进程重启、检查超时、重试耗尽、无关 change 损坏和归档后交付中断时，Runtime 只复用仍与当前输入一致的证据；每条自动 continuation 能执行或进入带合法出口的暂停状态；无关对象和可选插件不会阻塞当前合法写入，已完成的工作保持可恢复。

# 约束与不变量

- 目标 owner 自身损坏、当前候选输入变化、语义需求变化和未获授权的交付仍然 fail closed。
- 纯提交但内容不变时可以复用证据；内容变化时必须失效，不能用 Git porcelain 状态代替内容身份。
- 独立 Verifier 的判断不能由 Builder 本地检查替代；跨阶段复用仅适用于同一命令、输入、环境和执行结果。
- 可选 Personal Memory、Project Knowledge、学习和 outbox 失败或超时不能改变已经得出的 Guard 许可结论。
- 锁恢复只回收能够确认属于已结束进程实例的 owner，不按锁年龄强制抢占仍可能活动的 owner。
- Runtime 源码是权威实现；生成资产必须由构建脚本同步，不能直接手改 bundle。
- 保留当前分支全部无关修改和 website 子模块状态，提交时只暂存本 change 文件。

# 决策

- 使用一个普通 Native change 推进，不拆成 Supervisor children。各问题共同依赖证据身份、状态投影、恢复动作和生成 Runtime 契约，拆分会让共享类型和端到端验证反复集成。
- 检查记录建模为稳定的检查要求与可引用执行证据；阶段引用证据，不再把“某阶段最新一条记录”当作要求本身。
- 性能优化以语义等价为前提：完整内容身份是正确性基线，增量路径必须覆盖 dirty→dirty、改后提交、分支变化和生成输入。
- Guard 默认评估已有证据；自动发现只返回候选动作，不用不同命令覆盖显式失败。
- continuation 从持久状态和本机执行记录的统一投影生成，次数耗尽通过状态转换表达，不通过抛错后继续建议重试。
- Hook 先按目标路径和明确 selection 定位 owner，再读取唯一相关状态；无关损坏由 Doctor 诊断。
- Hook 只消费已准备的插件上下文；学习、索引刷新和 outbox 重放退出写入许可关键路径，并使用有界总预算。
- Shape 内容身份忽略换行风格和行尾无意义空白，但仍对范围、约束、验收和其他语义文字变化重新确认。
- 当前 package 已是 0.4.2，而 `origin/master` 是 0.4.1；本 change 追加到既有 0.4.2 Changelog，不再升级版本。

# 待解决问题

- 无。

# 验证预期

- 为每项已复现问题加入对应的最小回归测试，并增加严格消费 Runtime continuation 的跨进程生命周期测试。
- 运行受影响的 Classic、Native、Entry、插件和锁模块测试；对输入快照覆盖 dirty→dirty、修改后提交、分支切换、输出变化和纯提交不失效。
- 运行 `pnpm verify:changed --base 99265aa2e3de35c623acf8f0f938d1ec534f6b29`、`pnpm lint`、`pnpm build`、`pnpm check:generated`。
- 由于改动跨越 Classic、Native、Entry、插件、平台锁和发布资产，最终运行一次仓库全量测试；出现首个明确失败后先分类修复，不并行启动第二轮。
- 在临时项目用生成 Runtime 复跑本次审查中的 Classic、Native、Shape、Hook 和锁序列；真实模型 Eval 和生产性能采样若环境不可用，明确列为未执行，不能由单元测试替代。
