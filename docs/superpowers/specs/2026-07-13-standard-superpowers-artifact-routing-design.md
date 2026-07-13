# 标准 Superpowers 产物首次写入路由设计

**状态：** 已确认
**日期：** 2026-07-13
**范围：** Comet Classic `before_write` hook 对 `docs/superpowers/` 产物的归属判定

## 背景

Comet Classic 的写入 hook 会在文件真正创建前判断目标路径属于哪个 active change。现有实现优先匹配 `.comet.yaml` 已记录的 `design_doc`、`plan` 和 `verification_report`，未命中时再根据文件名中的 change 名和 `design`、`plan`、`verify` 等后缀推断归属。

这个模型无法处理标准 Superpowers plan 的首次创建：

- 官方 Superpowers `writing-plans` 将计划保存为 `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`，不要求 `-plan` 后缀。
- Comet `/comet-build` 遵循同一命名约定，并要求计划文件写入成功后才把实际路径记录到 `.comet.yaml`。
- `before_write` hook 运行时，`plan` 因而仍为 `null`；标准文件名又不一定包含完整 change 名或 `-plan` 后缀，写入会被错误归类为 unmatched artifact。

设计文档使用 `YYYY-MM-DD-<topic>-design.md` 只是 Superpowers brainstorming 的特定约定，不能据此推导所有 Superpowers 产物都必须带类型后缀。Comet 必须兼容 Superpowers 的公开产物约定，而不是要求生成器采用 Comet 私有命名。

## 目标

1. 允许 Superpowers 标准命名的 Design Doc、Implementation Plan 和 Comet verification report 首次写入。
2. 保留多 active change 环境下的显式归属和安全失败行为。
3. 已记录 artifact 路径后继续使用精确匹配，避免同一 change 静默产生第二份错误产物。
4. 不改变 Superpowers 原始 Skill，不要求 `-plan` 等额外文件名后缀，也不要求 Skill 预登记尚不存在的文件。
5. hook 只做判定，不在写入前隐式修改 `.comet.yaml`。

## 非目标

- 不放宽整个 `docs/superpowers/` 目录的写权限。
- 不从普通源码路径、分支名或模糊关键词猜测 change。
- 不解析或依赖不同平台 Write/Edit 工具不稳定的内容字段。
- 不改变已记录路径、明确 change-name 文件名和 OpenSpec change 目录的既有路由优先级。
- 不允许一个已记录 plan 的 change 再通过“首次写入”规则创建另一份未登记 plan。

## 核心模型：Artifact Slo

hook 将标准目录映射为一个有明确生命周期的 artifact slot：

| 标准目录                        | 状态字段              | 首次写入阶段 |
| ------------------------------- | --------------------- | ------------ |
| `docs/superpowers/specs/*.md`   | `design_doc`          | `design`     |
| `docs/superpowers/plans/*.md`   | `plan`                | `build`      |
| `docs/superpowers/reports/*.md` | `verification_report` | `verify`     |

“首次写入”不是任意未匹配文件的通用放行，而是同时满足以下条件的窄例外：

1. 目标是上述标准目录直属的 Markdown 文件。
2. 当前 governing change 正处于该 slot 对应阶段。
3. 对应状态字段为 `null`。
4. governing change 可以由有效 current selection 或单 active change 无歧义地确定。

## 路由顺序

hook 按以下顺序解析写入：

1. 保留 `.comet/`、`.superpowers/`、`.claude/` 和根目录 Markdown 等全局白名单。
2. `openspec/changes/<name>/...` 继续由路径中的 change 名直接管辖。
3. 对 `docs/superpowers/`，先在所有 active changes 中匹配已记录的 `design_doc`、`plan`、`verification_report` 精确路径。
4. 未命中记录路径时，保留现有 change-name 边界和 artifact 后缀匹配，兼容已有文件和显式命名。
5. 仍未命中时，尝试标准 artifact slot 首次写入：
   - current selection 有效：只检查被选择的 active change。
   - current selection 陈旧或损坏：安全阻塞并输出选择失效原因。
   - 没有 selection 且只有一个 active change：沿用单 change 免选择体验。
   - 没有 selection 且存在多个 active changes：安全阻塞并要求运行 `comet state select <change-name>`。
