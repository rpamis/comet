# Native 顺序 CAS 与真实 selection 路径

原两个 selector 实际 RED。CAS 的原两个同时请求均成功；这是用户已撤下的同工作区多写入者排他合同。当前测试按原 left/right 数据及同一 expectedRevision 顺序调用，保留恰好一个 fulfilled、一个 rejected、revision=2，新增第二次精确 NativeChangeRevisionConflictError 和原 YAML 字节不变。

原 selection 测试把用户级 Native Runtime 目录换成 junction，当前选择成功。该目录已不是 selection 的写入目标；实际目标为项目 .comet/current-change.json（native-selection.ts:42-44 → workflow-contract/current-selection.ts:30-31）。测试改为实际 .comet 父目录 junction，保留拒绝和两个 selection 文件不存在，新增原需求状态字节及整个外部目录列表不变。真实探针已证现有受保护配置读取拒绝该目标，outsideFiles=[]，没有外写；第一次 Temp 失败只是错误文本从旧 must not 改为当前 crosses，未修改任何产品代码或新增防御。

完整原两文件、所有直接声明的原文与当前正文映射、原 RED 和当前 GREEN 均保留。只改这两个声明，其他测试正文不变。当前与历史 registry 均无有效 target 指向这两文件或旧名称，不需追加迁移链。两个并发/旧外围 Runtime 前置条件的退休和其余业务保留分别记录于 mapping.json，未整文件退休。

临时执行包含顺序 CAS 加完整 selection 三项，实际 4/0；随后仓库原两文件同选择器也实际 4/0，其余 50 项未选中，见 repository-four-green.json。产品源码和生成物保持冻结，未执行 build、全量、Eval 或实际平台 Hook。
