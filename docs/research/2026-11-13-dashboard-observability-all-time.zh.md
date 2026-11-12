# Dashboard 可观测的所有时间范围

来源：`report:2026-11-13-dashboard-observability-all-time`。

## 行为与根因

本次报告包含两个独立行为：首次进入可观测时应默认“所有”，并能在短期范围与“所有”之间切换；自定义日期不应只能选择最近七天。

修改前的 053 把默认状态设为 `7d`，范围解析器也把 `all` 回退为七天。菜单没有“所有”，日期选择器和应用按钮又各自限制七天。后端在没有 `from`、`to` 时已支持读取全部留存记录，因此本次无需增加后端协议或改变存储保留期限。

“所有”表示当前可获取的全部留存记录，不恢复已删除的历史。实时状态快照仍不参与时间筛选。既有一小时、一天、三天、七天与自定义范围继续可用；选择的范围在当前页面会话和各统计来源间共享。

## 复现与验证

- 修改前当前 053：新增两个范围单测均失败，`all` 实际解析为 `2026-11-06T12:00:00.000Z` 至 `2026-11-13T12:00:00.000Z`；无完整样本的聚合快照被错误标记为不可用。
- `origin/master` 的 0.5.2 源码：以同一固定时间调用公开前端范围解析函数，得到相同的七天范围。未运行 0.5.2 的完整浏览器安装包。
- 修改前当前 Dashboard 构建：Playwright 在默认“时间范围：所有”的断言失败，界面仍默认最近七天。
- 修改后：五个时间范围单测通过；同一个 Playwright 场景通过，覆盖默认所有、一小时和七天筛选、切回所有、个人记忆与项目知识共享选择、保留原有短时自定义测试、额外选择十四至十三天前的自定义范围，以及 390px 下拉与日期弹窗。

命令：

```sh
pnpm exec vitest run test/domains/dashboard/observability-time-range.test.ts
pnpm exec playwright test --config test/domains/dashboard/playwright.config.ts --grep 'filters observability metrics and traces with one shared time range' --workers 1
```

Playwright 的服务入口会先构建当前 Dashboard。这里的模型数据为明确标注的演示数据，没有启动新的模型 Eval。浏览器交互证据与前端范围解析、后端无边界解析的单测分别证明对应边界，不代替数据保留策略或真实模型验证。
