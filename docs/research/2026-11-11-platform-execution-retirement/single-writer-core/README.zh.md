# 普通工作流单写入方迁移

授权来源：report:2026-11-11-single-writer-workspaces。用户明确普通 Native/Classic 与工作区由父 Agent 串行提交；Child 仅在自己的 worktree 执行并返回结果，不并写父 Run。

本轮没有新公共 CLI、项目配置、锁队列、writer 监管、hash 或身份 ledger。SDK FileRuntimeStore 内部 singleWriter:true 跳过原写锁；revision 校验、原子 checkpoint 发布、历史分区事务、原 claim 与批准保持。默认通用 SDK 保原提交锁，Creator 的 creator.evaluate 与公开 cancel 存在真实异步同 Run 提交路线。

实际证据：coverage/single-writer-core-neighbor-green.json 单次 175 pass / 0 fail / 3 原平台 symlink skip；另 classic-progress 真实归档 commit/dirty-file 反例定向 1 pass（同组另2 Core pass，1早期 fixture 错误已随后新1 pass修正）。tsc --noEmit 两次通过。没有 build、Eval、模型、容器或真实平台 Hook。父 Agent负责统一build。

Temp owned-cancel-probe.test.ts 为普通确定性 SDK Promise executor，故意让 singleWriter:true 被两个 controller 并发使用，cancel 已返回 cancelled 后完成回报覆盖成 completed/action succeeded；这是不支持的使用方式，不能宣称单写模式具备多 writer 原子 CAS。原始JSON/脚本在 Temp/comet-single-writer-core-20261111。默认通用SDK对同 revision 两并发提交仍只一胜（新测试真实通过）。未执行真实 Creator Eval。

原7测试文件151声明全文已保存在 tests.json 和 mapping.json。分类：{"split-mechanism-and-business":14,"retained-business":125,"retired-mechanism":10,"fixture-adapted-business":2}。普通锁专属10声明（owner8含2行each + Classic2）单列退休；混合业务逐条保留实际目标，未在本批运行的原 progress 其他目标明确标记 not-executed-in-this-batch。没有新增skip。

调用边界：Native/Classic实际Run、Classic Archive receipt/preparation/workspace baseline显式singleWriter；Native/Classic固定应用按已有manifest.base一次分类传入persistent/coordinated store；Creator和standalone通用应用及原始runtime dispatch保持默认。只读observation不提交因此不加锁。显式旧builtin数据导入也传singleWriter；显式通用应用存储维护/导入保原默认SDK提交合同。

删除普通外层锁：Classic state/projection/identity/change ownership；fixed应用 workspace/application scope locks；owner partitions lock、writing/stable token及读代次重试。保Classic真实状态事务恢复和nested mutation上下文、真实Archive WAL、owner active/history硬链接/同字节恢复、固定包/scope/批准业务。旧锁残留仅作为历史文件保留，不获取、不修理、不要求token；workspace-applications.json旧目录名称保留兼容业务成员清单，已无锁行为。

registry-two-payload.json是两个有效原ID的CAS追加草案，未改Root registry；所有旧record字段不变，历史链仅追加supersededBy，四artifact摘要均按现有校验器生成。其余四个有效历史ID只引用未改名的progress目标，无需追加。不能把这些结果当作整个仓库全绿或模型压缩次数改善证据。
