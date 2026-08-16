# Supervisor Runtime 与恢复

## 功能需求

### Scenario: 父级 Change 根目录只保留用户可读产物

- **Given** Supervisor v2 正在推进
- **When** 用户查看父级 Change 目录
- **Then** 根目录只保留 `brief.md`、`specs/`、精简 `children.yaml` 和简洁的最终 `verification.md`
- **And** 不出现 Agent run、临时输入、集成日志或协调状态机器文件

### Scenario: Supervisor 机器状态集中到 Runtime 目录

- **Given** Runtime 记录动态协调事实
- **When** 保存 integration workspace、Agent、集成、验证、恢复或临时传输数据
- **Then** 数据统一位于 `.comet/runtime/native/changes/<parent>/supervisor/`
- **And** 这些本机文件不要求提交到 Git

### Scenario: Runtime 丢失后重建计划和工作区事实

- **Given** Supervisor Runtime 目录被删除或协调进程重启
- **When** 用户恢复父级
- **Then** Runtime 从 `children.yaml`、父子用户文档、Portable State、Git branch/worktree 和 Archive 重建计划、依赖、工作区和可证明的集成状态
- **And** 不依赖旧进程内存或 Agent 自述

### Scenario: 只有准确 commit 的可移植记录可恢复 verified

- **Given** Runtime 重建时发现 Child 候选 commit
- **When** 可移植验证记录明确绑定该准确 commit 且仍满足可信规则
- **Then** Child 可以恢复为 `verified`
- **And** Git 祖先关系本身不能替代验证记录

### Scenario: 缺少可信验证记录时要求重新验证

- **Given** Runtime 能恢复 Child 和 commit，但验证记录缺失、损坏、漂移或无法证明准确 commit
- **When** 重建 Child 状态
- **Then** Child 进入 `needs-reverify` 或 blocked
- **And** 不猜测 Builder 或 Verifier 已经完成

### Scenario: Agent 会话不是可移植状态

- **Given** Portable State 已移动到另一设备或宿主 Agent 会话不可用
- **When** 恢复 Supervisor
- **Then** Agent 运行标识不作为完成或验证证据
- **And** 只有确认旧执行结束后才可按 Child 当前状态重新派发

### Scenario: Child merge 前后中断可恢复

- **Given** 进程在 Child merge 前、Git 写入后或 integrated 记录写入前中断
- **When** Runtime 依据恢复日志和 Git 引用继续
- **Then** 已完成的 merge 不会重复执行，未完成检查不会被跳过
- **And** Child 只在全部事实一致后恢复为 integrated

### Scenario: Runtime 写入前后中断可恢复

- **Given** 进程在 Supervisor Runtime 状态写入边界中断
- **When** 再次读取状态
- **Then** Runtime 通过版本、原子写入或事实重建得到单一可继续状态
- **And** 不同时接受互相冲突的新旧 `runId` 或 integration 记录

### Scenario: Agent 返回前后中断可恢复

- **Given** Agent 已完成但协调进程在接收返回前后中断
- **When** 父级恢复
- **Then** Runtime 重新核对任务 `runId`、Portable State、验证记录、commit 和 Git 关系
- **And** 重复返回不会触发重复验证或集成

### Scenario: 最终 merge 前后中断可恢复

- **Given** 进程在父级最终 merge、Archive 或清理任一步骤前后中断
- **When** 用户再次推进最终交付
- **Then** Runtime 从未完成步骤继续并核对真实 target
- **And** 不重复 merge、不跳过 Archive 前提、不误删 worktree

### Scenario: 所有 Git/worktree 新操作经过平台 Adapter

- **Given** Supervisor v2 在 Windows、macOS 或 Linux 上运行
- **When** 创建、检查、合并或清理 branch/worktree
- **Then** Native domain 通过 `platform/` Adapter 使用同一 Runtime 语义
- **And** 不在 domain 中散落平台特判或缩减 canonical registry

### Scenario: 真实 linked-worktree 覆盖完整父级流程

- **Given** 发布候选准备验证 integration-first 语义
- **When** 执行真实 Git linked-worktree 集成测试
- **Then** 覆盖父级 workspace、依赖基线、Child Verify、串行集成、target 保护、父级 Verify、一次最终交付和中断恢复
- **And** 仅有内存 fixture 通过不能替代该验证

### Scenario: 并行 fixture 覆盖 Builder 与 Verifier

- **Given** 两个无依赖 Child 同时 ready
- **When** 执行宿主 Agent 协调 fixture
- **Then** 覆盖两个独立 Builder、两个独立 Verifier、串行集成、顺序降级、重连、取消和迟到 `runId` 拒绝

### Scenario: 32 个 Child 下状态仍有界且可定位

- **Given** 父级声明 32 个 Child 并产生大量历史
- **When** 请求默认 status 和按名称查询
- **Then** 默认响应保持固定大小预算
- **And** 按名称查询无需完整扫描所有 worktree Change
- **And** details/history 通过 cursor 分页提供剩余数据

### Scenario: 发布资产和双语 Skill 保持一致

- **Given** Native Runtime、status schema 或 Skill 协调语义发生变化
- **When** Supervisor v2 准备发布
- **Then** 重建 Native bundles，更新资产清单和 Runtime 资产契约测试
- **And** 中文 Native Skill 语义确认后同步英文版本
- **And** CLI、Dashboard 和生成物消费同一 Runtime 合同

### Scenario: 最终验证不掩盖失败或未运行检查

- **Given** Supervisor v2 准备作为 beta20 用户能力交付
- **When** 运行相关 Native、Skill、Runtime、架构、build、发布包和风险匹配的全量验证
- **Then** 记录真实通过、失败、超时和未运行结果
- **And** 环境阻塞或超时继续显示为未完成，不宣称交付已通过

## 非目标

- 把宿主 Agent 会话、进程或临时 Runtime 文件变成 Portable State。
- 为恢复建立通用事件平台或通用任务调度器。
