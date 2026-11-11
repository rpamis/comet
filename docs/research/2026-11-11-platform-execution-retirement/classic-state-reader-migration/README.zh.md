# Classic状态reader并发机制与业务测试迁移

授权：report:2026-11-11-single-writer-workspaces。产品源码未改；不恢复reader锁、额外inode/mtime/hash快照或新缓存框架。

原31项整组4失败已由Root实际记录于final-diff-domain_comet-classic.log。只定向复现前三项0pass3fail；第四原case用1500ms上限复现其等待已删除SQLite锁永不触发的超时，没再等120秒，不把该有意缩短的timeout当产品修复证据。完整原文件及四声明全文冻结在tests.json/mapping.json。

第2不是简单退休：旧fixture在readRunState mock中于已读YAML后并发手改。改成同一个串行controller两次实际read之间完成同size编辑并恢复mtime，保留旧标题，增加真实byte length、mtime(<1ms)、新phase可见、原Run/用户编辑bytes不变断言。

其余三条仅退并发窗口重试/SQLite serialized-reader等待，分别保完整提交后phase+Run+iteration一致、ino0 legacy mock下正常读取不再开DB，以及真实状态WAL/Run/YAML commitpoint和失败回滚。第4在beforeCommit真实记录已经写入的after Run与before YAML及WAL，readonly读必须拒且原journal/Run不变；抛实际中断后恢复before，再串行成功提交after。没有并行writer、模型或伪造SDK批准。

新四目标单次4pass0fail27未选；其余27未重跑。Root原31中其它27已绿，与本次结果分层报告，不冒称另有单次31/0。四条对应current/冻结历史有效selector和旧链provenance均0，故无CAS/ID需要追加。Prettier检查通过，无新增skip，无build/Eval/模型/容器。
