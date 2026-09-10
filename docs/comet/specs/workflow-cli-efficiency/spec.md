# 工作流 CLI 效率与测量

## 身份与观察共享

一次 task 对同一项目只解析一次完整项目身份并传递给 Bridge、名称、readiness、存储、提取和 HostReview。固定空上下文 fixture 中，有 origin 的身份查询最多一次 Git，无 origin 最多两次。仓库 ID、名称、存储位置和跨 worktree 共享记录/隔离索引语义不变；下一次调用重新观察 remote 与路径，不使用跨命令未失效缓存。

Native named status 必须先在受保护的候选发现阶段限定同名 active/archive 记录，再深读目标。无关 change 的 Runtime、brief、Spec 和报告不得被深读或影响目标判断。列表先做必要的轻量发现，再只投影当前页。仍完整保留创建身份、归档继承与 Git 祖先证明，无证据时显式冲突，不能选第一个同名目录。

1/10/30 个真实 worktree 各一项唯一活跃 change、无 archive 的固定场景，命名 status 的 Git 次数不随无关候选增长，最多五次。一次调用共享适用的 worktree 列表与观察，不能在每个候选重复完整 Git 查询。

Native Shape prepare 只需 branch 的位置不重新检查完整 worktree，固定有效场景 Git 次数最多七次。入口、锁内及写入前的关键绑定继续验证，外部并发变更不能被旧快照掩盖。其他阶段单独测量，不把该预算误用为所有路径上限。

## 高频入口

公开 workflow resolve --activate 对已配置且无上下文请求的项目走 package-owned 快路径并保持零 Git；完整门面与快路径的输出、退出码、配置及目录写入副作用等价。缺配置、部分/非法配置、重复激活、额外 context 参数、help 和未知参数有明确且兼容的处理。不得只放宽 router 而缺少实际激活语义。

Classic 同一操作中未改变的 schema/status/config 可以复用，成功操作返回下一阶段足够的观察，避免连续 next/entry/逐字段 get。跨文件、配置、用户确认与 Git 变更的有效期重新验证。检查执行和插件语义继续保留。

## 合法场景基准

冷启动及流程基准必须创建隔离 HOME/cwd 的合法成功 fixture，覆盖真实 activation/task、Classic current/next、Native show/status/next 和规模场景。计时包含 Node 及其子进程，外层 shell/shim/Agent 工具时间另列；新进程与文件缓存预热方式明确记录。

每个样本验证 spawn 状态、退出码和实际后置状态/continuation。错误、超时或走错动作必须使 check 失败，record 不能覆盖有效基线。重复 next 的合法快照复原在计时之外，不伪装成完整模型工作流。

报告保存源码及实际构建身份、Node/OS、origin、worktree 数、样本、median、输出字节与 Git 次数。小样本 p95 只能标为观察值。相同机器与 fixture 下热点中位耗时必须下降并满足确定性进程预算；不能通过删除检查、插件或使用失败路径获得成绩。

## Eval 事件时间与纠正分析

在现有 Eval 采集/日志范围保留原始 invocation/tool ID、可用开始/结束/持续时间、退出码、结构化错误分类和计时来源。事件按 ID 配对，正确处理并发交错、重复结果和中断；未知字段保持 null/unknown，不补零。只在明确关联时记录 retry_of，不把相邻失败与成功自动视为同一操作意图。

分别呈现参数/schema、路径/工作区、过期状态、合法业务阻塞、实际检查失败及安装/宿主失败。工具往返时间不得被标为 Runtime 自身时间，多个并行执行的墙钟时间不得简单相加计算用户等待占比。既有 events 消费者继续兼容；凭据与敏感命令值不进入持久化报告。

本能力不新增工作流侧逐工具日志、调度器或常驻服务。没有完整真实模型前后对照时，不宣称模型纠正比例、token 或总任务时间得到特定收益。
