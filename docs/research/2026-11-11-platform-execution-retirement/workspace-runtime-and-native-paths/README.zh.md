# 工作区迁移机制退休与 Native paths 业务保留

授权：report:2026-11-10-agent-platform-execution。用户要求普通开发/测试交给Agent平台，物理删除旧监管/PID/停止握手/执行恢复及仅服务机制的快照和锁；普通命令不再隐式迁移布局，必要业务导入和恢复有明确入口，保留原Run/批准/claim/outcomes。

原workspace三旧档完整正文在tests.json：57声明、69展开例（64+2+3）。原正文与逐声明完整映射同时保存在original-declarations/declaration-review-map；32声明/40例纯退休，21/22混合，4/7业务。纯退休包括原workspace copier journal、内容摘要/quarantine、PID/host、meta-lock、fence封印、failed-repair fingerprint缓存；它们与真实transition/Archive WAL、SDKcheckpoint写锁不同。后者全部保留。不得把57声明整称纯机制。

NativePaths原16声明/22例完整正文也在tests.json/native-paths-original-declarations。当前保22例：6声明拆掉普通隐式迁移/执行静默判定，并保原文件bytes、legacy诊断可见、无新fence/目标、copied-fence不跟随和命名不扫其它changes；2条storage/link诊断的原异常断言完整保留，只从纯getter移除必须触发migration错误的旧责任；equal-names/currentRuntime junction的安全断言保留，只补无自动mkdir后所需fixture父目录。原任意record/check receipt/trajectory样本不是发布Run，未将它们伪称真实052。有效业务history/WAL/approval import另映射真实published测试。

两个原case只追加testMigration，保原ID、来源、所有字段与既有链：T07末端指向当前命名零迁移/无扫描及明确physical checkpoint import；legacy meta-lock末端保旧meta文件原字节、无停止确认/无旧迁移副作用。两个旧meta-lock case不是SDK实际写锁，不以其退休撤掉真实事务写入互斥。repair-failure原档当前/历史0引用。

Review已逐声明批准这项迁移方案；整档删除的执行条件是：本档全部归档原文和映射落地、两case payload CAS/schema/evidence通过、应用后当前精确selector正式GREEN。Temp当前NativePaths22+namespace17合39/0；根源码API namespace17+Classic receipt9合26/0；此前真实完整Run/闭合归属/较新target/Archive WAL/receipt9/0逐行为复用（不同轮次分别记，不相加当全量）。另本worker在最新build后真实公开Doctor import两位置隔离GREEN2/0：原授权/receipt字节及Git commit/HEAD不变，重复import为空，无重复receipt。公开CLI已完成，不再待build；根正式应用本测试patch后的39例待运行。

第31原workspace声明相关Classic交付receipt遗漏已由本轮真实052公开writer/Git取证、根薄补明确import解决，不能为退休旧锁丢交付证据。project-local和Git-common原RED、Temp方案GREEN、最新产品publicCLI GREEN分别存档；root source-API9绿是源码层。读-only probe的evidence:false语义已注明；不以当前源码单元代替公开CLI。

首次Temp组合34/5是从错误cwd找不到dist，之后正确cwd39/0；namespace首次11/6为Temp入口替换/合成record存储分区设置错误，不当产品RED。没有重跑Eval、全量、新npm打包/安装或模型/容器。旧WAL/SDKRun自动业务升级、实际CLI启动能力cleanup均不在本切片撤下。

证据冻结：registry/tests/mapping/patch的摘要供追加节点核验，不再改写内容或更换摘要。若之后独立调整测试，另建记录。operations.json只作CAS计划，不用整catalog覆盖其它会话。
