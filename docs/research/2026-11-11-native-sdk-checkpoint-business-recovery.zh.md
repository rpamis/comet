# Native SDK checkpoint业务恢复

来源：`report:2026-11-10-agent-platform-execution`。本轮保留原9声明的完整原body，当前22展开通过，见title-behavior-mapping.json；未用当前工厂伪造旧definition。实际发现并修复4个独立行为，新增建议case记录见new-case-records.json。

纯历史bound读不逐次核对Gitnamespace，实际CAS/便携恢复写入前才比较。progressed revision1 partial沿原recoverFromPortableFile(interrupted)核对原sourceRevision/完整记录并恢复；Readonly不补写。真实Shape public Agent虽然当前type为call_tool，其native-host/session交接必须发布checkpoint。内部无session collector继续在当前本地Run内推进；不恢复重复marker、PID、停止握手或旧checker。

原sourceRevision/sourceHash都删掉的SIMULATED legacy数据，按SDK既有格式保持实际normalized1；不能借已退休marker猜原revision。另两项真实bound sourceRevision partial分别验证合法精确恢复与漂移拒绝，不能以前者替代后者。原Build interrupted claim、Shape批准、输入绑定、真实平台Node检查报告、pending Verifier及custom application边界均保留。

源码协议22通过；原current公共next --session原生领取已复现portable版本落后（RED），Temp修正通过。正式构建后的公开CLI证据尚待根合入并build，因此4个建议记录都保built public CLI附加验收pending；不冒称安装/真实平台Hook/模型/Eval已执行。
