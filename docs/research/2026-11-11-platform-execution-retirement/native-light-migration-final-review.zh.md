# Native 混合测试最终迁移交接

仓库产品和测试未改。可应用副本在 `repository-ready-final/`，全部转换为仓库相对 `.js` imports、移除Temp观察写与绝对机器路径。Temp副本经Prettier格式化；未在仓库内运行这些副本、未作仓库类型检查/build/全量/Eval。

## 可应用文件与实际证据

- `native-cli-v4-surface.test.ts`：43声明/45展开，保留当前public CLI批准、完整真实SDK checkpoint恢复、复制根恢复、readonly、candidate/session绑定、真实Git归档、用户retry/resolve决定。`native-cli-v4-business-complete-results.json` 原完整运行44过1失败，82.55秒；唯一semantic blocker缺recoveryContext已在同一原型完整单项补跑通过，`native-cli-v4-semantic-final-results.json`（7.82秒）。这是44+1分段全部45通过，不是最新源码单次整文件45绿。相对于原54声明，11条旧worker/overlay/reservation/自动降级或根雷达合同逐条保留在最终JSON，不静默删除。
- `native-doctor.test.ts`：7当前业务，`native-doctor-all-retained-results.json` 7/7。实际SQLite活跃writer保护/已释放metadata清理及database inode保留、选择读取不写/显式选择不改Run、16KiB边界、escaped Runtime拒写、配置损坏、实际rootmove ready中断与显式rollback。原Doctor完整13条仍按映射区分，旧trajectory诊断缺口见下。
- `native-doctor-published-transition.test.ts`：真实冻结052已批准Shape→Build pending transition WAL。readonly exactbytes不变；显式repair后保留原批准并正确Build；旧RED→当前GREEN 1/1，`native-doctor-published-transition-final-results.json`。
- `native-published-document-builder-report.test.ts`：真实同一052材料升级后继续公开CLI Builder→平台Verifier→当前真实报告writer；5份旧文升级及Builder后bytes全部不变，其余4份在新报告后仍不变，旧verification.md在existing preserved报告目录bytes完整保留，新报告等待当前用户批准。`native-published-document-builder-report-results.json` 1/1，7.74秒。Agent/User输入明确SIMULATED，未启动真实模型/受管执行器。
- `native-agent-content-judgment.test.ts`：原先3当前业务已通过；生成Runtime/parent alias续行及真实普通Node exit7失败报告不能因编辑变成功。生成bundle是此前root生成物，不代表本轮最新bundle已验证；以root后续仓库测试/build为准。
- `native-guards.test.ts`：3当前业务先前通过；空材料拒绝、真实用户批准Wait/stale decision拒绝、完整Agent acceptance证据。旧Markdown固定标题/[blocking]/文件存在机器判断明确交Agent，本轮无模型遵循证据。
- `native-doctor-v4.current-business.partial.test.ts`：2项fresh/report readonly。文件名明确partial，**不可用它静默替换原14声明整文件**。

## 必须保留的原文与逐条映射

`native-light-migration-final-map.json` 保留109原声明的正文、标题、行号、137条registry来源引用；每条明确当前目标/退休机制/合同改变/未覆盖。`originals/` 保留原六文件原文。没有修改registry，也没有用改caseID绕校验。当前case标题变化需父agent按此map同步registry并Review。

## 尚未取得完整等价执行证据

1. 原Doctor-v4 `merges portable statuses with legacy migration findings in a mixed project`：当前known入口升级，不恢复全项目旧布局扫描；混合诊断未重写执行。
2. 原Doctor-v4 `finishes an incomplete portable migration through named Doctor repair`：原借evidence.md存在触发cleanup并要求删正文，破坏性合同明确退休；本轮真实052原文保留已更强证明，但显式旧migration journal兼容须独立覆盖。
3. 原Doctor-v4 `reports and resumes a persisted portable migration transaction`、`repairs a persisted portable transaction from project-wide Doctor`：实际pending phase WAL已有RED/GREEN，不能代替这两条migration journal readonly/named/global恢复。原手写v3+prepared journal仍在归档；尚未给出真实052持久化migration journal完整替代。
4. 原Doctor `reports malformed Run trajectory data with its path`：当前Doctor不读取legacy trajectory.jsonl。原文件保留不等于诊断仍覆盖。应明确Review是否退休只读历史诊断；若保留，需要只在已知旧change显式诊断原路径，不恢复旧executor/快照。
5. 原Doctor-v4 Supervisor四条overlay进度/父漂移/unknown字段机制退休，但实际SDK原Wait/Child批准/未决claim保留应逐条绑定当前published业务升级测试（最终JSON列精确selector；子agent未重跑，不声称完全等价）。
6. 原active+archive冲突case只是把未归档Shape复制到archive文件夹（archived:false）；新Doctor不把其认成已完成历史。这是目录雷达合同退休。尚未测试两个真正合法done历史同名歧义，不能宣称此反例已绿。
7. 原Doctor旧hash/进程身份升级和change-local Runtime整体迁移：只保known入口导入业务文件，不恢复hash identity/执行状态扫描。最终JSON保留每条来源和Review限制。

## Legacy正文删除调查结论

原cleanup按文件名删evidence/repair/archive/checkpoint/verification，只有evidence可找到Generated-by旧派生writer；verification是实际报告输入，其余3不能证明都是派生。实际真实052待恢复WAL+5份用户原文已RED→GREEN。当前source不再按名删，storage也不再删verification；existing writer备份链已通过。`hasIncompleteNativePortableMigration`旧heuristic仅定义无生产caller，不能声称用户普通next每轮都走重复cleanup。新实现只看真实migration txn，不引入snapshot/hash/manifest。
