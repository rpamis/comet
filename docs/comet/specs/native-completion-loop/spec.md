# native-completion-loop

## 目标

Native 必须把一次 Agent turn 视为一次可恢复迭代，而不是完成证明。只要 Runtime 仍能从当前 acceptance matrix 和验证结果中识别可处理缺口，工作流就必须在现有 Build ↔ Verify 路径继续收敛；只有 `done`、真实的 `await-user` 或不可自动恢复的 `blocked` 才是当前执行终态。

## Build acceptance 视图

- Build 阶段的 `status <change> --details` 必须使用现有 acceptance cursor 分页返回完整 acceptance 集。
- 每个 acceptance item 必须投影上一轮 Runtime 校验后的状态，包括至少 satisfied、failed、missing 或未验证状态，以及可安全公开的关联 failed check IDs。
- Agent 可以每轮处理一小批相关 acceptance，并使用现有 checkpoint 保存 summary、next action 和真实 artifact refs。
- checkpoint 只用于恢复，不得被 Runtime 接受为 acceptance 已满足、Verify pass 或 Archive 就绪的证据。

## Verify 缺口回灌

- Verify fail 必须从已校验的 canonical matrix/envelope 派生 failed/missing acceptance IDs 和 failed check IDs，不接受另一套自由文本缺口清单。
- Verify fail 回到 Build 后，continuation 必须使用 `work-phase` 或 `repair`，并明确要求先处理上一轮缺口；不得默认返回立即再次推进 Verify 的命令。
- Build 的详细 acceptance 页必须投影这些缺口，使恢复后的 Agent 无需依赖聊天历史即可选择下一批工作。
- 任一 mandatory acceptance 缺失、failed、skipped、blocked、stale 或证据不足时，Runtime 不得产生最终 pass。

## 语义进展与停止

- 重复失败签名必须绑定当前 `contractHash`、排序并去重后的 failed/missing acceptance IDs，以及 failed check IDs。
- 只有未满足项减少、失败检查转绿或缺失证据变为当前有效证据才算语义进展；仅 implementation snapshot、文件 hash 或代码行发生变化不算进展。
- 相同语义缺口第二次出现时必须 warning，第三次出现且没有语义进展时必须停止。
- scope 不变但存在明确新假设时，允许对同一 signature 使用一次显式 override；不得重复 override。
- 同一 contract 的总 Verify-fail 上限默认为 5 次；项目可以在 `.comet/config.yaml` 中通过 `native.max_verify_failures` 配置大于等于 1 的整数覆盖默认值。字段缺失时使用 5，零、负数、非整数或非数字配置必须校验失败，不得静默回退。
- 每次 Runtime 接受一个 Verify fail 都消耗一次 contract 级预算；达到配置上限时必须停止。相同语义缺口第三次出现的停止条件独立生效，因此可以早于总上限停止。
- 普通 implementation 变化和同一 contract 内的语义进展均不得重置该预算；修改配置也不得回溯清除已经累计的失败次数。
- 只有用户确认后的 contract 变化才能开始新的目标周期并重置 contract 级预算。

## 完成与归档边界

- `done` 仅在 #240 的完整 acceptance matrix、required checks、typed receipts、独立 review、Archive freshness fence 和 Archive 事务全部通过后返回。
- 外部 signer/reviewer、repair stop、contract 决定或 #238 `required` 归档确认必须返回真实 `await-user`；不可恢复错误或预算耗尽返回 `blocked`。
- Verify 失败或仍有 missing/failed acceptance 的中间迭代不得运行 Archive preview，也不得产生归档确认。
- 最终 Verify pass 后才运行一次 Archive preview，并读取 `native.archive_confirmation`：`automatic` 继续归档，`required` 在最终候选处返回一次 `await-user`。
- 归档等待不得增加 Verify-fail 计数、消耗 repair/loop 预算或重新运行仍然新鲜的 Build/Verify。
- 用户保留 active change 后若提出修改，旧证据与 preflight 失效并开始新的 Build → Verify 周期；只有新周期再次成功才可能再次询问。
- Loop 不得覆盖、改写或推断 `native.archive_confirmation`。

## 兼容与验证

- 不新增 Native phase、独立 Loop Engine、新 CLI 命令、Goal 状态文件或外部 Skill 依赖。
- 删除 change 创建授权和 `signed-v2` 创建协议，不提供兼容读取或可选 trust mode；高风险独立审查只由当前 implementation scope 触发。
- 不含已删除创建授权格式的旧 archive 继续可读。
- acceptance page、status 和 continuation 输出必须有预算、可分页并跨平台稳定。
- 中英文 Native Skill、Runtime 源码和生成资产必须同步。
- 回归测试和真实生命周期 Eval 必须覆盖“遗漏 spec → 回 Build 修复 → 再 Verify → Archive”、语义停滞停止、总预算，以及两种归档配置。
