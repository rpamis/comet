# Runtime command 12条失败迁移 Review

结论：本次9个原声明/12展开均为当前公开协议、fixture或已授权发现策略变化的迁移；未发现需要恢复旧执行器的产品缺陷。Temp单轮12/12 GREEN（21.39秒），最终raw只读精确响应断言另1/1 GREEN。45条仅本轮未选中；不声称整文件57全通过。产品、仓库测试、registry未修改，无Eval/模型/安装/根构建。

## 原文、应用与范围

完整原文件 original-runtime-command.test.txt；9原声明/12case正文 original-nine-declarations-twelve-cases.json；原失败证据从根 coverage/platform-execution-verify-changed-rules-current.log完整复制保存为 original-platform-execution-verify-changed-rules-current.log。业务映射与新旧body见 runtime-command-twelve-business-map.json。

repository-ready/test/app/runtime-command.test.ts可应用完整副本；repository-ready/runtime-command.replacements.json提供按原oldBody精确替换的9声明及2helper，便于CAS避免覆盖并行变化。9目标以外35条现有声明正文逐字不变（格式化前核对）。仅shared classicStartRequest的当前请求版本改2，以及只读冲突helper可显式传目标projectRoot。没有批量改其他Native旧请求字面量；generic editorial version1未改。

## 逐业务保留与退休

1. Native内置启动/重读：请求和断言使用当前workflow4，保留shape.prepare pending、原Run revision1、同一SDK store、inspect恢复及精确change owner记录。旧version1作为当前默认的断言退休，不恢复旧factory。
2. Classic linked claim：保留真实Git worktree、auto_transition用户配置变更、readonly inspect拒绝未同步配置且原bytes不变、显式state next同步配置、领取原Action。新增默认primary目标拒绝并确认linked Run未变，再明确projectRoot=linked合法领取；primary store没有该Run。退休自动从primary扫描其他worktree找Run。
3. Native linked claim：同样新增primary默认拒绝+linked Run不变；显式linked projectRoot领取原Action；primary store无该Run，保领取id/状态及真实Git worktree。
4. Missing Native owner：使用当前factory4创建真正无owner的SDK Run；公开入口仍拒绝，owner JSON不被预留。未放宽归属或凭rawRun自动接管。
5. Raw legacy旁置内容：原fixture实际是SDK建立后把派生state文件替换为单行 schema: comet.native.v4，不是真实已发布旧Run。当前readonly inspect成功返回完全相同原SDK Run，原Run对象与单行raw bytes完全不变；随后显式next成功且权威Run仍完全相同。原“出现raw文件就必须全拒绝next”断言退休，保留“不能覆盖/采信raw内容污染权威Run”的业务。只证明readonly保留原raw bytes，不声称显式next后一定保留该派生文件原文；不把该fixture写成旧版本迁移证明。raw-legacy-readonly-observation.json记录实际成功完整返回，最终精确status/data断言已1GREEN。
6. Managed check：原第二次Shape重校Action、verificationChecks计划、comet-native-checks执行器/verify.checks收据节点、verify.report独立步骤退休。新case经公开独立JSON请求：真实Shape准备及原用户批准，Agent实际普通Node exit0/stdout sdk-check-ok、一次计数及log文件，Builder回报实际checks，当前独立Verifier完整验收。尝试旧executor明确失败且Run不变，不重放Node；原Shape批准保留，verify.confirm pending，新错误批准hash拒绝且Run不变；原日志和count1保持。没有把一条静态模块不存在断言替代真实平台检查和用户批准行为。
7. Classic full/hotfix/tweak三展开：当前workflow2；保留每profile自己的workflow id、open pending invoke_skill。旧默认1退休；未恢复旧checker图。
8. Linked Classic冲突两展开：保留有/无primary配置的真实worktree场景、linked项目内冲突state文件、原owner bytes、所有fs写API spies及open写flag为空、primary Runtime目录不被创建。只将检查入口明确指到linked projectRoot，仍因本项目真实ambiguous拒绝；不扫描其他worktree。
9. 真实CLI：Temp复制既有bin/package.json/current dist，在独立Node进程公开 runtime dispatch Native，不提供workflow文件。当前start默认紧凑投影保Run身份、workflow4、prepare-shape-confirmation续行及inspection请求，且不返完整actions；同一原Run后续inspect仍返完整shape.prepare pending、revision1、workflow4。旧默认start完整Run输出退为紧凑，完整读取合同保留。不是只测内部函数。

## 证据与未执行项

runtime-command-twelve-results.json/log：12 passed/0failed/45unselected。raw-legacy-readonly-results.json/log：最终补强readonly返回status=succeeded、data=原完整Run的单项1passed，其他56仅未选择；最初观测JSON另保留。

Temp仅移除ensureCliBuilt调用以避免与根构建并发；真实CLI使用当时已存在dist/app/commands/runtime.js（读取时2026-11-11 06:52:23）。repository-ready恢复原ensureCliBuilt guard，其根构建路径及其余45测试留父Agent验证；不能把Temp现成dist当成最终重建的安装包证据。无新产物构建、无真实平台Hook、无Eval或模型行为证明。

setup.ts隔离COMET_DATA_DIR、HOME/USERPROFILE、APPDATA/LOCALAPPDATA、CODEX_HOME及XDG所有目录。普通Node命令、Git worktree/本地提交和CLI子进程均在Temp；无真实用户项目写入。

## Registry

按当前各case最后testMigration.supersededBy的tests为有效末端核对，9原声明及12实际展开在 test/app/runtime-command.test.ts的直接有效引用0；effective-registry-links.json=[]。因此本批旧name变化无需追加任何case/testMigration，不修改历史链或无关字段。父metadata Agent继续负责其他任务ID，本批不扩展。
