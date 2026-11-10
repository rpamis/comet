# 已归档 Native 历史恢复

来源：`report:2026-11-10-comet-any-sdk-archived-recovery`。用户要求修好本机反复提示恢复、实现早已完成的 change。对象为 `comet-any-sdk`，原状态位于 `docs/comet/archive/2026-10-06-comet-any-sdk/`。比较基线为 `9acb00ff61220f1bbeea5bf46dd190438f3f9a77`；相关缺陷也存在于发布 tag `0.5.2`。

## 原因与修正

原本机 Run revision 213，状态为 completed，领域状态 archived=true/state_version=17，97 个 Action 的最终验收、交付、归档及 Supervisor 清理均已有成功记录。工作区绑定仍是 045，当前分支为 053。

1. Portable 投影与本机 Run 的规范化检查点不一致，公开 doctor 要求修复投影；随后又为已完成历史尝试执行定义升级，被旧分支绑定拒绝。现在已识别的旧定义在 completed 且 archived 时保持原样，不再为历史结果安排执行定义升级。
2. 归档 checkpoint 的冷恢复也强制回原分支。现在仅 completed 且 archived 的历史允许在后续分支恢复；活跃 Run 的绑定及所有普通 CAS 限制保留。
3. 本地 Run 丢失、历史 owner 仍存在时，恢复无条件注册 active owner，导致拒绝。现在只复用同一 application/runId 的已归档 owner；其他身份仍走原来的冲突检查。
4. 旧投影缺少归档完成收据时，从原 Run 已成功的 archive.finalize 输出补回，保留已有字段，不覆盖无效收据；冷恢复完成后通过原完成入口关闭历史存储。
5. Portable YAML 经 Windows 转为 CRLF 后，归档收据读取只识别 LF 首行，导致无本地收据时恢复失败。两个入口统一复用已有的精确首行标记判断，保留后续 YAML 和归属校验。

不重新实现、不重开需求、不重复验收或归档，不改变原定义身份、批准及检查结果。原交付提交不在当前 053 的祖先链上，本次没有合并旧 045 分支或重放 Git 交付。

## 本机修复

通过新构建的公开 `comet native doctor comet-any-sdk --repair --project-root D:/Project/Comet --json` 修复投影后，另发现 21 个已结束的旧受管检查缺少新版持久停止登记。原记录最晚完成于 `2026-10-06T13:43:12.856Z`；本机 `Win32_OperatingSystem.LastBootUpTime` 为 `2026-11-07T12:34:00.9530540Z`。本机系统重启是这些原本机进程及全部后代已停止的依据，不使用文件年龄或历史 PID 猜测。

逐条保留原 Action ID、attempt、inputHash 和 claimToken，使用 Runtime 返回的 `doctor --repair --confirmed --stopped-actions` 正式入口补记停止事实。没有放宽产品对未知执行的要求，没有重新运行命令。

修复后核对：

- Run revision 213 → 214，仍为 completed、archived=true，存储已 closed。
- 97 个 Action 的原内容与结果、领域状态、定义身份和用户批准均与备份一致；仅新增 21 条 executionStop。
- Portable 从旧展开 YAML 规范化为当前检查点编码，大小 17,223,441 → 1,968,019 字节；原恢复信息保留。
- 新构建的公开 doctor 返回 `healthy: true, repaired: true, findings: []`。

原 Portable、原 Run、停止证据输入和完整 doctor 结果已备份到本机临时任务目录。全局 CLI 原为较早的同版本构建，误把新锁协议标记识别为损坏；已将旧安装完整备份为本机 `original-global-comet-full.tgz`，再安装本轮构建的本地 0.5.3 包，没有发布 npm。

使用默认 PATH 中的 `comet` 复查 doctor，返回 `healthy: true, findings: []`；再次运行 `doctor --repair` 返回 `healthy: true, repaired: false`，不再循环修复。可比较的修复摘要见[local-change-repair.json](2026-11-10-final-workflow-performance/local-change-repair.json)。

## 回归证据

`native-agent-checks.test.ts` 的源码和生成 bundle 完整流程使用真实 Git：正常完成后切换分支、丢失本地 Run，将 Portable 转为 CRLF，同时删除本地 Run 和独立归档收据，以 confirmed doctor 恢复；断言状态、Action ID 和 checkpoint 原字节不变，并能再次健康诊断。源码额外用只读旧定义终态观察验证不执行 CAS。`keeps active Native recovery bound to its original branch` 证明未完成 Build 仍不能跨分支恢复。

修正前生成 bundle 在同场景报告旧分支不匹配；修正后又暴露历史 owner 重注册问题，保留失败记录后修正。CRLF 场景在旧源码和旧 bundle 都失败，修正后源码、bundle 与活跃分支反例共 3 项通过。Native 定义选择、状态恢复及任务流程 3 文件另有 51 项通过。

实际 comet-any-sdk 也复制到不同分支的全新临时 Git 项目，使用独立数据目录、不复制任何本地 Run 历史，通过公开 CLI 冷恢复。97 个 Action ID、原领域状态和结果、21 条停止事实均保留，存储为 closed，doctor 健康。见 [actual-cold-recovery.json](2026-11-10-final-workflow-performance/actual-cold-recovery.json)。

这些确定性证据不表示重新验收了 10 月的全部实现，也不表示通过真实模型 Eval。本轮未启动模型或容器评估。
