# Entry owner 批读测试迁移

本批只改 `test/domains/comet-entry/project-sdk-status.test.ts`，没有改产品、构建生成物或 registry。原 13 个声明、25 个展开项全部冻结在 tests.json；迁移后 14 个声明、仍 25 个展开项。8 个声明正文完全不动；5 个混合声明拆开已退休机制与现存业务，逐声明去向见 mapping.json。原 token 表格一行移到独立测试，其他七种真实坏数据行保留。

## 实际结果

- 原精确六项：six-before.json，0 passed / 6 failed，失败分别为旧 token 错误传播、两次 token 读取、并发 owner generation 二次读取要求。
- 最终整文件：file-after.json，success=true，24 passed / 0 failed / 1 skipped。唯一 skipped 是原 symlink-checkpoint 平台能力限制，未新增 skip。
- 源文件 Prettier 检查通过。没有 build、真实平台 Hook、安装验证、模型或容器 Eval；本批不声称整个 Entry module 已通过。
- first-prototype.json 与 second-prototype.json 保留中途 fixture 失败：新增真实第二任务前先塞入未绑定 Run 的 owner，被当前正常创建边界拒绝。最后按真实 cancel→new 顺序完成后，才注入用于“不扩大读取范围”的 SIMULATED 孤立 owner，不绕过生命周期批准或身份判定；serial-frontier-after.json 单项通过，最后整文件再次通过。

## 保留与退休

退休：普通工作流的分区 token、generation 重试、读取过程中并发 writer 协调。没有恢复这类实现，也不再宣称支持多 writer 读取窗口一致性。

保留：Native default/true 历史可见，false 只排除严格关闭历史；真实坏 owner 逐 change 错误而健康任务仍可见；请求之后顺序提交的 owner 变化在下一请求可见；真实取消→新建后原历史状态保留；Native/Classic canonical body 按实际发现名字每项一次，不能读孤立或另一 workflow 身份；读取前后项目与 Runtime 文件字节不变。Classic 两个 includeHistory 选择各有独立展开断言。没有通过仅修改读取计数来绕过这些断言。

当前真实 API：change-runtime-owner.ts:287 的 readOwnerPartitions 建立本次请求批次；:411 readSdkChangeOwners 与 :456 inspectSdkChangeOwnerPartitions 返回按名字分开的 PromiseSettledResult，不再读取 token 或重试 generation。project-status.ts:131 以当前正式目录和请求的当前 workspace 历史名字确定 Native 集合，:149 预取 visible owner；:288 Classic 仅正式目录发现的名字，:293 预取。native-sdk-history-discovery.ts:53 依据真实 owner/Store 封存元数据筛历史。两处遗留注释中的“稳定代次”不是当前 token/retry 实现证据；本批遵守源码冻结未改注释。

## 登记审查

registry.json 记录本次实际 sourceCatalog hash。扫描当前 cases 和 historicalTestMigrations，沿 supersededBy 到末端 tests，并核对原始 provenance：此文件有效关联 0、历史关联 0，因此没有 CAS payload，不新增或改 ID。四 artifact 的独立内容摘要见 artifact-index.json。patch.patch 仅相对本批开始时完整文件冻结生成，避免混入此前已修改内容。
