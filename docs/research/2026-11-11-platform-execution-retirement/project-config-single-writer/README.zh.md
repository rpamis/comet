# 项目配置事务移除写入者 PID

来源：`report:2026-11-10-agent-platform-execution`。

用户明确普通 workspace 采用一个写入者，不保留 PID 写入者排他；根 Agent 授权删除配置事务中的进程探测及 `ownerId` 授权分支。这里只处理工作区内的 `.comet/config-write-transaction.json`，不涉及安装、下载或 Eval 的实际共享资源。

两个生产修改如下：

- `project-config-transaction.ts`：新 journal 只保存原 schema、事务 ID、预期/输出摘要、candidate 和 quarantine 六个业务字段。旧 `owner_pid` 在原 JSON 读取边界被忽略，返回原始 source 字节供事务清理校验；不重写历史 journal，不查询、终止或认领进程。
- `project-config-writer.ts`：成功和异常收尾继续调用同一恢复函数，移除两处 `ownerId` 参数。实际事务 ID、原配置/后继文件保护和 testHooks 保持原合同。

完整原 Doctor 文件和两个源文件保存在 `original/`，最小差异在 `changes.patch`。Doctor 只替换一条同工作区并发 writer/Doctor PID 排他测试，不宣称继续支持该并发协议；其他测试正文不变。该旧标题在当前及冻结历史 registry 中没有有效登记，未改写任何原案例字段。建议的新业务记录位于本任务 Temp 的 `config-single-writer-new-case.json`，由根 Agent 合并。

定向证据：原代码在真实 prepared/quarantined WAL 上因旧 PID 等于当前进程而拒绝修复，RED 为 1 项失败。新代码使用同一真实 crash worker 产生事务，只将旧 owner 字段明确模拟成当前 PID 或已退休字符串。只读 Doctor 保留 journal 原字节；显式 Doctor 恢复原配置并收尾实际文件，两条 Doctor 案例通过。配置领域的 15 条原断言也通过，覆盖真实进程中断、quarantine 恢复、后继配置/同路径 candidate 保留、原身份漂移、链接路径拒绝等业务。

`evidence.json` 保存精确 selector 和实际报告路径。源码 ESLint 通过。未运行全量、模型 Eval、真实安装或 Hook 验证；构建由根 Agent 统一完成。
