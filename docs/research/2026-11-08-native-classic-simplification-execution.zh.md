# Native / Classic 减负执行记录

2026-11-08，分支 `053`，基线 `2999b60d0b1a373a158a238fba126bb03ac3c98c`。每个 T 的源码、实施内容和剩余工作见[完整清单](2026-11-08-native-classic-simplification-todo.zh.md)。

A–D 的 23 项已落地等价优化，E 的 8 项保留能力已按受影响调用链核对。T12 采用固定 hardlink 入口读取实际 owner 正文并校验文件身份，保留旧分区、全列表 token 和旧 writer 回退路径。中文 Skill 经用户明确确认后已同步英文，同一 0.5.3 Changelog 已追加。修改保留在工作区，未提交、推送或发布；完成通知已提交，CLI 返回 ok:true、queued:true（成功入队）。

原有 archive state、website 子模块及 `.ruff_cache` 保留，没有清理或重置无关内容。

## 逐项结果

| 批次 | ID  | 状态           | 实际实现                                                                                                                                                                                                                                              |
| ---- | --- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | T01 | 已完成         | Classic state get 纳入纯查询；Native next 由新提交的 outcome 判断完成事件，单纯领取和重复回报不触发学习。显式上下文请求保留。                                                                                                                         |
| A    | T02 | 已完成         | v3 CAS 后直接使用已提交 Run 判断 checkpoint 边界，边界发布仍在投影锁内重读 authority。                                                                                                                                                                |
| A    | T03 | 已完成         | Native 高层 next 传入已验证 Run；Classic 各阶段 Guard 复用 findClassicSdkWorkspace 返回的 inspect；外部检查前仍刷新。                                                                                                                                 |
| A    | T04 | 已完成         | 项目外请求先 race-safe 读取并调用原 schema/content validator，再提前返回；不解析 writable paths 或获取登记锁。保留原项目内路径。                                                                                                                      |
| A    | T14 | 已完成         | loader 按内置版本复用规范化不可变 workflow，每个 Runtime 的 handler/validator/executor 注册对象仍独立；公开可修改工厂继续返回新对象。                                                                                                                 |
| A    | T18 | 已完成         | 双语 Skill取消无观察且无已知待评审时的 review/空动作文件；当前 change 的真实待评审及失败处理保留。中文已获确认并同步英文。                                                                                                                            |
| A    | T23 | 已完成         | Classic observe 同次返回 formalReview、实际批准原文 originals 和判断模板；保留旧 prepare-applied。共享编辑协议明确 Native/Classic 均复用已返回材料，中文补充已再次获确认并同步英文。                                                                  |
| A    | T26 | 已完成         | 正常路径一个 Git 进程读取逐提交路径；触及批量输出或时限时按原逐提交参数完整读取，真实 Git 输入错误直接报告。                                                                                                                                          |
| B    | T05 | 已完成         | protected read session 新增字节读取，共用目录身份并在各读取检查点核对，结束前验证祖先；降低重复 realpath，保留叶子与目录替换检查。                                                                                                                    |
| B    | T06 | 已完成         | 已有完整目录链直接线性采集和验证；缺目录继续原创建路径，原子发布和目录持久化步骤保留。                                                                                                                                                                |
| B    | T07 | 已完成         | 当前 fence 快路；具名 Native 只迁移对应 legacy change，全项目仍完整发现。迁移元数据变化时最多新鲜读取三次，不稳定仍失败，不复用旧内容。                                                                                                               |
| B    | T08 | 已完成         | 共享锁无竞争时直接 no-clobber 发布及精确释放；有协调记录时继续旧 bakery 协议、有限等待和 stale 恢复。                                                                                                                                                 |
| B    | T09 | 已完成         | 完整写入私有元数据后 hardlink 发布唯一主锁，保留私有链接直到精确释放；协调目录曾变化时，即使 claim 已消失也沿旧协调顺序释放。hardlink 不支持走旧协议；变化观察在原 5 秒内重新读取，持续变化仍有界失败。                                               |
| B    | T11 | 已完成         | 已结束一般事务移入 transaction-history，逻辑 ref 与原 journal 字节保持不变；实际 payload 通过原 ID 寻址。旧终态在 mutation 扫描时迁入；Doctor/root move 仍审计历史。Portable 活动事务保持原发现。                                                     |
| C    | T16 | 已完成         | readOnly Native runtime 不注册执行器，仍加载并验证原 workflow/handlers/state/validators/固定应用。Hook 使用同一 inspect 决策。                                                                                                                        |
| C    | T20 | 已完成         | 中文 Design/Build/Verify/Archive 抽取重复布局及编辑说明到 scripts.md 的阶段共用入口，保留每个独立入口、方法和配置。中文已获确认并同步英文。                                                                                                           |
| C    | T22 | 已完成         | 中文 Skill 仅在同会话有可核对交付记录、正文仍在上下文中时使用 incremental；新会话、压缩、恢复、记录缺失时 snapshot。阶段专用约束仍加载。中文已获确认并同步英文。                                                                                      |
| C    | T31 | 已完成         | daemon 具名 status/show 复用已绑定本地 Git 身份时不采无关 worktree stamp；listGitWorktrees 在同一 scope 仍走新鲜发现，本地 HEAD/目录/配置变化使绑定失效。                                                                                             |
| D    | T12 | 已完成         | 新增固定 owner 文件入口，使用受保护的原子 hardlink 发布，与实际旧分区 owner 共用正文。具名读取验证当前文件对象绑定后少读一次 token、免分区正文重读；旧 writer 原子换文件或绑定不匹配时沿用原完整校验。注册与明确恢复/分区移动时更新，纯读取不写记录。 |
| D    | T13 | 已完成         | 内置 v3 的纯 shape.prepare/revalidate 在内存沿用原 claim/outcome/validator，再 CAS 发布一个 revision；旧 Run、固定应用和外部执行继续原协议。                                                                                                          |
| D    | T17 | 已完成         | Classic checkpoint 直接比较最终编码格式，省去必然不相等的完整未编码比较；每次公开命令返回的 Portable checkpoint 保持交付。                                                                                                                            |
| D    | T21 | 已完成         | 同次 Design 提案用有结束验证的 source observation 共用 sourceEvidence/requirementsEvidence/handoff 的原文字节；提交验收在 scope 外重新读取。                                                                                                          |
| D    | T28 | 已完成         | 只有已验证并冻结的相同 Run 对象复用解析结果；可变对象、换字节及键不匹配继续拒绝；公共 parser 保留独立副本。                                                                                                                                           |
| E    | T10 | 保留能力已核对 | 保留 root move、pending 恢复和共享资源协调；事务历史在显式搬迁前仍纳入检查。                                                                                                                                                                          |
| E    | T15 | 保留能力已核对 | Supervisor 节点、Child、集成、父级验收与清理未删除；相关定向回归待补齐。                                                                                                                                                                              |
| E    | T19 | 保留能力已核对 | walkthrough 当前默认、显式开关、同页更新和 Archive 引用未改；契约检查通过。                                                                                                                                                                           |
| E    | T24 | 保留能力已核对 | selection 缺失时唯一 change 自动发现与真正歧义拒绝均保留，未添加用户 select 轮次。                                                                                                                                                                    |
| E    | T25 | 保留能力已核对 | 跨 worktree 寻址及归档合入查询未删除；此前 delivery-scope 40 项通过，manifest symlink 用例因 Windows EPERM 未运行目标断言。                                                                                                                           |
| E    | T27 | 保留能力已核对 | delivery repair、旧 checkpoint、unknown 和晚产物恢复未删除，相关 history/handoff 定向验证进行中。                                                                                                                                                     |
| E    | T29 | 保留能力已核对 | Archive 执行与提交边界两次输入观察均保留；继续拒绝两边界之间候选/报告/Spec 漂移。                                                                                                                                                                     |
| E    | T30 | 保留能力已核对 | 固定扩展应用的 workspace scope holder/共享写范围、停止证据及未知执行协调未改；纯读与无 scope 保持快路。                                                                                                                                               |

