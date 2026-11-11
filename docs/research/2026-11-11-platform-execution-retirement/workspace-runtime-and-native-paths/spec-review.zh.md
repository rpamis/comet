# 工作区 Runtime 三旧档逐声明审查

57个原声明，展开69例（主档64例、另2+3）；主档历史所称63是失败数量，不是总数。原全文及每声明正文/摘要已冻结。分类：{"pure-retired":{"declarations":32,"expandedCases":40},"mixed":{"declarations":21,"expandedCases":22},"business":{"declarations":4,"expandedCases":7}}。有效末端只有T07和legacy migration meta-lock两个原ID；repair-failure当前/历史0引用。

当前Temp原型17/0，通过Windows真实Run别名、显式ensure卷根6边界、无fence并发ensure、source/data链接拒绝、不跟随foreign marker、Git init原Run隔离、明确SDK checkpoint恢复、公开Doctor physical checkpoint两slot/坏历史/大context导入。另逐断言复用既有9绿的真实052 Archive WAL/完整Run/闭合归属/较新目标保持。未把未重跑检查称本轮新通过。

阻塞：第31声明含仍需保留的Classic交付收据导入责任。实际052公开入口生成真实文档归档receipt，原字节置于发布版认可的project/.comet/classic-deliveries后，旧read=complete；当前public doctor --import-legacy-runtime退出0但未导入，current read=needsVerification。Git-common位置也被旧reader支持且当前导入未覆盖，但真实Git producer本轮未完成，不能称同样已复现。最薄修只放在明确导入/升级入口，不恢复ordinary receipt搜索/移动。

批准pure-retired声明按完整归档和原ID映射退休；mixed/business需要按JSON逐断言目标落地，其中31必须补业务修复/green。不能整档无条件删除主档。旧workspace迁移snapshot/hash/quarantine/锁恢复与真实Archive/WAL、SDK checkpoint严格区分。

T07相邻native-paths第一声明已另读：arbitrary record.json普通named迁移/fence正属撤下机制；保named解析不扫其它changes、零迁移/原bytes/目录不变/不建fence与连续两次调用。不要保旧失效selector，也不要把此synthetic record称真实052Run。

