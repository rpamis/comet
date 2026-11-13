# Classic只读缺失marker目录fixture修正

授权：report:2026-11-11-single-writer-workspaces。产品源码冻结、未改。

整文件11项一次实际10pass1fail0skip；唯一fail发生在测试setup的fs.rm已不存在state-projections/classic目录（ENOENT），还未进入store.read。对应当前产品按要求不创建普通锁/重复投影目录，不能为测试恢复目录。

只将无条件删除目录替换为起初已不存在的明确断言；原matching state/read-only/no-rebuild和project完整snapshot全部保留，另加整个Runtime目录bytes/mtime snapshot、write spies、读取后目录仍不存在。原标题和其余10项完全不动。精确此单项随后1pass0fail10未选；两次结果共同覆盖11目标，不宣称另有单次整文件11/0。

当前及冻结历史effective selector没有命中这一声明，无改名、降断言或新skip，不需要新增CAS。完整旧文件/旧声明与更强新正文保存在独占四artifact，未覆以前hash证据。不修改noForeignRead/noRuntimeInit其它测试或合同；新Runtime快照与write spies进一步核对无本机写入。无build/Eval/模型/容器。
