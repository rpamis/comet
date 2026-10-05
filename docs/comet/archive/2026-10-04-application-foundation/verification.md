---
generated_from_state_version: 1
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 1
- 验证器尝试次数: 1
- 完成时间: 2026-10-04T11:36:28.121Z
- 摘要: application-foundation本轮独立本地基础验收：A2/A3/A4/A5/A14/A15六项通过，候选5facee8f、指定worktree/branch及Action39绑定一致；复用当前39八项Runtime检查与匹配SHA256日志，contracts为21文件/253通过/4个Windows条件跳过。补充A15临时公共SDK隔离fixture四项通过。未声明真实宿主/模型、其他Child或整需求完成。 完整独立报告：C:\Users\BENYM\AppData\Local\Temp\comet-any-045-host-trial\foundation-verifier40-independent-report.json

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A14 | passed | brief.md | 真实内容不支持所要求能力、依赖缺失或输入输出不匹配时不能生成虚假可运行承诺；第三方原文件不被改写。 | 当前候选 domains/workflow-application/skill-adapter.ts:17/59/85 只读真实 Skill、脚本与资源闭包，核对内容摘要、实际片段及严格输入输出 Schema；application.ts:225/247 按已审查 capability 与工作输出契约拒绝无能力或不匹配绑定。当前 Action39 contracts 覆盖 requires-review、false-evidence、missing-resource、unsupported-capability、schema-mismatch 与输入失败，断言原 SKILL.md 字节未改。未采用历史29/30或Builder自报替代结果。 |
| A15 | passed | brief.md | 含有自行发布或接管审批逻辑的 Skill 不能作为普通指导绕过父流程；加载、自报完成、机器检查和独立评审能被区分。 | skill-adapter.ts:122 拒绝带副作用、交互或审批的 guidance；application.ts:228/233/245 要求指导只读、完整流程为 child_workflow，接管审批的 Skill 不能普通 Action 绑定。application.ts:252 与 Runtime Schema/真实业务验证器区分加载、字符串自报和检查，Action39 application.test.ts:449 的伪造结果不推进。补充临时公共 SDK fixture 四项均通过：machine-check/independent-review 无验证器拒绝启动；真实独立评审验证器拒绝同Builder会话结果、保存原 claim/rejectedOutcome，并接受不同评审身份。这是本地契约证据，不表示真实宿主模型已验收。 |
| A2 | passed | brief.md | 从入口、CLI 和恢复入口访问同一 Run；修改说明文件或投影视图不能绕过已声明的执行规则。 | application.ts:85/344/405 从固定归属恢复并用 SDK Store/Run 统一推进，投影仅在原子提交后同步；app/commands/runtime.ts:433 通过同一应用加载入口执行公开协议。当前 Action39 runtime-application.test.ts:348/371 跨公开CLI进程执行与恢复同一Run、编辑 projection.json 不改变原Run、伪造Action999的completed字符串拒绝；:175/261 的手工claim也必须通过配置端口、精确父级批准和核对能力，拒绝后原Action保持pending且隔离服务操作计数为0。 |
| A3 | passed | brief.md | 定制应用经公开入口启动、查询和继续均路由正确；同名不同项目或 worktree 不会串用 Run。 | application.ts:55/85/101 固定应用独立身份、项目realpath和包位置，在每个项目的 .comet/runtime/applications/<id> 存储；current-selection.ts 的applicationId与Run选择、hook-router.ts:378及hook-router-entry.ts:69恢复相同应用。当前 Action39 runtime-application.test.ts:422 对相同应用/Run名称在主项目与linked worktree分别执行，主项目仍pending而linked为succeeded；:465/:502 验证切换内置与定制Guard只路由当前应用及生成Hook在无内置配置时恢复定制Run。四个Windows条件跳过仅为POSIX symlink/FIFO边界，未计为通过。 |
| A4 | passed | brief.md | 修改同版本定义、依赖 Skill 或资源后，活动 Run 拒绝按新内容继续；恢复原依赖后可以沿原记录恢复。 | application.ts:107/123/136/152 固定manifest/module、包中全部文件、Skill完整内容/资源、Runtime版本与项目归属；已有Run在import前核对身份，每次Store读取/CAS重新核对依赖。当前 Action39 runtime-application.test.ts:400 的application.mjs/application.json/SKILL.md/reference资源同版本漂移均拒绝，恢复原字节后返回原Run；application.test.ts:512 的长驻宿主在资源漂移后不能dispatch，恢复资源后继续原pending Action；Runtime定义hash同版本漂移测试同样通过。 |
| A5 | passed | brief.md | 未满足依赖的越序回报、旧 attempt、错误 Action 归属和陈旧提案不能推进；合法并行 Action 可按任意完成顺序回报；断连后保留原 Action，已发生的外部操作不被自动重发。 | runtime-action.ts 的Action/attempt/inputHash/claim绑定、runtime-service.ts:699/765 的CAS领取和结果检查及 skill-executor.ts:76 的精确Wait序列/提案批准共同保护推进。当前 Action39 application.test.ts:69/92 逆序合法并行只在两项完成后join，未派发Action、旧attempt、错误claim和陈旧提案拒绝；runtime-service.test.ts:248 验证并发完成仍只产生一次join，runtime-protocol-adversarial.test.ts:68 拒绝跨Run归属。application.test.ts:567与runtime-application.test.ts:288保留断连unknown的原Action/claim，读取原执行结果后回报及幂等重放，隔离服务实际操作计数仍为1，无自动重发。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| Build declarations and generated Runtime assets | build.js | . | passed | 0 | 28322 ms |
| Application CLI, Skill contracts, SDK execution, selection and Hook regressions | node_modules/vitest/vitest.mjs run test/app/runtime-command.test.ts test/app/runtime-application.test.ts test/domains/workflow-application/application.test.ts test/domains/engine/runtime-execution.test.ts test/domains/comet-entry/hook-router.test.ts test/domains/comet-entry/hook-router-entry.test.ts test/domains/comet-entry/hook-project-root.test.ts test/domains/comet-entry/current-selection.test.ts test/domains/comet-entry/current-selection-repair.test.ts test/scripts/sdk-api.test.ts test/repository/repository-layout.test.ts test/domains/engine/runtime-transition.test.ts test/domains/engine/runtime-service.test.ts test/domains/engine/runtime-action.test.ts test/domains/engine/runtime-protocol-adversarial.test.ts test/domains/engine/runtime-children.test.ts test/domains/engine/runtime-until-blocked.test.ts test/domains/engine/runtime-handlers.test.ts test/domains/engine/runtime-run-validation.test.ts test/domains/engine/runtime-compat.test.ts test/domains/engine/runtime-example.test.ts | . | passed | 0 | 76474 ms |
| Source lint | node_modules/eslint/bin/eslint.js app/ domains/ platform/ | . | passed | 0 | 28359 ms |
| Repository ownership and dependency constraints | scripts/lint/architecture.mjs | . | passed | 0 | 2784 ms |
| Classic generated asset determinism | scripts/build/build-classic-runtime.mjs --check | . | passed | 0 | 684 ms |
| Native generated asset determinism | scripts/build/build-native-runtime.mjs --check | . | passed | 0 | 1087 ms |
| Entry and Hook Router generated asset determinism | scripts/build/build-entry-runtime.mjs --check | . | passed | 0 | 292 ms |
| Public applications and Runtime API reports | scripts/release/check-sdk-api.mjs | . | passed | 0 | 10760 ms |

### Builder 报告的证据

以下为 Builder 报告，不等同于 Runtime 检查凭据或独立验收结果。

- Build declarations and generated Runtime assets: passed — —
- Application CLI, Skill contracts, SDK execution, selection and Hook regressions: passed — —
- Source lint: passed — —
- Repository ownership and dependency constraints: passed — —
- Classic generated asset determinism: passed — —
- Native generated asset determinism: passed — —
- Entry and Hook Router generated asset determinism: passed — —
- Public applications and Runtime API reports: passed — —

## 阻塞项

_无。_

## 风险与跳过的工作

_未报告风险。_

## 之前的迭代

_没有之前的迭代。_



## 结论

application-foundation本轮独立本地基础验收：A2/A3/A4/A5/A14/A15六项通过，候选5facee8f、指定worktree/branch及Action39绑定一致；复用当前39八项Runtime检查与匹配SHA256日志，contracts为21文件/253通过/4个Windows条件跳过。补充A15临时公共SDK隔离fixture四项通过。未声明真实宿主/模型、其他Child或整需求完成。 完整独立报告：C:\Users\BENYM\AppData\Local\Temp\comet-any-045-host-trial\foundation-verifier40-independent-report.json
