# Verify 中的编辑复核

仅在 Verify 中写入被 Hook 拒绝并提示复核，或 continuation 指向 edit-review 时读取。本协议适用于 Native 和 Classic；工作区、候选与审批仍由各自 Runtime 管理。

1. 使用同次响应的 continuation；缺少复核任务时运行 `comet edit-review show <native|classic> <change> --json`。不要仅因 hash、文件扩展名或语法结构变化就回滚阶段。Runtime 能本地证明的修改直接处理，不能证明时保留 Verify 等待复核。
2. SDK 由独立于 Builder 的会话执行返回的 claim 命令，`--session` 使用稳定的平台任务标识或本次执行引用。该引用只用于关联，不验证平台身份。原 Verifier 已结束时可以启动新的独立复核会话；不重新领取或占用正式 Verify Action。若任务缺少原始编辑内容，将原工具请求保存为临时 JSON，通过 claim 的 `--file` 提供；多份提案按返回的 proposal hash 逐份处理。
3. 复核者读取当前文件、完整原始请求、具体差异、使用方和当前验收要求。使用返回的 recordTemplate 填写 non-behavioral、implementation-changed 或 requirements-changed 及具体依据，通过返回的 record 命令提交。无法确定时保持待复核。Compat 没有 SDK 领取记录，由用户明确确认结论后用 `record --confirmed` 提交；不能自行批准。
4. non-behavioral 通过后，重试完全相同的原始编辑。回执不执行写入；未应用的编辑不能通过验收。随后补跑失效检查，继续当前 Verifier 与验收。实现或需求变化按各自流程返回 Build 或需求确认；不把复核结果当作验收通过。
5. 中断后沿用同一会话和提案恢复；输入临时文件保持到编辑应用或提案丢弃，用后删除，不进入提交或报告。输入文件缺失或内容改变时重新提供真实请求，不伪造原请求。准备放弃尚未应用的提案时，通过 recordTemplate 提交 decision: discard；实际文件已改变时不能用丢弃复核掩盖变化。

已有 SDK 当前独立 Verifier claim 的集成可继续使用原 claim 提交；新的独立复核领取路径用于补齐尚未启动、已经结束或无法复用原领取的情况。两者均绑定当前候选，不能跨候选重放。