状态只覆盖写明的实现及证据边界；Windows、模型、安装包和高竞争限制见后文。

## 性能对照

Windows、Node 22.20.0、daemon 关闭。同一初始 fixture 与 HOME/数据目录，各预热一次，再取五个公开 CLI 进程样本中位数。基线为隔离原 HEAD 构建，候选为当前实现；操作计数另起 instrumented 调用，不混入计时。小幅差异保留噪声解释。

| 公开 CLI                            | 基线 ms | 当前 ms | 变化   | 额外 Node worker |
| ----------------------------------- | ------- | ------- | ------ | ---------------- |
| native status perf                  | 397     | 364     | -8.3%  | 0 → 0            |
| native status（项目）               | 317     | 317     | 0.0%   | 0 → 0            |
| state next perf                     | 586     | 540     | -7.8%  | 0 → 0            |
| state get perf phase status         | 972     | 296     | -69.5% | 1 → 0            |
| classic state next perf             | 592     | 542     | -8.4%  | 0 → 0            |
| classic state get perf phase status | 974     | 296     | -69.6% | 1 → 0            |

该表的初始 fixture 沿旧 owner 路径读取，验证旧 Run 的兼容路径。named Native status 的 async realpath 442→329、open 26→21；Classic get 的 async open 30→21、readdir 5→2、sync realpath 144→1。它们是多项优化的联合效果。项目级 status 没有确认明显收益。

