# Classic首次提交排除安装metadata测试迁移

授权：report:2026-11-10-agent-platform-execution。产品源码未改。

根Classic module75项实际74pass1fail（coverage/final-diff-domain_comet-classic.log813），拿到title后仅精确复现此1：TypeError deliveryPaths is not iterable。根因是fixture仍传已退休managed-check manifest文本和execution {argv,cwd}，当前函数签名是(root,run?,deliveryPaths?:string[])。未反向恢复旧检查执行器/收据签名。

只迁这一声明，原标题/原业务期待source.js仍是首个提交实现、node_modules安装metadata不得进入交付范围均保。新fixture在真正未有HEAD的临时Git仓库写实际source.js与实际node_modules/.modules.yaml，使用当前收集API，另加显式选择metadata必须拒绝、原源文件/metadata bytes不变。原fake hash manifest全文冻存。定向同一title随后1pass0fail74未选，不重跑3分钟其余74。

当前/冻结历史effective selector没有命中此声明，无改名/skip/降断言，无ID需要追加。完整旧文件与新旧body、独占四artifact和真实红绿JSON在本目录。不包含原用户授权交付，仅验证原有内部path收集边界，不把它当完整Archive批准/交付证明。没有build/Eval/模型/容器，原scope/批准/Archive其它74用例与产品源码不动。
