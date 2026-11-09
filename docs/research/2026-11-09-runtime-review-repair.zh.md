# Runtime 审查修复与 CI 测试精简

来源：report:2026-11-09-runtime-core-commit-review、report:2026-11-09-test-pruning。原 8 个提交的比较范围为 5426c4cbb3569e749ce8050888517f93b8437f5d..2e7055cc；本次修复基线为 2e7055cc667ea9a9f17c101d500ab92caf022fe4，交付目标为 053。

原提交确实影响了恢复和交付行为。本次修复保留了 Agent 平台检查、显式修订与轻量续行，没有恢复 PID 探测、文件内容证明、自动编辑失效或普通检查重复执行。当前定向核心流程可完成，但不能据此宣称仓库所有测试或线上 CI 全绿。

## 修复范围

- 原审查 9 项：旧迁移锁和 recovery 元锁的精确确认恢复；截断轨迹的状态指引与中间坏 JSON 拒绝；Classic 已归档 repair-delivery 和停止后的 continue-work 原 checkpoint 绑定；已跟踪迁移标记的合法归档移动；旧 deliveryInputs 排除其他 workflow 草稿；Runtime 根尚未建立时可选记录读取。
- Classic v2 repair-delivery 接受实际平台检查报告，拒绝缺失或失败报告，保留原 Run、Archive 和交付路径，要求新的交付批准。它不执行旧受管命令；v1 仍按原协议恢复。
- Compat 待批准 Shape 使用已有 revise-requirements 显式修订和重新批准，不因普通编辑自动失效；目标替换与确认后缺失目标的反例保留。
- 默认 Native v4 补齐活跃需求枚举与取消完成的版本识别：第二个需求得到工作区隔离指引，已完成取消的原 Run 能释放工作区。
- Native 新建 canonical Spec 在归档预检后出现同名既有文件时拒绝覆盖，保留正常归档与同一事务的幂等结果。检查只读取当前目标，不增加项目内容 hash。
- Classic 显式恢复已完成归档时，从原执行收据重建缺失的可读路径清单，不重复 OpenSpec。
- Dashboard 与本地项目知识搜索在一次请求内共用父目录观察，返回前统一复核目录；文件描述符与 realpath 检查保留，下一请求重新读取文件。目录替换时不发布结果；知识搜索返回不可用诊断，不阻断任务。

## 测试与 CI 精简

[精简记录](2026-11-09-runtime-core-review/test-pruning-record.json)保存删除理由和原断言；[后续记录](2026-11-09-runtime-core-review/followup-pruning/)保存夹具调整、删除正文和验证结果。删除依据是功能已经退休或执行体重复，不能以测试失败作为删除理由。

- 移除强制章节、模板文案、语言推断、文件/日志摘要、自动字节失效和旧命令推断等退休策略。保留实际失败、路径安全、原 Run/Action/claim、用户批准、稳定任务 ID、Git 交付和恢复幂等。
- 删除只有退休日志摘要协议的测试文件，以及在 CI 重复执行七个完整流程的开发 benchmark 测试。benchmark 命令继续可运行。
- 同一参数化测试体的六个 source 分支由 generated Runtime 分支承接。保留不同失败、批准、别名、原 Run 和一次性执行分支；11 个替代与迁移标记边界已实际通过。
- 历史案例使用现有 supersededBy 链，保留 ID、来源、旧登记、完整源文件和逐行为映射。只退休标记内容摘要，合法移动与缺归档副本拒绝继续执行。修正少 describe 前缀、参数标题和旧名称的登记，不把采集成功当成测试通过。
- Linux 核心回归改为核验同一次 quality 完整测试报告，不再次执行同一批测试。按登记文件和选择器筛选后检查最少通过数、精确必过名称、缺失、失败、跳过和运行错误；报告不完整仍失败。macOS、Windows、最低 Node 版本、安装包和浏览器边界继续保留。

减少的是一整个 Linux 核心回归执行批次，不能将本机测量推断为线上 runner 节省的分钟数。Windows 文件符号链接权限失败仍保留，未通过删除安全断言或放宽预算解决。

## 实际验证

- 本次 16 组修复登记全部通过，共 32 次精确执行：[汇总](2026-11-09-runtime-core-review/repair-verification-summary.json)。组内包括合法完成与对应拒绝反例。
- 生成 Runtime 的六个替代分支、四个迁移标记路径案例和退休命令拒绝共 11 项通过：[替代覆盖](2026-11-09-runtime-core-review/pruning-replacements-summary.json)。
- CI、回归报告、badcase 与开发规则契约最终定向 72 项通过。共享 RuntimeStore worker 的真实写入、退出与中断恢复夹具 5 项通过。
- Dashboard 采集与新读取边界测试 47 项通过，1 项因本机文件符号链接权限跳过。知识查询成本与路径安全 7 项通过；没有放宽原 I/O 预算。
- Classic preset 的显式范围批准、陈旧提案拒绝、任务 ID 和旧定义升级 8 项通过。Native 的 Delta 目标保护、Supervisor 两种计划、原 unknown Archive 恢复、children 和 Hook 对应 8 个精确案例通过；Delta 独立目标编辑仍拒绝且保留原文。
- Classic 其余修订/恢复、Native 原失败与用户批准、CLI 实时进度等定向检查分别记录在后续证据中；不同报告有重叠，不相加冒充仓库测试总数。
- Classic benchmark 七个场景通过，四项 rate 均为 1，本机约 68 秒。实际 npm 0.5.0 包创建并验收的 Classic Run 由当前生成 Runtime 继续归档和真实 Git 交付，Archive 执行一次，停放的 Native 草稿保持未提交：[升级证据](2026-11-09-runtime-core-review/upgrade-050-evidence.json)。
- 完整 build、生成物检查、lint、SDK API 报告检查、badcase 基线保留检查通过；lint 有 9 条既有 warning。最终登记与格式检查在收尾时再次核对。

135 文件广泛诊断曾得到 2697 通过、481 失败、27 跳过。这轮运行期间候选仍在修改，因此它不是最终候选的全绿证据；[失败明细](2026-11-09-runtime-core-review/broad-diagnostic-failures.json)保留当时结果。部分已通过本次修复、退休或夹具修正消除，其余未完成复验的有效失败不能写成通过。本次没有再次启动全仓测试，也没有远端 CI 结果。

没有启动真实模型或容器 Eval，用户没有给予 Eval 启动授权；真实平台 Hook、完整安装发布与模型行为的证据也不能由上述确定性测试替代。

## 版本与交付

package 当前版本 0.5.3，master 和上个发布 tag 为 0.5.2，不增加版本。补齐 SDK API 报告；nativeExtensionArtifactHashes 是已发布的导出，因此在 0.5.3 Changelog 的 Removed 明示移除影响。普通内部修复和测试整理不写成发布流水账。

工作区、053 和 website 在合并前重新核对。只提交本任务文件，本地合并回 053 后清理本任务分支及工作区；不推送、不创建 PR、不修改 website 或其他历史工作区。最终提交与清理结果以完成回复中的实际命令结果为准。
