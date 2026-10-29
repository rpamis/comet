# 编辑后继续原流程

Build、Verify 或待归档阶段出现实际文件变化，或 continuation 提示内容判断时读取。Native 与 Classic 均由当前 Agent 判断语义和影响，Runtime 保存原始变化、判断及真实检查结果。

1. 连续编辑在下一次推进时一起处理。复用当前 change、Run、阶段、Action 和已有上下文；需要变化清单时运行 `comet edit-review observe <native|classic> <change> --session <当前会话> --json`。实际字节未变时继续原动作；暂存、取消暂存和空提交单独核对明确依赖 Git 的检查，不重新验收相同内容。
2. 当前 Agent 读取变化文件、原输入清单、可取得的旧内容或 Git 差异，以及当前需求和调用关系，判断实际影响。检测不依赖文件扩展名、代码解析器或编译器；实际验证命令由 Agent 按项目和本次风险选择。缺少判断必需的原文时先取得证据，不能将摘要当作原文。
3. 使用响应中的 `recordTemplate` 记录 `non-behavioral`、`implementation-changed` 或 `requirements-changed` 及依据。通过 `retainedCheckActionIds` 或 `retainedChecks` 明确列出仍适用的原检查，保留原 Action、执行环境、日志和结果来源；只补受影响或缺失的检查。当前 Agent 沿用已领取 Action，或使用返回的同会话领取信息；普通编辑不增加独立审查会话或用户确认。
4. 正式 brief、Spec、Design Doc 或计划变化时，运行 `comet edit-review prepare-applied <native|classic> <change> --session <当前会话> --json`，取得已批准原文后判断。契约未变则保留原批准、阶段和验收项；目标、验收标准、方案或授权发生实质变化且未被已有决定覆盖时，只说明受影响的决定并请求确认。机器状态、报告、锁、检查收据和归档记录仍由 Runtime 管理。
5. Verify 中保留原 Verifier 和有效检查；真实实现变化按当前 Runtime 的修复动作处理，保留原需求批准和未受影响的检查；后继候选重新验收。已接受结果、尚未执行归档时，普通说明变化仍保留报告和接受结果；需要补检查时填写观察返回的 `refreshInputTemplate`，执行 `comet edit-review refresh-checks <native|classic> <change> --file <输入文件> --json`，再执行响应要求的原 Run 检查动作。检查全部适用后继续原归档；交付目标或授权变化仍须取得相应决定。
6. 判断后再次编辑，只处理新增变化。新失败、中断、超时、结果未知或未执行均保留真实状态，不能用旧成功覆盖；不可重复的操作先核对原执行。相同补检查请求重试沿用原 Action，归档中断沿用原事务，已完成副作用不重复执行。

完成条件：当前变化均有适用判断，必要检查有真实结果，原有效批准和证据保留，并能继续当前动作。结构、机器状态或产物确实损坏时，使用 Runtime 指定的诊断与恢复步骤；旧记录缺少原文或完整输入证据时只报告和处理具体缺项，不补造历史证据。

显式严格配置和原有尚未应用的编辑请求沿用 Runtime 返回的受保护流程。它们不能被普通编辑判断绕过。
