# Native 历史测试的当前恢复合同

授权来源：`report:2026-11-10-agent-platform-execution`。本迁移保留原19声明完整正文及3个改名case原登记，只追加testMigration；不改原sources、behavior、expected、forbidden或旧链。原7targets涉及6IDs；其中linked-worktree/CRLF的3IDs原exact titles保留，无需append。

当前测试文件38展开分支。Temp最终源协议37通过、0失败、仅1项正式bundle待根合入第二源码patch后build；先前整文件实测唯一bundle失败已原样保留，不能记通过。动态import最终恢复边界4通过。根合入并build后应实际运行整文件38，独立记录结果。未运行Eval、真实模型、Hook安装、远程交付或全量测试。

只删除旧import-journal/projection发布、跨worktree自动搜索、停止回执和专用progress timer机制。原Run/批准/claim/portable转换/坏数据拒绝/中断恢复/较新记录不回滚全部保留，详mapping.json每原声明及完整originalBody。全文件采用当前真实Native@4创建；坏数据分支明确SIMULATED。真实0.5.2取消样本另由native-cancelled-portable-recovery.test.ts保存，不用新工厂伪造旧定义。

便携协议会将live claimToken转换为portable-*，并按既有协议重算收据；恢复记录以实际文件readPortableRunCheckpoint解码值为准。保留原Action ID、attempt、inputHash、session、executor、批准及原来源字节；不要求错误的live token深等。

两项最小已复现错误：closed history正文损坏global Doctor误报成功；同字节owner双份explicit迁移不能恢复。Doctor补丁已由根合入。第三项真实linked已取消批准/领取业务在旧工作树删除后被原分支绑定误拦，第二补丁只在便携恢复允许cancelled原记录读取，活动任务跨分支仍拒绝；未知current hash在写owner/Run前拒绝，Child lineage仅public顶层恢复约束，不全局禁止parent的child store。

真实Archive义务核对：用发布npm0.5.2原applied-finalize-pending冻结Run及真实WAL调用其公开Native runtime.cancel，实际拒绝且原Run深等。未复现正常Native产出的cancelled+WAL输入，不扩大为绕过Native生命周期的rawStore场景。原SIMULATED修改步骤名字不代表真实归档副作用，仅旧按名称全拒机制退休；既有published Archive/WAL恢复与不重放矩阵保留。

以下逐原声明映射：

1. **shares one Store root per project history inspection and rechecks each scan after metadata changes**：原Store root批量解析次数、元数据损坏及同一Hook epoch内重新观察全部保留。

2. **closes a fully cancelled Run while retaining readable history and portable documents**：原cancelled封存、closed CAS拒绝、active/history分区及用户材料可读全部保留。

3. **keeps an unfinished Run active during explicit migration**：原unfinished保活动、不越权推进保留。

4. **never migrates on ordinary inspection and resumes explicit interrupted closure**：普通只读不封存；原显式中断闭合与幂等保留。

5. **defers closed history body corruption to explicit inspection while Hook reads only partition metadata**：Hook只读分区不解析closed正文；named status和global Doctor必须拒绝损坏正文，已原RED→GREEN。

6. **does not let a history owner hide an active checkpoint conflict**：历史owner不得隐藏活动checkpoint冲突，原记录不覆盖。

7. **recovers an interrupted owner publication through a new explicit doctor invocation**：同字节active/history owner双份普通读取拒绝，沿既有recover入口显式恢复并闭合，原RED→GREEN。

8. **keeps an interrupted %s transaction visible and recovers it through explicit migration**：实际Store closing与reopening各保留中断可见、再恢复与重复调用。

9. **rejects same-revision content drift and unknown workflow definitions before closing**：原同revision内容漂移拒绝、未知当前definition拒绝且不闭合；未知定义文案调整为当前definition hash。

10. **restores a portable %s Run on another device without the original runtime or history partition**：另一设备无Runtime恢复保原Run ID/revision/状态/Actions/批准；比较实际portable checkpoint解码记录，不能要求live claimToken等于portable-*；cancelled共同repair直接正确闭合。

11. **migrates a stopped portable cancellation after its linked worktree is removed without changing evidence through %s**：真实linked worktree Shape批准→Builder领取→cancel，Git commit/merge并删除原worktree、CRLF便携文件；公共Doctor repair通过runtime/bundle两边界恢复原记录、重复、Hook无活动且源字节不变。停止回执要求退休；同一原title保持7targets中3IDs精确选择器。

12. **does not shadow the %s authority in a registered source worktree**：旧自动跨worktree搜索退休；真实原始/较新source Run在显式本地取消恢复前后深等，不能冒称全局扫描仍存在。

13. **rejects portable history import with %s without overwriting local evidence**：10分支逐一保留/转换，详guards映射；普通平台活动claim、无stop取消可恢复，真实坏数据无落地，root Child不冒充顶层，原本地权威无owner仍拒绝。Archive参数只保原SIMULATED名称损坏，无claim/事务/成功，非真实Archive义务。

14. **keeps portable history import safe after interruption at %s**：8旧阶段中journal/projection纯旧机制退休；7当前中断分支加closing/reopening原2业务，均公共Doctor+重复恢复，源变化及较新本地记录不能覆盖。

15. **reports explicit migration progress on stderr without polluting JSON or ordinary doctor**：保普通Doctor只读、JSON可解析、批量结构化active/migrated/healthy；专用stderr进度文案退出。

16. **throttles intermediate progress to five seconds while always reporting completion**：只有旧专用progress timer五秒节流机制，随已删除progress组件明确退休；无业务状态/批准/claim断言丢失。

17. **keeps migration failures visible in the result and final progress count**：失败必须非0且healthy=false并具逐项findings；补真实未闭合terminal不得报migrated/释放selection；旧最终进度字符串退休。

18. **rejects combining migration with unrelated mutation flags**：原migrate-history不能与无关mutation参数组合，原Run仍活动，保原title。

19. **rejects source authority appearing after the history import journal is published**：旧journal发布后重新扫描全worktrees机制退休；同case原始/较新source权威业务在第11映射，另活动分支显式恢复拒绝保所有字节/owner/Run不落地；不伪造旧journal阶段。
