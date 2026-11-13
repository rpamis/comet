# Hotfix / Tweak 双语及Classic交付兼容收据审查

结论：两个发现均已由根 Agent 最薄修正，当前无剩余阻塞。Skill业务语义与批准中文一致；没有恢复受管命令执行入口。

当前源码已快照在 reviewed-current-files.json；逐行为双语映射在 bilingual-contract-map.json。核对了Open预览/原approvalHash、产物变化重新批准、进入Build才结束Open；原Wait/proposalHash上的continue或upgrade用户选择；同Run/工作区升级full Design；contextRequest首次阶段/换Agent/恢复才读取；任务勾选与实际检查报告；Hotfix复现/RED/根因；Tweak OpenSpec apply全部上下文和delta spec一致性；完整验收和Archive/交付当前授权。

classic-sdk-skill-routing与sdk-flow-handoffs差异只替换已退休managed命令断言为complete-build/Verify实际--checks报告，并把连续同阶段不重查的旧preview文案断言转为冷恢复/外部变化/缺信息的读取条件。Open原批准hash断言、SDK/Compat路由、上下文、配置/计划/升级/Archive断言均保留。父报告 coverage/bilingual-presets-current-green-results.json已只读核对success=true、50通过0失败；本子任务没有重跑50项，文本契约不能证明真实模型遵循。

发现并已确认修复的英文链接：两个main原#start-and-artifacts并不存在，真实参考标题是Entry and artifacts；根已将两处改为#entry-and-artifacts。中文#开始与产物保持正确。

Classic旧导入仅在已知升级/明确修复入口组合，readClassicDelivery/evidence:false只读原授权与当前收据，不进行Git交付。importLegacyBusinessFile只复制不存在的当前目标，exclusive发布并保留旧源；重复导入不替换当前记录。来源仅当前配置Classic changes/archive、已知project-local或真实Git common receipt位置；identity/schema/未知字段/授权ID/两个旧位置冲突在发布前检查，当前权威已存在时不从旧源覆盖。readReceipt普通只读只看当前receipt位置，旧布局枚举没有留到普通读取中。parseClassicDeliveryReceipt是原receipt解析职责的导出复用；filename沿用原identity摘要，不新增指纹协议。Git common-dir探测是当前仓库的元数据读取，不是其它worktree扫描，也不执行commit/push/merge。

实际发现并已复测修复：已封存formal delivery.commit=A、旧receipt同identity/authId但commit=B时，原import仅检查authorizationId，成功复制冲突B到新权威位置，随后正常reader才报冲突。根在发布前加同现有reader的commit冲突条件。最小probe完全复用真实0.5.2 git-common资料，明确SIMULATED增加formal.commit=原receipt实际A，再只损坏旧receipt.commit为40个a；保留显式原authorizationId，不重算/伪造批准。formal.commit本来不存在时，receipt首次提供commit是合法路径，不应被拒绝。

证据：red-conflict-observation.json显示import成功、target存在、随后reader冲突，原formal授权/旧source字节没丢；receipt-conflict-results.json为根修复后同脚本1通过（4.09秒），新conflict-observation.json显示发布前拒绝。red-*保留原结果，测试脚本receipt-conflict.test.ts未降低断言。没有启动Runtime检查器、模型、Eval或真实Git交付。

只写本Temp目录；产品/仓库测试/registry/生成资产均未改，未build。