### 推进、进程重启与批准

通过 bin/comet.js 创建隔离 fixture，写完整 brief/spec，执行 Shape prepare；另起进程 next，确认仍在同一批准等待，再按返回命令模拟 fixture 用户批准，确认进入 Build。该决定只属于测试 fixture，不代替真实 change 的用户批准。每个 variant 六次，首对预热，其余五对交错采样。

| 公开流程动作          | 基线 ms | 当前 ms | 变化   |
| --------------------- | ------- | ------- | ------ |
| 新建 fixture 具名查询 | 395     | 357     | -9.6%  |
| 准备 Shape 批准       | 3195    | 2350    | -26.4% |
| 新进程恢复待批准 next | 1763    | 1282    | -27.3% |
| 模拟批准并进入 Build  | 3497    | 2650    | -24.2% |

全部样本保留批准等待，重启不增加 revision。纯 Shape 提交后 revision 从 3 降为 2。新实现一次恢复样本约 2.87 秒，原值保留，未证明尾延迟改善。这里测量正常等待后的进程重启；复杂事务/崩溃恢复没有完整公开 CLI 耗时配对，另由行为测试核对。

### 锁、长历史与重复材料

| 边界微测                       | 基线             | 当前             | 说明                                                  |
| ------------------------------ | ---------------- | ---------------- | ----------------------------------------------------- |
| 共享锁无竞争 acquire/release   | 41.616 ms        | 15.421 ms        | open 11→5、link 5→1、readdir 4→0                      |
| Native 无竞争 acquire/release  | 47.860 ms        | 21.716 ms        | open 18→10、rename 5→2，完整元数据原子发布            |
| 具名 owner 读取                | 13.238 ms        | 10.822 ms        | open 4→3、token 2→1、分区正文 1→0；固定入口读实际正文 |
| 长历史单轮编码                 | 2.377 ms         | 1.406 ms         | 同一 40-action、展开 6,664,603 bytes fixture，200 轮  |
| 长历史 200 轮 CPU              | 483 ms           | 314 ms           | 全部 200 个摘要逐一相同                               |
| 长历史 post-GC heap            | 30,274,928 bytes | 36,837,912 bytes | 增加约 6.26 MiB，存在 CPU/内存取舍                    |
| 100 提交路径读取 Git 进程      | 100              | 1                | 正常路径；聚合资源边界退回原逐提交检查                |
| 中文每阶段 layout/编辑重复段落 | 593 bytes        | 333 bytes        | 只计算该段 UTF-8，不代表整套 Skill 总字数             |

锁与 owner 微测预热一次、九样本；长历史是 Engine 编码边界微测，不是公开 CLI 长 Run 全流程计时。未把 in-process 导出函数计时称为已实现的 daemon 收益，也未证明真实模型阅读轮次下降。

[测量 JSON](2026-11-08-native-classic-simplification-measurements.json)保留原始样本、I/O 计数、每轮摘要、源码/资产摘要和并发失败记录。完整脚本、隔离构建与 fixture 位于 C:/Users/BENYM/AppData/Local/Temp/comet-simplification-execution-20261108，不作为发布资产。

## 写锁边界与并发

普通 Engine CAS 在 `runtime-store.ts` 的 `withWriter` 内使用一个 Run 主锁，revision 核对与原子发布同处临界区，序列化提前完成。Native v3 非边界免 checkpoint 判断重读。需要 Portable 交付的真实边界与 Classic 投影仍有单独投影锁，保护另一个派生资源。