6. 选出的 change 必须满足目标目录对应的阶段和空 slot 条件；否则继续按 unmatched artifact 阻塞。

已记录路径和明确文件名匹配仍高于 selection。这保持了现有“路径本身已能明确归属时不借当前选择改写归属”的行为。

## 首次写入后的行为

Skill 保持现有顺序：Superpowers 先生成文件，随后 `/comet-design`、`/comet-build` 或 `/comet-verify` 将实际路径写入 `.comet.yaml`。

如果模型在文件写入后、状态登记前中断，对应 slot 仍为空。恢复后的 Write 或 Edit 会再次走同一个窄化的首次写入规则，因此可以完成或修复该标准产物。路径成功登记后：

- 精确记录路径继续允许；
- 同目录下第二个未登记文件不再满足空 slot 条件，必须阻塞；
- hook 不自动选择、重写或清理 artifact 路径。

## 错误处理

阻塞信息应区分以下原因，并提供可执行下一步：

- 多 active change 未选择：提示 `comet state select <change-name>`。
- current selection 陈旧或损坏：提示重新选择。
- 阶段不匹配：显示当前阶段和该 artifact 的预期阶段。
- slot 已被占用：显示已记录路径，提示使用该文件或显式修正 `.comet.yaml`。
- 非标准目录或非 Markdown 文件：维持 unmatched Superpowers artifact 提示。

错误提示不得再把添加 `-plan` 后缀描述为标准或首选修复方式。

## 代码边界

- 修改 `domains/comet-classic/classic-hook-guard.ts`：增加标准 artifact slot 分类和 selection-aware 首次写入解析。
- 修改 `test/domains/comet-classic/classic-hook-guard.test.ts`：覆盖 source 级路由和选择状态。
- 修改 `test/domains/comet-classic/comet-scripts.test.ts`：覆盖生成 runtime 的用户可见行为。
- 运行 `pnpm build:classic-runtime` 同步 `assets/skills/comet/scripts/comet-runtime.mjs`。
- 不修改 Superpowers 原始 Skill；Comet Build Skill 的标准计划命名和“写入后记录路径”顺序保持不变。
- 根据 master 版本和现有未发布版本条目，把最终用户可见修复写入 `CHANGELOG.md`；普通回归测试不单列 `Tests`。

## 测试策略

按 TDD 逐个增加回归：

1. 单 active build、`plan: null`、标准 `YYYY-MM-DD-<feature-name>.md`：允许。
2. 多 active changes、有效选择 build change、该 change `plan: null`：允许标准 plan。
3. 多 active changes、无选择：阻塞并提示选择。
4. current selection 陈旧：阻塞且不回退到其他 change。
5. 选择的 change 处于 open、design、verify 或 archive：首次 plan 写入阻塞。
6. `plan` 已记录后，精确路径允许，第二个未登记 plan 阻塞。
7. design 阶段空 `design_doc` 和 verify 阶段空 `verification_report` 使用相同 slot 规则。
8. 非标准 `docs/superpowers/` 子目录继续阻塞。
9. 现有 recorded-path、change-name 匹配、OpenSpec 路由和全局白名单测试保持通过。
10. 生成 runtime 后运行 Classic hook 专项测试、`comet-scripts.test.ts`、格式、lint、build 和全量测试。

## 验收标准

1. `/comet-build` 使用原样 Superpowers 标准计划名时，不再因 `plan: null` 被 hook 拦截。
2. 用户无需添加 `-plan` 后缀，也无需在文件创建前预登记路径。
3. 多 active change 时，未匹配标准产物只归属于显式选择的合法 change；无选择或选择无效时安全阻塞。
4. artifact slot 已登记后，hook 不允许第二个未登记产物借首次写入规则通过。
5. TypeScript 源码与发布 runtime 行为一致，相关回归和全量质量检查通过。
