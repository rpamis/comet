# RuntimeStore 与应用写入协调

SDK Run 是执行权威。应用占用索引只保存仍持有共享写入范围的 Run 身份，不保存另一份推进状态，也不执行或重派 Skill。

## 存储事务恢复

close/reopen 先持久化固定 revision 和记录摘要，再用独占硬链接发布目标，验证两个路径指向同一 inode 后移除源。写入口先完成已保存的 closing/reopening 事务，再检查调用者 revision。settleRun 只完成布局事务，不增加 revision，不重放命令。read、readProjection 和分区诊断不执行恢复。

独立且内容相同的两个 checkpoint 不能当作同一 authority。摘要、版本、inode 或分区不一致时保留现场并报错，不自动覆盖。

## 应用占用索引

每个应用 Store 的 .runtime-store-coordination 保存：

- index.json：协议版本、epoch、实际占用身份、未完成写入意图、分区目录身份和成员清单摘要。索引有独立内容校验。
- inventory.json：全部登记的 Run 身份、epoch 及独立校验值。普通领取不解析它；首次登记、初始化和显式审计才读取。
- registration.json / repair.json：跨两个原子文件提交所需的恢复意图。

领取、释放、导入和封存持有应用 scope 锁，再获取 Run 锁。改变占用前持久化 pending intent；权威 Run 提交后再从其实际内容更新索引。进程在任何一步退出，下一个协调写入读取权威 Run 解决 intent，不重派工作。

running、unknown，以及有原 claim 但无有效停止证明的 cancelled Action 均保留占用。取消调度不等于执行已经停止。实际停止确认或结果提交通过 SDK 身份校验后才释放。

不改变占用的 CAS 只使用 Run 锁；下一版本的隔离和序列化在应用锁外准备，锁内重新核对 revision、固定应用身份、授权依赖和共享范围。默认领取只读取实际 holder，不读取所有 pending Run 正文；注册新 Run 的完整成员清单更新仍是 O(N)，不宣称所有写入都是常数成本。

## 写入边界与旧版本

启用索引后，协调目录以及 Run 格式标记中的 writerProtocol 阻止未经应用入口的普通 Store 写入。旧实现不认识带协议字段的格式标记，会拒绝现有 Run。升级前应先停止旧版本进程，避免迁移窗口中的旧进程发布。应用协调协议是受控写入者契约，不是对任意本地文件修改者的安全隔离。

普通领取检查目录身份变化，但不会读取所有历史 checkpoint。若其他程序直接修改已有历史正文而不改变成员目录，必须执行完整 audit；不能同时承诺 O(holder) 热路径与检测任意外部正文修改。禁止把复制、删除 Run 目录或手改索引当作恢复方式。

## 检查与修复

公开入口：

- inspectWorkflowApplicationStorageIndex(projectRoot, applicationId)：只读状态和 epoch；投影损坏但独立成员清单有效时，返回 corrupt 状态和修复所需 epoch。
- repairWorkflowApplicationStorageIndex({ projectRoot, applicationId, operation: 'audit' | 'rebuild', expectedEpoch })：持有应用锁，校验 epoch，完整读取已登记成员，再校验当前发现结果。

audit 允许目录时间戳发生变化，并在完整验证后更新它们；不能在开始审计前因为旧时间戳而拒绝审计本身。rebuild 可由独立校验的成员清单恢复损坏投影，切换 epoch，并保留原成员清单用于崩溃恢复。已登记成员缺失、正文损坏、初始化时已发布清单不匹配，均不能通过重建“忘掉”原成员；先恢复原记录再重试。

STORE_BUSY 表示锁竞争；SCOPE_HELD 表示真实占用，包含阻塞 Run 身份；STORE_INDEX_CORRUPT 表示索引或成员完整性无法确认；STORE_INDEX_EPOCH_CHANGED 要求重新 inspect。closing/reopening 是可恢复布局事务，不能据此断言业务执行完成。
