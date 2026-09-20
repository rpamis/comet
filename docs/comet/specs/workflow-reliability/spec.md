# Comet 工作流可靠性与性能契约

## 检查要求与执行证据

### Scenario: Classic 显式失败检查不能被自动发现的其他命令覆盖

- **GIVEN** 某阶段已经记录一个明确的 Runtime 检查要求，且其最新执行失败、失效或被中断
- **WHEN** Guard 评估是否可以离开该阶段
- **THEN** Guard 保留原检查身份和失败原因，不执行或采用另一条自动发现命令来替换它
- **AND** 返回的恢复动作针对原检查，且在当前 shell/平台可执行
- **AND** 只有从未声明检查要求时，自动发现才可以作为待用户或 Agent 执行的候选动作

### Scenario: Classic 证据跨提交复用绑定检查时内容

- **GIVEN** 一个 Classic 检查已经成功并保存输入 manifest
- **WHEN** 工作区内容发生变化后提交，使 Git 相对新 HEAD 再次 clean，或者切换到内容不同的分支
- **THEN** Runtime 比较当前内容与证据建立时的内容身份，不因当前 Git clean 而复用旧成功
- **AND** 只有提交元数据变化、实际检查输入内容不变时仍可以复用

### Scenario: Native dirty 文件内容变化使检查证据失效

- **GIVEN** Native 候选的 tracked 文件已修改并通过 Runtime 检查
- **WHEN** 该文件再次修改，但 Git porcelain 仍显示相同的修改状态
- **THEN** dispatch、handoff 和 retry 都检测到内容身份变化并重新执行相关检查
- **AND** tracked、untracked、submodule 和声明的生成输入使用与其语义匹配的内容身份

### Scenario: 同一检查证据可以满足多个阶段要求

- **GIVEN** 相同 argv、cwd、输入内容、相关环境和检查语义的一次成功 Runtime 执行
- **WHEN** Build 与 Verify 都声明该检查满足自己的本地可重放要求
- **THEN** 两个阶段引用同一有效执行证据，不因阶段名称不同重复运行
- **AND** 独立 Verifier 的语义判断和不同检查要求仍分别执行

### Scenario: 检查输出不构成自己的可变输入

- **GIVEN** 检查会生成时间戳、构建产物或其他声明输出
- **WHEN** Runtime 在执行前后计算输入身份
- **THEN** 声明输出不会仅因本次检查重写而使同一次成功执行无效
- **AND** 受版本管理的生成资产仍通过独立一致性检查验证
- **AND** 未声明的重复自修改会返回具体变化路径和配置动作，而不是无限建议重跑

## Native continuation 与循环停止

### Scenario: 恢复后保留已经固定的检查计划

- **GIVEN** handoff 已解析并持久化检查计划
- **WHEN** 进程重启、上下文压缩，或 Agent 通过 status、show、next、错误恢复重新取得 continuation
- **THEN** Runtime 从持久状态与本机执行记录投影同一个计划或稳定 plan ID
- **AND** 将返回模板原样提交时不会因空计划或不同计划而被 Runtime 自己拒绝

### Scenario: 可重复检查耗尽次数后进入可恢复停止状态

- **GIVEN** 一项 repeatable 检查持续超时或执行中断并达到配置的尝试上限
- **WHEN** Runtime 处理最后一次中断结果
- **THEN** Runtime 不再返回必然失败的 retry-checks 动作
- **AND** 已通过检查证据保持不变，状态记录耗尽原因，并提供调整 timeout、修复环境或返回 Build 的合法出口

### Scenario: 验收失败预算在阈值处产生有效状态

- **GIVEN** Builder handoff 检查连续失败并达到 `max_verify_failures`
- **WHEN** Runtime 写入停止 blocker
- **THEN** blocker、acceptance ID 和 loop 字段满足 portable schema，状态原子进入 await-user
- **AND** candidate、失败摘要和已有证据保持可恢复，不留下 Verify active 的半提交状态

### Scenario: 用户批准的新目标使用新的失败预算

- **GIVEN** 当前目标已消耗部分失败预算
- **WHEN** 用户通过 revise-requirements 修改用户可见目标并重新确认完整 Shape
- **THEN** 新 goal cycle 使用新的失败预算
- **AND** 原目标仅因实现或正式产物漂移返回 Shape 时保留原预算，不能借漂移无限重置

