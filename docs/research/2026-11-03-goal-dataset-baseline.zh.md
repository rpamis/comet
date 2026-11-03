# 内置数据集的 Goal 对照组

来源：用户要求在 WorkBuddy 与 SkillsBench 的 Native 评测中增加 Goal 对照。当前分支 `052`，比较基线 `07bd301bb4c4bf65a21b2b47727c577816b7b970`。本次是新增执行方式，不声明关闭既有用户故障，不新增用户问题 badcase。

## 已实现

- Dashboard 增加“数据集执行方式”：Comet Native / Claude Code Goal。CLI 使用 `--dataset-treatment native|goal`，默认仍为 Native。选择、下载、预览不启动模型。
- Goal 使用 Claude Code 原生非交互 `/goal`，短条件指向完整原题文件；不安装 Comet CLI、Skill 或 Runtime，不注入 Native 调用要求。原生 Goal 不可用时明确失败，不把普通提示词执行当作 Goal。
- Goal 只支持 Claude Code；评估模型固定为主模型，记录在执行身份中。保持同一原题、领域 Skills 条件、模拟用户政策及外部评分规则。两组默认都不设总时限，仍支持显式预算和停止。
- 两组分别启动，按同题与重复编号配对。评分范围绑定数据集内容、原题内容和评分适配器摘要；不同模型、Agent、端点或预算仅并列查看。比较数值成绩及整题成功，Native 流程检查单独保留。窄屏在表格内部横向滚动。
- 这比较的是两套完整执行方式；Native 组没有额外开启 Goal，不能把差异解释为保持 Goal 不变后的纯增量。

使用方式见 [操作文档](../operations/NATIVE-BENCHMARKS-ZH.md)。Goal 接口依据 [Claude Code 官方文档](https://code.claude.com/docs/en/goal) 核对。

## 实际验证

- 修改前新增断言失败：Goal 计划仍返回 Native；API 不认识新字段；Goal 环境仍安装 Comet；交互配置不支持 Goal。修改后这些定向检查通过。
- Python 数据集、执行身份及 fixture 检查：128 passed、1 skipped；跳过原因为 Windows 文件符号链接不可用。另有 5 项循环探针通过，包含原生 Goal 调用、长原题文件、不支持 Goal 时失败，以及 Native 原有完成判定。
- 5 个相关 TypeScript 文件运行得到 66 passed、1 failed；失败为子进程停止测试并行执行时未及时取得 child 身份，并伴随临时目录占用。未调整产品或测试时限；该测试隔离复查通过。新增 Goal 配对、评分器变化及模型不一致反例单独通过，预览文件最终 12/12 通过。
- 扩大的历史存储检查为 44 passed、2 failed；两项失败均为 Windows `fs.symlink` 的 EPERM，原测试及断言保留，没有跳过或降低要求。这两项仍缺本机通过证据。
- Playwright：1280 和 390 宽度的下载、缓存及 Goal 选择检查通过；Goal 与 Native 成绩比较检查通过，覆盖分数列、参照选择与窄屏溢出。新增比较测试初版遗漏显式选择临时参照，已修正 fixture；随后发现新增列的窄屏溢出，增加表格内部滚动后通过。
- 完整构建成功，最终 TypeScript 编译检查通过；Dashboard 随浏览器检查重新构建。lint 为 0 errors、8 项既有 warnings；架构检查、Ruff、受影响文件 Prettier 与 `git diff --check` 通过。
- 通过公开 `node bin/comet.js eval --collect`，对原 WorkBuddy 和 SkillsBench 单题各收集 Native / Goal，共 4 次静态计划；两组原题和评分器身份一致。计划保存在 `.comet/eval/launches/2026-11-03-goal-baseline/static-collect/`，没有启动 Docker 或模型。

## 边界

本轮没有真实 Goal 模型评测、容器场景、重评分或仓库全量测试。真实代理服务与模型是否完整支持 Goal、评估器费用是否被完整返回，仍待用户另行授权后验证；缺失费用不按零计算。不复用先前执行器中途变更或补评分的单题记录作为正式对照。

版本仍为 `0.5.4`，已高于 `origin/master` 的 `0.5.3` 一个修订版本；Goal 能力合并到现有 benchmark Changelog 条目。无关修改保留，website 引用未改变；未提交或推送。

后续取得的真实模型证据见 [Goal 单题运行记录](2026-11-03-goal-workbuddy-smoke.zh.md)：WorkBuddy 原题 1.0、3/3 隐藏测试通过。上面的“未执行”描述对应接入实现当时的验证范围；SkillsBench Goal 和批量评测仍未执行。
