---
name: comet-native
description: 使用 Comet 自有 Native change、状态检查与自动推进，为强编码模型提供轻量但可恢复的需求到归档流程。
---

# Comet Native

先理解，再行动。Native 保存需求、完整目标规格、状态和证据；实现过程由模型自主判断，不照搬固定方法。

## 开始或恢复

先运行 Native `status` 和 `show`，再读取 `comet.config.yaml`、`change.yaml`、brief、拟议完整规格、canonical 规格、仓库实现、项目规则和相关测试。能从环境得到的事实不要询问用户。

若没有 change，先把用户目标归纳成 lowercase kebab-case 名称，再创建 Native change。只使用配置指定的 `<artifact-root>/comet/`，不扫描或修改其他工作流目录。

命令与 runtime 定位见 [命令参考](reference/commands.md)，产物格式见 [产物参考](reference/artifacts.md)，中断与恢复见 [恢复参考](reference/recovery.md)。自带 runtime 位于 [scripts/comet-native-runtime.mjs](scripts/comet-native-runtime.mjs)。

## 决策协议

维护“决策前沿”：只关注仍会显著改变范围、用户可见行为、兼容性、风险或不可逆性的未知决定。

有这类决定时：

1. 一次只问最重要的一个问题，等待用户回答后再继续。
2. 同时给出推荐答案、简短理由，以及各选择会带来的实际影响。
3. 决策的依赖按顺序解决；不要把一组问题一次抛给用户。
4. 未得到必要决定前停在 Shape，不开始实现。

普通事实、代码现状、依赖约束和测试方式应先自行检查。只有决定权属于用户；不要让用户替你完成仓库调查。

## Shape

确认 Outcome、Scope、Non-goals、Acceptance examples、Constraints and invariants、Decisions、Open questions 和 Verification expectations。阻塞问题在 brief 中标记为 `- [blocking]`。

理解达成一致后：

- 更新 `brief.md`，让它足以约束实现和验收；
- 若长期行为发生变化，在 `specs/<capability>/spec.md` 写完整目标规格，不写只描述增量的 patch；
- 删除长期 capability 时使用 `comet native spec remove <change-name> <capability>`；create/replace 和 canonical base hash 由 runtime 推断并冻结；
- 只有高影响决定刚由用户确认时才记录显式确认；仍未解决时保留 `[blocking]` 并停下。

随后提交可验证摘要并运行：

```text
comet native next <change-name> --summary <摘要>
```

如果摘要包含用户刚刚确认的高影响决定，追加 `--confirmed`。否则不加；`approval` 由 runtime 记录，不能手工修改。

## Build

选择满足 brief 与拟议规格的最简单可靠方案。实现方式、是否落盘计划、测试粒度、调试方法和审查强度都由模型根据风险自主决定。

不要为了遵守流程制造额外文档或步骤。若实现中发现需求或规格漂移，先更新 Native 产物。出现新的高影响用户决定时，把它标成 `[blocking]`，一次只问一个；用户回答后更新 Decisions、移除阻塞项，继续实现，并在离开 Build 时传 `--confirmed`。

完成后提供真实产物引用；没有代码变化时给出明确理由。然后运行：

```text
comet native next <change-name> --summary <摘要> --artifact <项目内路径> [--confirmed]
```

## Verify

根据 brief 的 Acceptance examples、完整目标规格和风险运行适当验证。记录实际命令、结果、跳过项、规格一致性、已知限制和结论，不把未运行的检查写成通过。

验证通过或失败都写入 `verification.md`，再运行：

```text
comet native next <change-name> --summary <摘要> --result pass|fail --report verification.md
```

失败会回到 Build；先修复证据指出的问题，再重新验证。只有用户需要接受明确偏差时才暂停询问。

## Archive

只有状态进入 Archive 且 Verify 为 pass 时归档：

```text
comet native archive <change-name>
```

归档会在 hash 一致时更新 canonical 规格，并把 change 移到日期前缀的 archive 目录。遇到 canonical 冲突时先重读并改写完整目标规格，再用 `comet native spec rebase <change-name> --summary <摘要>` 刷新基线并受控回到 Build 重新实现、确认和验证；不覆盖并发变化。未完成事务按恢复参考处理。

## 不变规则

- 不直接编辑 `phase`、`approval`、`spec_changes`、Run state、trajectory、锁或 transaction journal。
- 不跳过阶段检查；每个阶段用 `comet native next` 或自带 runtime 的等价命令推进。
- 不调用外部 Skill；Native 主流程只依赖 Comet 自带 runtime。
- 不记录隐藏推理过程，只保存摘要、产物引用、命令结果、hash、状态变化和时间戳。
- 没有需要用户决定的阻塞点时持续推进；有阻塞点时只问一个最高价值问题并等待回答。