模型、外部测试和用户等待继续通过持久化 Action/claim 表达归属，磁盘锁不扩大到执行等待期。共享 Spec、多文件事务、root move 和扩展应用 scope 按实际资源协调；应用 scope 顺序仍为 workspace、application。旧协议与 Supervisor 沿用原恢复路径。

| 进程竞争                         | 共享锁           | Native mutation 锁 |
| -------------------------------- | ---------------- | ------------------ |
| 两个新旧 writer，释放后保活 1 秒 | 2/2 成功         | 2/2 成功           |
| 八个旧 writer，释放后保活        | 2/8 成功，6 超时 | 8/8 成功           |
| 八个新 writer，释放后保活        | 2/8 成功，6 超时 | 8/8 成功           |
| 八个新旧混合 writer，释放后保活  | 1/8 成功，7 超时 | 8/8 成功           |

每个临界区额外用 `wx` 文件检查交叠，未观察到重叠。共享锁高竞争 choosing/ticket 超时在纯旧版也存在，本任务未解决，不能记为通过；该压测使用显式 10 秒预算，不等同于默认 30 秒等待的结果。混跑共享锁有一次精确释放降级警告：协调器失败后沿用既有 fallback，只移除自己的主锁。

立即退出的双进程对照保留了全部失败记录。最终 5 轮中，纯旧版 6/10 成功，新版 10/10，混跑 9/10（失败方为旧 writer 的 busy，失败路径推测涉及退出身份诊断，根因未完全证明）。这是小样本行为核对，不作为成功率统计；旧版退出/进程身份诊断仍有限制。新版保留未知 owner 的拒绝，仅在主锁已消失或观测正在变化时于原 5 秒内重试。Native 发布完整元数据后才暴露主锁，竞争 claim 即使已经退出也沿原协调顺序释放。最后补充变化观察在原有 5 秒内重读后，纯新与新旧混合的八进程末轮均 8/8 通过。此前 fence/锁观察变化的失败已补有界新鲜读取回归，不复用旧内容。最初 Native fixture 错把数据目录放进项目，该轮无效，已修正后重测，原记录只用于调试。

## 实际验证

以下运行存在重复覆盖，不相加为唯一测试总数；未选择的测试不算通过。

| 检查                                         | 实际结果                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 23 项新增 badcase                            | 最后完整一轮 18 组、72 项通过；补充后 T23 组 2 项、T26 组 4 项通过。当前精确选择器校验的复合报告为 18 组、76 项；不是全仓测试，也不将重复运行累加 |
| Classic full/hotfix/tweak 生命周期           | source/generated 两种入口共 6 项通过；固定入口最终实现后完整复测通过                                                                              |
| Native application                           | 早期 7 项通过，最后固定入口后 3 项通过：原结果恢复、Archive 候选漂移及同 session Build/Verify/Archive                                             |
| Classic application 与读取                   | application 选择组 4 项；CLI 参数、只读状态与预算三文件 94 通过、2 跳过                                                                           |
| Native 高层、预算、定义                      | 早期 105 通过、5 跳过；后续相关预算 57 通过、6 跳过                                                                                               |
| Native 历史、CLI、只读                       | 五文件组 120 通过、1 跳过；另 1 项因 fixture 未创建 ticket 目录失败，显式构造目录后该项单独通过，断言未改                                         |
| 锁、并发与迁移                               | 共享/Native 初轮 57 通过、4 跳过；Native/迁移后续 95 通过、2 跳过；最终 Native 两文件 35 通过、2 跳过，进程结果另列                               |
| Native paths                                 | 22 项通过，具名迁移及稳态免全枚举断言保留                                                                                                         |
| 事务与 root move                             | 初轮事务/Archive/root move 43 通过、1 跳过；后续事务/root move 39 通过、1 跳过；最终 root move 18 项通过                                          |
| 原子写与受保护读取                           | 早期 17 通过、4 跳过；固定入口/硬链接两文件 45 通过、1 个 file symlink 创建时 EPERM；命名恢复等 T12 精确组 12 项通过                              |
| Classic delivery scope/Design                | 43 项通过；1 个 manifest file symlink 创建时 EPERM，目标断言未执行                                                                                |
| handoff、编辑、Design                        | 早期 10 通过、1 跳过；后续两文件 11 通过、1 跳过；增强 observe 原文和 Verify 续行通过                                                             |
| 学习与 SQLite 投递                           | 两文件 43 项通过                                                                                                                                  |
| Engine 历史与 immutable                      | 10 项组通过，mutable/changed/损坏值及不可变编码选择器通过                                                                                         |
| scope、跨应用、Hook、Supervisor portability  | 4 文件 80 项通过                                                                                                                                  |
| Hook Router、取消历史、Classic recovery-read | 3 文件 42 项通过                                                                                                                                  |
| 编辑续行、handoff、Classic state history     | 4 文件 27 项通过                                                                                                                                  |
| Git、facade、worktree、Skill 组合            | 早期 7 文件 149 项通过；Git 正常 1/2/100 提交通过，最后资源/输入错误与 100 提交组 4 项通过                                                        |
| 双语 Skill、layout、压缩、walkthrough        | 最终 6 个测试文件 87 项通过，T23 同步后再次通过                                                                                                   |
| 公开命名 owner 恢复                          | 隔离 fixture 的 native doctor --migrate-history 恢复损坏固定入口，Run revision 和 Build 阶段不变                                                  |
| TypeScript 与 Runtime                        | tsc、Native/Classic/Entry 构建、check:generated 通过                                                                                              |
| badcase 结构和历史保留                       | 以 2999b60d 为 base 通过；新增 23 个 case，旧条目和原断言保留                                                                                     |
| ESLint                                       | 0 错误、9 个既有 warning；最后 Git/锁模块定向 lint 通过                                                                                           |
| 架构                                         | 原工作区被既有 .ruff_cache 阻断；同步任务源码的隔离副本 lint:architecture 通过                                                                    |
| 格式和 diff                                  | 受影响源码、JSON、双语 Markdown 的 Prettier 与 git diff --check 通过                                                                              |

