# 共享取消四文件最终迁移 Review

结论：批准这四个声明的业务拆分与纯停止握手退休，无阻塞意见。检查范围仅当前四文件与已冻结的原文；不声称完成全仓Review。未修改仓库、未运行新测试或Eval。

## 原文比对

完整旧正文仍在 original-shared-cancellation-test-bodies.json。当前与旧版AST逐声明比较：run-view 4→4、workspace-scope 6→6、cross-application-scope 20→20、application-hook 8→8；四个计划迁移声明以外，所有声明正文（忽略格式空白）逐项完全一致。workspace原cancel/acknowledgeStopped参数化的两种停止握手变成一个普通无proof取消业务case，所以原组合41展开减少为40，声明未被整条丢弃。

1. run-view：原invoke_skill停止确认要求退休；原case改call_tool，原stopConfirmationRequired、cancel操作、stoppedActions完整领取字段、写cancellation后done和actions清空断言均保留。新三probe中的实际compact cancelled invoke_skill done与无停止模板覆盖另一分支。不是将旧case整体删除。
2. cross-app cold reload：退休cancelled普通Skill必须acknowledgeStopped才释放；新case实际cancel无proof、cold load另一个固定应用、同范围claim running，旧Run完整对象不变，原claim完整保留。
3. workspace cold reload：保留原正常批准流程和真实claim，同应用冷重载后新peer经自己的原用户Wait批准并正常领取；原取消Run分区closed、claimToken保留、inspect完整对象不变、重复cancel无proof仍closed。原两个停止确认API分支及相应wrong-proof之后继续占用的要求退休，不扩大到generic Engine协议。原synthetic restored样本只改runId而未改原Wait身份；父首轮真实错误是INVALID_RUN: Wait.id…而非预期SCOPE_HELD（两展开同样）。这说明该断言在当前边界没有证明到scope保护；其取消后仍要竞争scope本身也属于本轮退休合同。真实unknown-writer/stale-checkpoint/fence与raw-writer保护的原独立声明未改、继续通过，不能以删除synthetic样本为理由放宽真实恢复身份。
4. child width：保留真实128活跃子Run拒绝。取消普通Skill不再因为缺停止证明继续计预算；实际Hook允许，并逐child确认原claimToken、cancellation/ executionStop缺失。原完成历史不计活跃、终态产物固定和child归属反例全在未变声明中保留。

## 实际执行证据核对

父首轮 coverage/shared-cancel-and-published-frontier-results.json：success=false、37 passed/4 failed。两条新语义旧断言分别因合法claim已成功、view已done失败；两个workspace展开实际在不完整synthetic Wait身份处INVALID_RUN失败，不能称旧scope机制复现。

父最新 coverage/shared-cancel-and-published-frontier-green-results.json：success=true、40 passed/0 failed，含共享三probe和真实0.5.2 Build两前沿。四文件中run-view/cross-app/workspace三个新精确name均查到passed。coverage/shared-platform-cancel-hook-results.json：success=true、8 passed/0 failed，含精确128活跃拒绝及取消释放case。本Review只读这些真实JSON，没有重新运行或把原先未执行项改写成凭空通过。精确映射、完整old/new body、当前行号见 shared-cancellation-four-file-final-review.json。

普通平台Skill的停止回执已不再是前置条件，generic Engine可选停止记录/原claim验证继续存在。未变恢复case末尾仍可附stoppedActions作为兼容输入，这不构成普通任务必须附proof才能取消。generic Engine全组本Review未另跑，不声称40/8报告包含它。

## 非阻塞文字建议

cross-app未变的“rejects a pre-claim checkpoint after the writer Store is lost, then restores the original unknown claim and releases only by proof”标题含only by proof，已不能准确描述当前平台取消合同。原body的stale checkpoint拒绝、原unknown writer恢复、取消前scope仍占用及显式取消后释放应完整保留；可仅将末句改成 releases after explicit platform cancellation。该body本轮40组实际passed。本意见不要求删除其可选generic协议兼容输入，也不将标题问题记成产品缺陷。

## Registry

依据 scripts/lint/workflow-regressions.mjs 当前语义，逐case沿testMigration.supersededBy取最后tests为有效目标；另核对冻结历史cases及catalog的historicalTestMigrations叠加。524个当前case、34个历史迁移已读。四文件有效末端引用0，全部历史链引用也0。因此 **无需append任何testMigration、无需metadata变更**。具体no-op计划保存在 shared-cancellation-final-registry-plan.json：append=[]。没有把历史关联误作当前执行目标，也未为无登记测试编造case ID。

真实平台Hook、新生成bundle/安装包、模型行为/Eval仍不在本Review证据范围。
