# Classic 周边测试的当前业务合同

授权来源：`report:2026-11-10-agent-platform-execution`。原7文件103声明完整归档，当前104声明；仅5文件需要测试补丁，rebind与Archive扫描原文件不改。Temp当前143项通过、2项沿原Windows symlink跳过；不能把跳过计通过。源修正及普通确定性协议测试不替代正式bundle、安装、真实Hook、模型或Eval。根将整合并记录正式验证；子Agent不写产品/仓库测试/registry，不启动Eval或根build。

真实源码问题分别为：mutation未准备Runtime导致24收据/协调测试失败，首次SDK YAML缺run_checkpoint导致合法rebind/归档CAS误判Runtime-owned edit，旧bound Store在git init后能CAS并同步到新namespace文档。修正仅实际写入口准备目录、显式init首次便携checkpoint、实际mutation namespace核对；普通read不创建/迁移，不逐次核对Git元数据。另无classic-changes旧本机目录时readonly不解析change_id作legacy映射，原entry/branch-drift单次YAML预算保持，不新增cache/hash。

只退休旧writer fence、重复marker、隐式旧日志搬迁、SDK跨worktree自动查找和每读namespace对账。收据、批准、只读、隔离、原Run/claim/portable恢复/反例保持，完整逐声明原body及精确执行名称在mapping.json。feature-removed只分类这些已撤机制，五个mixed case全部当前business selectors仍作为必过契约，不整case免测；原登记字段及其它目标不改。

两份registry direct case及三份历史mixed case追加：

- classic-sdk-stale-workspace-read-identity：退休每次普通bound read/readProjection与Git元数据重新对账；保原绑定历史只读可见无写、实际mutation一次namespace比较拒绝CAS、原旧namespace Run/新YAML不污染、显式新namespace portable恢复与原Actions/批准/revision。合并Spec state-recovery三selector，未丢另一文件业务。
- workflow-simplification-t17-classic-checkpoint：退休重复projection marker的创建/更新；保language用户设置只导入一次、原revision、一次YAML发布、Runtime-owned edits拒绝且原Run不污染。
- issue-239-bounded-runtime：退休Classic重复marker文件要求；保稳定权威YAML只读一次、mtime/字节/revision不变且不创建marker。其他Native读取预算目标完整保留。
- issue-432-cli-work-budget：退休Classic重复marker物理文件；保多字段批量一次读取、原单字段输出、未知/重复字段拒绝，稳定YAML单次读取无写。
- issue-487-workspace-binding-screenshot：退休SDK跨worktree自动搜索/路由；改显式linked projectRoot，保真实工作树状态/选择/恢复continuation、原主工作树无选择污染、复制change本地隔离及另原Hook runtime目标不变。

其余原exact selectors存在，不追加。shared stale identity case同时保Spec轴3项state-recovery：原Build replaced-git不变，read/readProjection允许原历史读取且原数据不写，实际CAS继续拒绝。完整旧state-recovery正文也冻结在tests.json。两条旧Win32 symlink分别为权威YAML路径替换与Archive候选路径替换；前者把旧marker替换面的业务转到真实YAML，未宣称本机执行通过。
