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
- 完成时间: 2026-10-05T17:55:42.159Z
- 摘要: 独立核验候选3951e08c3f3500ba5720d0ef88437bd2b84390e9，全部scope A11/A12；候选分支、base884e4b5395293428dbe1f50a20d9d8bb26446a3e、contractHash、worktree与原Action64匹配，工作区干净，未改候选或website。先读正式R11/R12及完整验收、实现/领域/loader和实际材料，最后读Builder交接。复用Action63四项正式Runtime检查：build、6文件159项Classic组合/既有SDK/loader及生成资产回归、architecture、Classic生成物均passed/exitCode0；四份日志SHA、冻结候选与输入均匹配。另核对父保存的21份材料SHA，历史失败/30s超时保留但仅以最终匹配重跑通过为证据。正式回归覆盖full/hotfix/tweak实际领域检查、OpenSpec Archive和临时本地交付、两种preset批准升级full、失败/需求修订、候选/Design来源漂移、公开CLI跨进程与portable恢复。只读从真实tgz消费者公开./applications/classic运行三个profile工厂探针：原validator/已声明schema及原审批保留，非法领域check替换、跨检查点顺序和输出schema不匹配明确拒绝；未声明composition.confirm的只读定制不额外加批准。安装包5个关键JS/bin SHA与当前build一致。未重跑已匹配完整计划；没有执行真实Claude/Codex宿主或模型、Claude正式12样本、完整项目级/用户级安装、CI或全仓测试，这些仍属后续delivery-validation，不能据此宣称整体生产验收已完成。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A11 | passed | brief.md | 定制 Classic 在各受影响 profile 中可完成真实流程；无效替换或顺序变化被解释并拒绝，不用文本成功声明替代领域验收。 | R11覆盖full/hotfix/tweak：classic-application.ts复用原defineClassicWorkflowApplication，只替换invoke_skill绑定且保留原validator及outputSchema；新增工作仅位于原领域证据检查点，同点可重排，跨点/领域步骤被拒。composition.confirm仅为显式定制工作授权，原full Open/Design/Build/Archive审批保留，普通内置profile维持原定义。Action63的159项匹配正式回归包括三profile实际执行检查、必需工件、真实临时OpenSpec Archive和本地交付完成；文本pass不能替代当前sourceHash/实际工件摘要/注册验证器。两种preset经原upgrade Wait升级full仍继承额外Build/Verify检查并完成真实临时全流程。独立真实包工厂探针对三profile均确认非法check替换、跨检查点顺序及不匹配输出schema明确拒绝；公开包factory可解析，loader允许该公开子路径。通过结论限于本Child已完成的本地真实流程与包解析，不含后续A22/A24生产证据。 |
| A12 | passed | brief.md | Classic 新增或替换的工作发生失败、工件变化和中断时可恢复；基础命令不能绕过组合应用新增的必需检查。 | R12由同一Application/SDK Run推进：扩展失败或repair增加checkEpoch并返回原工作，revise-requirements清除设计/计划/验收并重做composition和原域确认；公开repair-composition/revise-requirements在原Run恢复。当前和下游claim/outcome重验来源事件、原领域证据及实际声明工件，Design来源变化拒旧工作；loader固定应用/Skill/资源摘要，依赖漂移拒绝继续，恢复原字节后可沿原记录回传。Action63正式回归复现并通过中断unknown保留原Action/attempt/inputHash/session及token关联、公开CLI跨进程恢复、portable来源receipt恢复、候选变化后的同Run修复、Design来源变化后的重新确认、基础内置inspect/state路径拒绝自定义归属和必须原固定包恢复。原领域check/Archive preflight沿Application runtime调用，组合检查拦截下游领取和结果，基础命令不能绕过。未把先前超时/依赖环境错误或未做的真实宿主模型/双作用域安装当作通过证据。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| Build the current application candidate | build.js | . | passed | 0 | 23524 ms |
| Check Classic composition and existing SDK domain contracts | D:\Project\Comet\node_modules\vitest\vitest.mjs run test/domains/comet-classic/classic-application.test.ts test/domains/comet-classic/classic-sdk-application.test.ts test/domains/comet-classic/classic-sdk-state-file.test.ts test/domains/workflow-application/application.test.ts test/repository/classic-runtime-assets.test.ts test/repository/comet-entry-runtime-assets.test.ts | . | passed | 0 | 339806 ms |
| Check repository architecture | scripts/lint/architecture.mjs | . | passed | 0 | 2829 ms |
| Check generated Classic runtime | scripts/build/build-classic-runtime.mjs --check | . | passed | 0 | 682 ms |

### Builder 报告的证据

以下为 Builder 报告，不等同于 Runtime 检查凭据或独立验收结果。

- Build the current application candidate: passed — —
- Check Classic composition and existing SDK domain contracts: passed — —
- Check repository architecture: passed — —
- Check generated Classic runtime: passed — —

## 阻塞项

_无。_

## 风险与跳过的工作

_未报告风险。_

## 之前的迭代

_没有之前的迭代。_



## 结论

独立核验候选3951e08c3f3500ba5720d0ef88437bd2b84390e9，全部scope A11/A12；候选分支、base884e4b5395293428dbe1f50a20d9d8bb26446a3e、contractHash、worktree与原Action64匹配，工作区干净，未改候选或website。先读正式R11/R12及完整验收、实现/领域/loader和实际材料，最后读Builder交接。复用Action63四项正式Runtime检查：build、6文件159项Classic组合/既有SDK/loader及生成资产回归、architecture、Classic生成物均passed/exitCode0；四份日志SHA、冻结候选与输入均匹配。另核对父保存的21份材料SHA，历史失败/30s超时保留但仅以最终匹配重跑通过为证据。正式回归覆盖full/hotfix/tweak实际领域检查、OpenSpec Archive和临时本地交付、两种preset批准升级full、失败/需求修订、候选/Design来源漂移、公开CLI跨进程与portable恢复。只读从真实tgz消费者公开./applications/classic运行三个profile工厂探针：原validator/已声明schema及原审批保留，非法领域check替换、跨检查点顺序和输出schema不匹配明确拒绝；未声明composition.confirm的只读定制不额外加批准。安装包5个关键JS/bin SHA与当前build一致。未重跑已匹配完整计划；没有执行真实Claude/Codex宿主或模型、Claude正式12样本、完整项目级/用户级安装、CI或全仓测试，这些仍属后续delivery-validation，不能据此宣称整体生产验收已完成。