## Shape、归档和交付恢复

### Scenario: 非语义格式变化不重置 Shape

- **GIVEN** 完整 Shape 已确认并进入 Build 或 Verify
- **WHEN** brief 或 Spec 只改变换行风格、文件末尾空行或行尾空白，规范化后的语义文字不变
- **THEN** Runtime 保留当前 goal cycle、acceptance、Builder handoff 和验证进度
- **AND** 范围、约束、验收、决定或其他语义文字变化仍返回 Shape 并要求重新确认

### Scenario: Classic 归档后待交付任务可以自然恢复

- **GIVEN** Classic 产物已归档，但授权范围内的 commit、push、PR 或交付核验尚未完成
- **WHEN** 进程重启或 Agent 查询当前任务
- **THEN** Runtime 能发现并选择该 pending delivery，不要求把 archived change 重新当成 active change
- **AND** 只有交付达到授权范围内的终态后才清除恢复索引

## Hook 隔离和可选上下文

### Scenario: 无关损坏 change 不阻塞当前合法写入

- **GIVEN** 当前 selection 和写入目标可以唯一归属到一个健康 change，项目中另有损坏或不兼容的 change
- **WHEN** Hook Router 判断当前写入
- **THEN** Router 只深读目标 owner，依据该 owner 的 Guard 结果允许或拒绝
- **AND** 无关损坏由 Doctor 或状态列表报告，不扩大成当前写入失败
- **AND** 目标 owner 自身损坏时仍 fail closed

### Scenario: 可选插件工作不进入写入许可关键路径

- **GIVEN** Guard 已经允许写入，但 Personal Memory、Project Knowledge、学习、索引或 outbox 不可用、锁争用或超时
- **WHEN** Hook Router 返回写入决定
- **THEN** Router 在有界总预算内只读取已准备的上下文，并保留原许可决定
- **AND** 刷新、学习和 outbox 重放在任务边界或独立执行路径完成，其失败可诊断但不阻塞写入

### Scenario: 自包含 Runtime 使用构建时版本

- **GIVEN** Entry Runtime 被复制或安装到不含源码目录结构的位置
- **WHEN** 插件 bridge 需要当前 Comet 版本
- **THEN** Runtime 使用构建时注入或显式传入的版本，不从 bundle 相对路径猜测 package.json
- **AND** 真实安装布局测试覆盖版本可用和插件上下文初始化
- **AND** 插件上下文失败提供有界诊断，不被完全静默吞掉

## 锁身份与诊断

### Scenario: 锁 owner 绑定具体进程实例

- **GIVEN** 锁文件中的 PID 已被操作系统复用给另一个存活进程
- **WHEN** Native 或插件锁诊断 owner
- **THEN** Runtime 使用 hostname、PID 和进程创建身份区分原 owner 与新进程
- **AND** 只自动回收确认属于已结束进程实例的锁；身份未知时保留受控 repair，不按锁年龄强制抢占
- **AND** 锁忙、遗留锁和状态版本冲突返回不同错误类别及可执行恢复动作

## 文档、生成资产与生命周期验证

### Scenario: Skill 与 Runtime 使用同一检查和恢复语义

- **GIVEN** Agent 按中文或英文 Classic/Native Skill 推进
- **WHEN** 首次执行检查、跨阶段复用、恢复失败检查或归档交付
- **THEN** Skill 指令与 Runtime 行为一致，不要求先裸跑成功再重复录制，也不返回 JSON argv 伪装的 shell 命令

### Scenario: 发布资产和连续操作回归保持同步

- **GIVEN** Classic、Native、Entry、插件或平台锁源码发生变化
- **WHEN** 构建和验证候选实现
- **THEN** 所有对应自包含 Runtime 由构建脚本更新且 generated check 通过
- **AND** 自动测试严格消费 Runtime 返回的 continuation，覆盖修改后提交、dirty 再修改、进程重启、超时耗尽、阈值边界、格式变化、无关损坏 change 和归档后交付中断
- **AND** 普通单元测试、生成资产、宿主 Hook、真实模型 Eval 和生产性能证据分别报告，不互相替代
