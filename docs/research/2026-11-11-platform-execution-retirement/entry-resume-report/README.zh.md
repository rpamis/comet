# Entry 的 Native 恢复与报告保存

当前两项原测试均已实际失败：具名 Run 诊断把 JSON 命令数组当作连续文本检查；四阶段恢复在保存旧验证报告时因用户级 Runtime 根目录不存在而失败。原完整测试、报告写入源码及两项 RED 均已冻结。

第一项保留原标题及原 Run/Action 恢复、项目和 Runtime 字节不变断言，仅改为检查公开 Doctor JSON 的完整六项 commandArgs，并要求退出码 0。对应 manual-recovery-named-native-checkpoint 的 selector 不变，无需追加迁移节点。第二项正文完全不变，保留四阶段 permanent Native entry 路由与合法批准；辅助函数的 Agent/User 明确为 SIMULATED，仍调用真实业务协议，未伪造阶段。其余测试声明逐正文不变，见 mapping.json/tests.json。

最薄源码提案只在已有报告需要保存原文的写入分支调用现有 ensureWorkspaceRuntimeRoot，然后使用原受保护目录和写入逻辑。内容相同的提前返回不初始化 Runtime；不创建 Native 锁目录，不改只读入口。源码由根 Agent 合入，本子 Agent 只直接修改上述测试断言。

临时测试通过 owning-module mock 仅替换这一个报告模块，第一项采用当前 JSON 断言，两项实际 GREEN；其余 32 项未选中。该证据是源代码/API 边界，不代表生成 bundle 或真实平台 Hook 已验。根 Agent 合入后，仓库原文件同两个 selector 再次实际通过 2/0（其余 32 项未选中），见 repository-two-green.json；这是源码边界，构建由根 Agent 统一执行。未运行全量、build、Eval。
