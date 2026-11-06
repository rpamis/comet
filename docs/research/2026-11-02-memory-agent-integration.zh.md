# 记忆与项目知识的 Agent 接入优化

日期：2026-11-02。分支：`052`。比较基线：`784694e310911586e55984fc3444cf3f8ded9bae`；工作区保留本聊天此前的 Native 简化修改。

## 已实现行为

- Native 与 Classic 内置 SDK 的紧凑领取响应附带 `context`、`contextDelivery` 和 `contextActions`。领取已经提交后才检索，失败不会回滚领取；原 Action input、批准材料和 SDK 完整返回不加入记忆。
- 使用实际接收会话、阶段和工作区，复用现有 ContextDirector 的预算、去重、来源校验和应用回执。Native 检索目标来自当前验收范围，子任务使用自己的工作区与子任务范围；Classic 缺少原始请求时以 change 名称作为初始检索范围，Agent 可用实际目标显式补充检索。
- 自动检索使用 incremental，正文预算为 6000 字符，独立进程最多等待 2 秒，超时会终止该检索进程。此时限只覆盖附加检索，不是整个领取命令的耗时承诺。普通状态查询、inspect、完整 SDK 返回与结果提交不检索。
- Agent 直接读 `context[].text`，需要正文时使用参数已绑定的 `contextActions.expand`；压缩丢失上下文后使用 `restore` 获取 snapshot；收尾使用 `complete` 提交既有学习文件。新 Agent 更换为自己的会话标识。旧 `contextRequest` 继续供 Compat、旧客户端和显式恢复使用。
- 隐式工作流检查点只写入现有 journal，不再在推进路径同步整理。学习文件中延后的个人观察直接入同一队列，不立即重复评审。显式记住、忘记、项目经验写入、评审提交和有证据的采用反馈继续即时执行。排队返回不能当作记忆已生效。
- 中英文命令参考同步说明新旧接入分支、失败处理与 `comet memory sync`。个人记忆、项目知识和项目记忆原有存储继续有效，没有生成第二份可编辑权威，也没有修改平台内置记忆文件。

## 没有声称完成的能力

没有新增跨平台 SessionStart、任意聊天或空闲事件适配，没有自动阅读全部聊天并提炼记忆。队列沿用 `comet memory sync` 维护；没有空闲适配的平台需要显式调用。没有修改 Dashboard 指标、此前原型、用户真实记忆或 `website` 子模块。没有把交付次数算成实际采用或成功使用。

## 验证记录

- 新增 Native 领取交付与不可用降级断言先失败，再通过；公开 CLI 使用独立临时 HOME 验证真实个人记忆交付、重复领取去重、snapshot 恢复与新接收方独立回执。相关四项通过。
- Classic Runtime 命令测试验证领取按实际会话交付，后续 inspect 不检索：通过。
- task-context 进程、上下文检索、项目记忆三个测试文件：43 项通过，覆盖来源变化、正文展开、会话恢复、远程不可用和持久化队列。
- 任务学习文件测试：8 项通过，包含真实采用反馈幂等记账；待处理隐式观察队列定向测试通过。
- 隔离对照：用基线的 worker 入口与当前构建 worker 处理相同检查点。基线会调用整理，不满足“返回后仍保留 attempts=0 的 pending 事件”；当前满足，重复调用只保留一个事件。实验原始输出保存于本地忽略目录 `.tmp/memory-queue-before-after.json`，不将该局部对照称为完整旧发布包验证。
- 插件集成完整模块 38 项通过；Supervisor 子任务恢复定向案例通过，包含接收工作区与子任务范围。构建、TypeScript、生成物、受影响文件格式及案例登记检查通过；lint 有 8 项原有 Dashboard 警告。
- 新登记的六项行为断言全部通过。案例执行器按测试文件合并历史登记，因此执行四组时为三组成功、一组失败：Native 组包含此前已在基线复现的 `recovers a rejected Builder after formal Spec drift through the original failure receipt and reconfirms the same change`，缺少 `shape-drift` 恢复输出。原断言保留，未将整个案例命令记为通过。
- Skill 定向契约两项通过、一项失败：`keeps the main Skill on decisions while delegating mechanics to public CLI output` 的 walkthrough 链接清单问题已在基线复现，详见同日 Native 简化记录。未修改该清单或断言。源文件内调用 CLI 的部分测试没有旁置的编译 worker，附加检索会报告不可用；真实交付另外通过构建后的公开 CLI 验证。
- `verify:changed --plan` 用于核对检查范围；没有执行其列出的整目录测试，不将计划输出当作验证通过。SDK API 检查识别出 `observeMemory` 新增的可选延后整理参数；对应公开类型报告已同步，八个 SDK 入口核对全部通过。
- 未运行仓库全量测试、真实平台 Hook、打包安装和真实模型 Eval；本次没有改 Hook 安装逻辑，用户未授权 Eval。确定性接入验证不能证明模型一定阅读或采用了记忆，也没有做 token、质量或性能收益对比。

版本保持用户指定的 `0.5.2`。已核对 `origin/master` 当前为 `0.5.3`，本次遵循用户的版本要求，在现有 `0.5.2` Changelog 追加最终行为，不另起版本。