| 原声明 | 展开 | 分类 | 原标题 | 末端caseID |
|---|---:|---|---|---|
| workspace-runtime.test.ts:47 | 1 | pure-retired | retries a transient fence publication observation with a bounded fresh read | workflow-simplification-t07-named-migration |
| workspace-runtime.test.ts:60 | 1 | pure-retired | does not reuse an unstable fence after its bounded publication retries | workflow-simplification-t07-named-migration |
| workspace-runtime.test.ts:78 | 1 | business | reads the same saved run and lock through a Windows case alias | 无 |
| workspace-runtime.test.ts:104 | 1 | mixed | validates the volume root without attempting mkdir when the root would reject it | 无 |
| workspace-runtime.test.ts:126 | 2 | business | rejects a nonphysical volume root reported as a %s before creating directories | 无 |
| workspace-runtime.test.ts:145 | 3 | business | preserves a volume root lstat %s error without attempting mkdir | 无 |
| workspace-runtime.test.ts:165 | 1 | mixed | checks read-only fence ownership without following a foreign target | 无 |
| workspace-runtime.test.ts:203 | 1 | mixed | creates the user-level runtime and its compatibility fence with concurrent initialization | 无 |
| workspace-runtime.test.ts:215 | 1 | mixed | migrates the entire legacy tree, preserves evidence, and leaves only one fence | 无 |
| workspace-runtime.test.ts:244 | 1 | pure-retired | supports separate files with a directory fence that blocks legacy writes | 无 |
| workspace-runtime.test.ts:257 | 1 | pure-retired | copies across filesystem boundaries and only renames within each filesystem | 无 |
| workspace-runtime.test.ts:274 | 3 | pure-retired | refuses old lock or in-flight writer %s without modifying the source | 无 |
| workspace-runtime.test.ts:285 | 1 | mixed | refuses unfinished transactions and active execution owners | 无 |
| workspace-runtime.test.ts:296 | 1 | mixed | keeps completed transaction and execution evidence | 无 |
| workspace-runtime.test.ts:308 | 3 | pure-retired | checks repeated journal names while preserving %s transaction evidence | 无 |
| workspace-runtime.test.ts:324 | 1 | pure-retired | does not interpret journal-like evidence with another suffix as transaction state | 无 |
| workspace-runtime.test.ts:331 | 1 | mixed | rejects a symlink inside the source and a symlinked data subtree | 无 |
| workspace-runtime.test.ts:342 | 1 | pure-retired | rejects hardlinks instead of migrating data another path can change | 无 |
| workspace-runtime.test.ts:348 | 1 | mixed | never merges an existing target even when its bytes match | 无 |
| workspace-runtime.test.ts:357 | 4 | pure-retired | retains recovery records and safely completes on retry after a crash at %s | 无 |
| workspace-runtime.test.ts:384 | 1 | pure-retired | detects a writer changing the quarantined source before publication | 无 |
| workspace-runtime.test.ts:406 | 1 | mixed | isolates a copied foreign fence without following its recorded target | 无 |
| workspace-runtime.test.ts:418 | 1 | mixed | rejects source or destination outside the current workspace runtime | 无 |
| workspace-runtime.test.ts:431 | 1 | pure-retired | accepts a same-workspace fence after moving a change into archive | 无 |
| workspace-runtime.test.ts:444 | 1 | pure-retired | refuses changing the home root for a fence belonging to this workspace | 无 |
| workspace-runtime.test.ts:451 | 1 | mixed | does not treat an old SDK revision as the current active execution | 无 |
| workspace-runtime.test.ts:469 | 1 | business | refuses an invalid latest revision and an incomplete history | 无 |
| workspace-runtime.test.ts:478 | 1 | mixed | preserves completed transaction backups without interpreting them as journals | 无 |
| workspace-runtime.test.ts:496 | 1 | mixed | migrates large ordinary files without attempting to parse them as fences | 无 |
| workspace-runtime.test.ts:505 | 1 | mixed | migrates through a workspace alias and coalesces alias and physical callers | 无 |
| workspace-runtime.test.ts:520 | 1 | mixed | accepts an explicitly contained Git metadata source and rejects its siblings | 无 |
| workspace-runtime.test.ts:539 | 1 | pure-retired | pairs Classic command execution events before migrating any sibling artifact | 无 |
| workspace-runtime.test.ts:577 | 1 | mixed | preserves a pending handoff and an unknown action without migration | 无 |
| workspace-runtime.test.ts:585 | 2 | mixed | migrates a valid legacy restored checkpoint at physical slot %s | 无 |
| workspace-runtime.test.ts:636 | 1 | pure-retired | resumes a migration whose recorded local process has exited | 无 |
| workspace-runtime.test.ts:657 | 1 | pure-retired | recovers a stopped migration without host or PID binding | 无 |
| workspace-runtime.test.ts:678 | 1 | pure-retired | refuses recovery after copied evidence is changed or a conflicting target appears | 无 |
| workspace-runtime.test.ts:700 | 1 | pure-retired | rebuilds a proven partial copy from its unchanged backup | 无 |
| workspace-runtime.test.ts:724 | 1 | pure-retired | keeps unknown files in a partial stage and fails closed | 无 |
| workspace-runtime.test.ts:748 | 1 | pure-retired | checks old locks and migration journals without creating directories | 无 |
| workspace-runtime.test.ts:763 | 1 | mixed | recreates a lost current-workspace runtime for portable checkpoint recovery | 无 |
| workspace-runtime.test.ts:773 | 1 | pure-retired | does not recreate a lost runtime when its fence points to a different target | 无 |
| workspace-runtime.test.ts:782 | 1 | mixed | allows portable recovery after a migrated Native change runtime is lost | 无 |
| workspace-runtime.test.ts:796 | 1 | mixed | leaves lost Classic run-state and checkpoint files absent for portable recovery | 无 |
| workspace-runtime.test.ts:815 | 1 | pure-retired | still rejects a changed per-record fence target after local data loss | 无 |
| workspace-runtime.test.ts:831 | 1 | pure-retired | seals a missing legacy file lock without creating a home lock | 无 |
| workspace-runtime.test.ts:849 | 1 | pure-retired | never replaces an existing legacy lock or an unknown directory while sealing | 无 |
| workspace-runtime.test.ts:866 | 1 | pure-retired | keeps a sealed legacy lock valid across archive moves while rejecting target drift | 无 |
| workspace-runtime.test.ts:881 | 1 | pure-retired | only accepts a copied legacy lock fence with explicit foreign-workspace permission | 无 |
| workspace-runtime.test.ts:901 | 1 | pure-retired | does not leave a half fence when interrupted after staging mkdir | 无 |
| workspace-runtime.test.ts:925 | 2 | pure-retired | does not replace a legacy %s appearing before fence publication | 无 |
| workspace-runtime.test.ts:951 | 1 | mixed | keeps non-Git runtime evidence isolated after git init without following its old fence | 无 |
| workspace-runtime-legacy-lock.test.ts:15 | 1 | pure-retired | recovers a legacy migration recovery lock only after the original operation is confirmed stopped | runtime-legacy-migration-meta-lock-confirmation |
| workspace-runtime-legacy-lock.test.ts:36 | 1 | pure-retired | preserves an active migration recovery transaction even when recovery is confirmed | runtime-legacy-migration-meta-lock-confirmation |
| workspace-runtime-repair-failure.test.ts:35 | 1 | pure-retired | recalls the recorded failure only while the source stays unchanged | 无 |
| workspace-runtime-repair-failure.test.ts:50 | 1 | pure-retired | does not recall when the journal itself disappears | 无 |
| workspace-runtime-repair-failure.test.ts:56 | 1 | pure-retired | memoizes a real failed repair through resolveWorkspaceRuntimeRoot | 无 |

未执行Eval、全量、主工作区正式集成。本worker没有改产品、仓库测试或registry。

## 后续补证：Classic 两个原收据位置

Git-common 已沿实际052公开local授权、实际Git归档commit和公开commit receipt生成取得RED，不再只是源码疑点。旧read(evidence:false)=complete；未改当前公开Doctor导入后仍needsVerification/缺receipt。Temp编译薄补丁在两个原根均GREEN，保原授权/receipt原字节，Git变体保原commit和HEAD；重复导入为空。源补丁仅两产品文件，在classic-receipt-repository-ready，未改仓库。

另可合并的Classic receipt测试/两真实冻结fixture在repository-ready；Temp resolve alias仅将被测明确import模块指向Temp补丁，实际9/0（两合法+identity/auth/schema/unknown-field/conflict/currenttarget/link）。这证明Temp方案，不等于产品公开CLI已修；root集成后仍需正式public CLI/回归GREEN。统计与57项原正文保持不变。
