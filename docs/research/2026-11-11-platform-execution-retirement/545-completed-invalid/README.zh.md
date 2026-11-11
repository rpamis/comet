# #545：真实 0.5.2 已完成但收据失配的 Build 前沿

使用发布包 `@rpamis/comet@0.5.2` 的原 Native v3 工厂、SDK Runtime、claim 和 markUnknown 创建样本。图未改写；User 批准和 Agent 文本请求明确标为模拟。实际调用发布包检查执行器一次，只执行安全 Node 计数与 stdout 命令，不启动模型、容器或 Eval。

实际计数为 `once\n`；执行记录为 completed，terminationUnconfirmed=false，结果 succeeded，逐项 passed。原验证器接受实际结果。随后仅将持久 sidecar 的 `outcome.output.checks[0].name` 从 `Current Build check` 改为 `Previous plan`，沿发布包 markUnknown 标记原 Action。旧验证器真实拒绝：`Native check receipt does not match the bound plan`。没有伪造已执行或停止事实。

原根使用当前 owned loader 与公开 CLI `next → doctor → next` 实测成功。原 Run、input、Shape 批准、claim 和历史保留；原检查取消但不伪造 outcome、停止回执或通过；仅派一个 Builder，不派 Verifier，不生成候选。重复读取持久 Run 完全相等。原绝对路径计数仍为 once，坏 sidecar 和实际日志保持原字节。

回归以 SDK restoreCheckpoint 原样物化冻结 Run，不改 input、claim、hash、proposal 或原绝对命令参数。真实旧 cache 的四个文件按原 `native/sdk-checks/...` 相对位置放入当前 runtime；旁路计数按原 `../actual-node-count` 相对布局放入。公开 CLI 三次调用后检查全部缓存和计数字节不变。原 pending/claimed 断言保留，新增 completed-invalid，三个 variant 均实际通过；见 JSON 报告。

物化回归的计数字节保留本身不能证明原命令未运行，因为原 argv 仍指向原绝对路径。未重播的实际计数证据来自原根实验；未以重绑定原 claim 的方式制造证明。原根全部冻结数据、原脚本和原始 CLI 输出保存在本目录。`behavior-map.json` 逐项说明边界。

两原 case ID `native-invalid-completed-check-recovery`、`native-invalid-completed-check-guidance` 及其现有冻结迁移节点保持不变。如登记新增有效选择器，追加独立迁移节点和独立证据，不改写既有 main-worker-registry blob。此处证明真实旧业务 Run 无感升级；旧停止握手功能已撤下，未将其改称修复。

未执行旧公开 Doctor 的 stopped-actions 修复握手、Eval、模型/容器和全量测试。没有修改产品源码、仓库测试或 registry；本目录是供主 Agent 审核合并的 Temp 交付。
