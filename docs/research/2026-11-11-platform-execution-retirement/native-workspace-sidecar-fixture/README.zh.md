# Native 历史工作区 sidecar 测试目录

原 14 项最小执行结果为 8 通过、6 失败。五项在内部 writeNativeWorkspaceIdentity 的原子写入中缺少 native Runtime 根目录；一项是测试直接写旧 v1 workspace.json 时父目录不存在。完整原文和原结果均已冻结。

当前生产调用已逐项核对：native-sdk-create.ts:181 把 workspaceBinding 写入真实 Run 的 state.workspace，不写 workspace.json；native-workspace.ts 没有从领域 index.ts 导出。writeNativeWorkspaceIdentity 的唯一生产调用在 native-root-move.ts:142-145，仅已有 previousWorkspace 时更新旧 sidecar。显式旧文档导入在 native-portable-migration-runtime.ts:83 读取它，保留原 isolation、branch、target 和 finish。setNativeWorkspaceFinish 和 migrateLegacyNativeWorkspaceIdentity 当前只有定义及测试，没有生产调用。因此不能将这六项归为新流程的 cold writer 缺陷，也没有为产品添加初始化。Entry 报告保存是另一实际生产写入缺口，已单独处理。

测试原 beforeEach 创建的 docs/comet/changes/example/runtime 是旧位置。现在仅保留文档目录，并明确标注 SIMULATED 历史 sidecar 测试，在 nativeWorkspaceFile 返回的实际位置创建父目录。finishing 案例稍后执行 Git init，会改变工作区 namespace，所以在该动作后按重新解析的 paths 准备同一测试数据目录。没有创建锁目录。

14 个原标题及所有 expect 断言逐 AST 完全不变，原文和当前正文见 mapping.json。当前与历史 registry 无有效 target 指向本文件，不需要追加迁移节点。临时整文件实际 14/0，随后仓库原文件整组也实际 14/0（repository-14-green.json），均通过当前源码；Windows 的 symlink 案例原本直接 return，本次未改且不冒称已验证 Windows symlink。

修改仅在测试 fixture，产品源码保持冻结。未执行 build、全量、Eval 或真实平台 Hook。
