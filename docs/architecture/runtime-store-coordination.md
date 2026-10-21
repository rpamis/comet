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

## 同一工作区的跨应用协调

同一 canonical projectRoot 下的应用使用固定锁顺序：工作区锁 → 应用 scope 锁 → Run 锁。不同应用的同名 Run 是不同占用身份，不因 runId 相等而跳过。领取前读取各应用现有 holder 索引，并按占用记录自己的固定 manifest、内容摘要和 Action 输入解析写入范围；不加载其他应用的执行模块。实际目录通过 realpath 归一化，已有目录的链接别名以及父子范围仍会冲突。

工作区锁目录中的 workspace-applications.json 保存已登记应用身份、Store 目录的稳定文件身份（dev、ino、birthtimeNs）、仍需保留的领取身份及内容校验。领取身份绑定固定应用内容摘要、Run、Action、attempt、inputHash 和规范化后的 claim token；不保存第二套业务推进状态。原应用 Store 整体缺失或被同名新目录替换时拒绝继续领取，避免因目录不再可发现而遗忘仍在执行的工作。新应用目录先创建，再登记身份；中途退出后可从仍存在的目录继续登记。不能通过删除成员清单、移动 Store 或改写索引解除占用。恢复原目录引起分区身份变化时，使用原应用的 inspect/audit 入口核对实际成员后再领取。

写入前先将原占用与拟提交占用的并集持久化，再提交 Run CAS，最后从实际 holder 记录收敛。CAS 明确失败时仍以可读的原权威收敛；权威目录丢失或不可验证时保留外置占用，不能推断拟提交执行没有开始。正常停止只在 Run 提交停止事实后释放。

丢失本地 Store 后，显式 portable checkpoint 恢复可重新建立记录。存在原写入占用时，checkpoint 必须保留对应固定定义和领取身份，running 应转为 unknown；领取之前的旧 checkpoint 不得冒充执行已停止。多 Run 或多个应用可分批恢复，但尚未补齐的占用及目录身份围栏继续阻止普通领取。只有全部已知占用在恢复后的权威记录中得到验证，才绑定当前目录。恢复 CAS 失败且没有对应记录时不绑定空目录；恢复后仍需对原执行核对真实结果或确认停止，不能自动重派。只读应用没有写入占用时沿用原来的 portable 恢复路径。

热路径读取应用成员目录、各应用索引和实际 holder 正文，成本为 O(应用数 + 活跃占用)，不读取无占用应用的历史 checkpoint 或完整 Run 成员清单。旧应用首次建立 holder 索引仍需完整审计；新 Run 登记仍保留原来的成员清单成本。拥有可信空 holder 索引的应用不会因已封存正文损坏而阻塞其他应用；索引、固定占用定义或分区身份无法验证时不能推断资源空闲，新的资源领取继续拒绝，Dashboard 则可独立显示其他健康应用。已有占用的真实结果提交、取消和停止确认不因另一应用的成员目录损坏而被阻断，避免完整性检查反过来妨碍安全释放。

范围以一个 canonical projectRoot 为界，不是整机或分布式锁。不同项目若主动使用同一个外部目录或外部资源，宿主仍须隔离目录或协调执行。升级前停止旧版本执行进程；旧版本应用入口不参与新的工作区锁，不能与新版本混跑并宣称跨应用互斥。Run 的真实结果或原执行停止证据才会释放占用，选择另一个当前应用不会释放。
