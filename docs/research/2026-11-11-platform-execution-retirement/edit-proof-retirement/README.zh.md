# 旧内容证明实现退休

授权：report:2026-11-11-single-writer-workspaces。

更正：这不是复现了普通CLI执行7次锁。当前Native/Classic edit-review入口早已明确拒绝旧协议；生产rg显示实现没有value消费者、没有index公开导出，只剩类型引用和dead转发。故物理删除edit-review.ts、edit-impact.ts与native-source-comments.ts，去掉只服务旧实现的DTO/unused参数/3处空参数；原批准、任务与真实检查报告仍在SDK业务模型。没有写入、删除或迁移用户已有edit-review记录。

Classic Hook遗留一条会指向已拒绝旧命令的提示，改为当前Agent判断实际变化、决定与检查适用性后沿state next继续。原allow/block逻辑没变。薄CLI错误保留并由公开App命令最小回归验证no-write。

两旧测试全文与20声明保存在original-tests.json；逐行为列在mapping.json。旧自动格式/语义指纹、单独内容复核claim/receipt/store/lock/discard协议退休；真正原审批、当前claim、session与candidate隔离、新candidate全量验收、真实failed报告不变pass分别映到现行精确测试，不能称恢复旧语义指纹协议。老原文side store没有生产读取方，未新建替代reader；当前正式文档/原报告备份保护在既有业务入口。

当前有效registry和冻结历史直接target均0，不因为历史链中出现旧文件就追加/覆盖原ID。普通确定性定向结果见coverage/edit-proof-retirement-business-green.json；其它复用目标使用各自注明的既有报告，不冒称本批重跑。tsc结果在Temp/comet-edit-proof-retirement-20261111/tsc-final.log。没有build/Eval/真实模型/容器/平台Hook，Root统一构建。
