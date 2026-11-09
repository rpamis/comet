# Native Agent 检查流程实施记录

来源：`report:2026-11-09-native-agent-runtime-simplification`。用户授权实施方案并提交推送。工作分支为 codex/native-agent-runtime-simplification，基线为6b4c26f34b5969912edc04591e513ef4ad2b7d57。主工作区的并发修改未带入本分支。

## 当前实现

新建内置 workflow v4 直接接收Agent平台实际检查报告；旧v1–v3和固定应用保留原执行契约。普通流程和Supervisor均不注册受管检查节点。用户确认、真实会话、全部验收项、Git集成与归档事务仍保留。平台报告的失败或未运行不能支持通过结论。

结果文件消费一次；v4业务状态只在提交事务内计算一次，异常结果保留原Action并拒绝推进。Runtime目录在同一Store准备一次，每次访问仍核对实际工作区身份。观测记录在命令边界集中落盘，命令失败仍保存观察结果并抛出原错误。

## 旧内容证明退役

Native汇总入口撤下旧snapshot创建与内容基线API；旧格式内部迁移、读取和兼容夹具所需的snapshot实现集中留在旧模块，不再作为默认Native创建入口。删除已无生产消费者的native-check-scope及SDK遗留证明字段。完整Portable Run镜像继续保留，不改变已有跨机恢复承诺。

退休native-docker-syntax-scope的旧环境/输入证明断言，原登记、完整旧测试、补丁和替代契约映射保存在本记录的retired配套文件。使用既有登记维护协议要求的审计摘要，未新增产品内容hash。原功能已撤下，不把退休测试写成原Docker策略已修复。ci-python-loader-environment-isolation已有的迁移保留原样。

## 兼容夹具与历史断言

基线已经撤下文件与日志内容指纹，但三条旧夹具仍要求自动内容失效。本次保留原文件完整正文于 retired-tests.json，明确迁移：旧 v3 跨候选复用改为 Agent 的 reusable 选择；会话/候选保护用真实错误会话和错误候选 ID 验证；日志保留原执行记录与读取位置，不再要求编辑日志触发内容失效。没有把已撤下的策略宣称为修复。新增命令规范不恢复内容 hash。

验证时还复现了历史登记超过 Node 默认输出缓冲导致 ENOBUFS 的阻塞。仅提高 Git 基线读取缓冲，保留不可读基线报错；临时 Git 的 2 MiB 回归取得旧失败、新通过证据。

## 性能对照

Windows、相同 Node 启动方式、临时 Git checkout、独立用户 Runtime 目录，交替运行基线与当前 bundle 各三轮。预加载计数器统计文件调用，计时包含其开销；操作均返回退出码 0。

| 操作            | 基线中位数 | 当前中位数 | lstat 调用  | realpath 调用 | Git 调用 |
| --------------- | ---------- | ---------- | ----------- | ------------- | -------- |
| new             | 1242 ms    | 1247 ms    | 1551 → 1523 | 1190 → 1173   | 5 → 5    |
| next 领取 Shape | 825 ms     | 824 ms     | 1084 → 1014 | 817 → 766     | 3 → 3    |

本样本只证明部分路径观察减少，启动固定成本没有明显改善。确定性流程测试另证 Builder 直接到 Verifier、没有普通 Runtime 检查 Action；不把该证据换算成模型耗时收益。首次错误地将 Runtime 数据目录放在项目内的样本均退出 65，已排除，没有计作成功测量。

## 验证

已运行 Native、Classic、Entry Runtime 构建；TypeScript 编译检查、生成新鲜度及历史登记保留校验通过。其余定向测试与独立 Review 的最终结果在交付前补齐。

没有启动 Eval、全量测试、发布或真实平台 Hook 验收。普通平台工具检查的协议已作确定性源码 CLI 与生成 bundle 验证，但模型遵循仍需单独的模型证据。完整 Portable Run 恢复保留原 Action、会话与 unknown 状态，不能把未知实现视为完成。
