# 目标

修复 Issue #440：项目暂停个人记忆学习时，自动观察不得运行记忆评审、保存观察正文或占用恢复后的去重身份；恢复后重试同一观察应能正常进入学习流程。兼容 0.4.1 已经写入但没有形成有效证据的孤立 observation。

# 范围

- 个人记忆自动观察从评审入口到 `PersonalMemoryService.observe()` 的暂停和全局学习开关语义。
- 暂停状态下的无正文诊断结果、学习计数和去重行为。
- 旧状态中未形成 `state.evidence` 的成功 observation 的恢复重试。
- Local Provider 的领域实现、插件桥接、相关测试、构建产物和用户可见变更记录。

## 来源覆盖

| 来源条目与位置                                    | 读取状态 | 需要保留的内容                                                            | Spec 位置                                                     | 验收 ID    | 覆盖状态 | 理由             |
| ------------------------------------------------- | -------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------- | -------- | ---------------- |
| S1：GitHub Issue #440“Current behavior”           | complete | 暂停后返回 ignored，但仍评审并保存完整正文                                | specs/personal-memory-learning-pause/spec.md 的暂停场景       | A1、A2     | covered  | 当前可复现的缺陷 |
| S2：GitHub Issue #440“恢复后重试”                 | complete | 相同身份不能因暂停期间的 observation 被错误去重                           | specs/personal-memory-learning-pause/spec.md 的恢复场景       | A3、A4     | covered  | 当前可复现的缺陷 |
| S3：GitHub Issue #440“Expected behavior”          | complete | 暂停在评审和正文持久化前生效，必要时只保留不含正文的诊断                  | specs/personal-memory-learning-pause/spec.md 的暂停与诊断场景 | A1、A2、A5 | covered  | 用户可见行为要求 |
| S4：现有 Personal Memory 规格的显式操作和失败语义 | complete | 自动学习暂停不阻止显式 remember/correct/forget/rollback，失败不破坏原状态 | specs/personal-memory-learning-pause/spec.md 的边界场景       | A6、A7     | covered  | 保持既有能力契约 |

# 非目标

- 不改变记忆 Provider、Remote API、检索暂停或显式记忆管理的产品语义。
- 不删除用户已有的合法个人记忆，不批量清空整个 `observations` 数组，不引入完整迁移层。
- 不修改 Native/Classic 主工作流状态机，不处理 Issue #440 未验证的 Remote Provider 和完整工作流 E2E。
- 不把完整观察正文写入新的诊断日志、学习状态或错误消息。

# 验收示例

- A1：暂停项目学习后自动观察返回 `ignored`，不调用记忆评审，且不新增含正文的 observation。
- A2：暂停期间只允许记录不含正文的跳过原因和计数，已有候选和记录保持不变。
- A3：恢复学习后重试同一 workflow、change、candidate-key 和正文，首次有效观察可以创建候选，不返回 `deduplicated`。
- A4：0.4.1 风格的孤立成功 observation（未被 `state.evidence` 引用）不阻止恢复后的首次学习；已形成有效 evidence 的 observation 仍保持正常去重。
- A5：全局学习关闭和项目暂停使用一致的自动学习跳过语义，并且学习状态计数不把 ignored 计为有效观察。
- A6：显式 `remember`、`correct`、`forget` 和 `rollback` 在自动学习暂停时仍遵循原有显式操作语义。
- A7：学习状态、文件锁和投影写入失败时保留原有错误/降级语义，不产生半写入或重复记录。

# 约束与不变量

- 评审前检查用于减少无效评审和延迟；存储层在持久化锁内执行最终权威检查，不能只依赖入口检查。
- 不在模型或外部评审运行期间长期持有记忆文件锁；并发暂停在提交阶段必须阻止自动 observation 写入。
- 只有已经被有效 evidence 接受的 observation 才能占用自动学习去重身份；ignored、skipped、deferred 或没有 evidence 的孤立 observation 不得阻塞首次重试。
- 显式用户操作与自动学习使用不同边界；暂停自动学习不能拒绝显式用户意图。
- 保留现有 Local/Remote Provider 契约和版本兼容性；本 change 只在已验证的 Local 路径建立回归保护。

# 决策

- D1：采用“评审前快速跳过 + 存储锁内权威检查”的双层保护。前者避免评审和管理查询，后者处理并发和绕过插件入口的调用。
- D2：去重只认已形成有效 evidence 的 observation，修复 0.4.1 已污染状态时不批量删除合法历史数据。
- D3：暂停自动学习期间保留最小诊断状态，不保留观察正文、normalizedText 或新的候选证据。
- D4：本 change 使用单一 Native change，不拆分子任务；实现集中在同一记忆领域和插件入口，拆分会增加状态协调成本。

# 待解决问题

无。实现方法、显式操作边界、旧状态兼容策略和验收范围已根据 Issue、当前代码和现有规格确定。

# 验证预期

- 运行 `npx vitest run test/domains/comet-memory/personal-memory.test.ts test/domains/comet-memory/memory-experience.test.ts test/domains/comet-plugin/plugin-integration.test.ts`。
- 运行受影响源码的 `pnpm lint` 目标检查，以及必要的构建/生成检查，确认发布产物与源码一致。
- 通过独立 Native Verifier 复核全部 A1-A7，至少覆盖暂停→观察→恢复→重试、旧孤立 observation、显式操作和并发提交边界。