旧失败/新通过包括 Classic get 学习调用、Native Shape revision、项目外 validator、非边界 authority read 和固定 owner token 预算；部分 Native 用例复制到原 HEAD 隔离源码也按预期失败。历史事务审计与批处理资源边界是本轮实现遗漏，均先失败再修正通过，不作为已发布缺陷写入 Changelog。曾绕过旧读取注入入口的局部改法已撤回，代次/坏记录原断言恢复通过。一次登记检查因与重建并发而 Runtime stale 提前终止，构建完成后重跑通过。

## 剩余限制与完成条件

1. T12 保留旧分区与发现 token，具名读取使用固定入口，但仍核对实际文件对象。无稳定 inode、hardlink 不支持或旧 writer 原子替换文件时，按原协议读取；旧 Run 不因纯查询被迁移。固定入口与原 owner 共用正文，不能只靠持久化时间戳缓存掩盖原地损坏。中断发布可沿原 owner 回退，损坏的独立入口可通过已验证的命名恢复重建；公开 `native doctor <name> --migrate-history` 的隔离样本已验证恢复后 Run revision 与 Build 阶段不变。
2. 中文 Skill 已获用户明确确认，七个相关文件已同步英文。阶段规则、实施方法、TDD、审查、固定应用、明确记忆请求及 snapshot 恢复保留。确定性契约不能证明真实模型遵循。
3. 高竞争共享锁超时与 Native 立即退出窗口保留原始失败证据，尚缺完整根因/无回归证明；未观察到重叠不等于所有恢复体验通过。
4. Windows file symlink 用例因 EPERM 没有执行目标断言。后续负责人为接手的维护者（尚未指定个人），在支持 file symlink 的 Windows 或 Linux/CI 上原样运行 owner-history 与 Classic delivery-scope 对应选择器；通过前不作为全平台验收。真实平台 Hook、完整安装/升级、其他平台及全量测试未执行；本次选择定向范围。用户没有明确启动授权，因此未运行任何模型或容器 Eval。
5. 当前 package 0.5.3，origin/master 与上个发布 tag 为 0.5.2；版本不再增加。Changelog 追加到 0.5.3 Changed，只记录最终用户可见行为，不记录分支内修正或普通测试。
6. Git 批量正常路径一进程；总输出或总时限达到边界时，完整沿原逐提交参数读取，输入错误直接报告。资源回退用故障注入先红后绿，并核对真实 Node 22.20.0 错误码；未制作真实 8 MiB Git 输出或额外 30 秒超时压测，不能外推该路径的延迟收益。
7. 没有 GitHub 评论、PR、提交、推送或发布。完成通知首发因默认 Markdown 正文格式校验失败，指定纯文本后重试，CLI 返回 ok:true、queued:true。只记录成功入队，不声称已获收件方投递回执。
