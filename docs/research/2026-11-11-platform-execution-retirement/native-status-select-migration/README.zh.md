# Native 状态与明确工作区选择测试迁移

只修改 native-portable-status.test.ts 与 native-select-command.test.ts。原两个文件全文与 8 个声明冻结在 tests.json；迁移后仍 9 个展开项，没有 skip/drop。3 个混合声明拆机制与业务，其余 5 个声明正文不变，逐条见 mapping.json。

## 实际验证

原精确三项 three-before.json：0 passed / 3 failed。前两个仅失败于已删除 localExecution DTO；第三个旧 mock 调用 onSelectedRoot 期待自动切换工作区，但当前 select 明确操作传入 root，真实读取 primary 缺少 change 文档而拒绝。

迁移后三项 three-after.json：3 passed / 0 failed；最终两文件 files-after.json：9 passed / 0 failed / 0 skipped。两个测试文件 Prettier 检查通过。

没有修改产品源码、生成 Runtime 或 registry，没有 build、安装、真实 Hook、模型或容器 Eval。未把三项通过声明为整个 Native module 通过。

## 合同与证据边界

- 状态仍返回原 schema、Shape phase、完整初始 loop、continuation；list 仍可见；实际 select 仍返回相同 continuation。读取前后整个临时 root 快照相同，已删除本地执行目录不会被 status/list 创建。
- 旧 malformed execution overlay 属明确 SIMULATED 旧文件，不启动进程或伪造批准。status 不读取它、不暴露 localExecution、不把 made-up 状态变成可用执行；正式 phase/loop/continuation 原样，原文件和项目字节不变。
- select unit fixture 保留原 mock 投影，只证明完整数据转发和 root 选择，不声称 mock phase=build 是真实业务推进。显式传原 change 所在 root，返回整个原投影和选中记录；错误 root 拒绝且 primary selection 缺失、原 config 不变。两个临时 root 并非真实 Git linked worktree，因此不冒称真实 linked-worktree 迁移验证。

当前 owning source：native-portable-storage.ts 的 readNativePortableRuntime 只读取业务 state；native-portable-status.ts:376 消费 state/children/Supervisor，类型已无 localExecution。native-select-command.ts 的 executionCwd 固定为 projectRoot，inspectDiscoveredNativeStatus 只接 projectRoot/name；native-status-discovery.ts:257 的 discoverSources 从明确 root 构造单一来源，不恢复 other-root 扫描。native-selection.ts 在写 selection 前验证该 root 下真实 owner/Run 或正式文档，因此 mock 不会授权错误 root。

## Registry 审计

按 scripts/lint/workflow-regressions.mjs 的实际 schema，扫描 incremental cases 与 frozen issues[].cases，套用 historicalTestMigrations 后沿 supersededBy 到当前末端。portable-status 有 3 个有效历史关联：native-285-archive-context-bounds、native-314-status-bounds、native-314-32-child-scale，全部选中本批未改正文的 compact/paging/32-child 声明，且最终整文件实际通过。select 无关联。本次三个改名声明受影响有效 selector 为 0，不需 append/CAS，原 ID/来源/链未改。

四 artifact registry/tests/mapping/patch 全部独立保存，摘要在 artifact-index.json。patch 以本批修改前完整文件为基线，未混入其他 Agent 差异。
