# .comet.yaml 字段说明

规范路径：`comet/reference/comet-yaml-fields.md`

本文件是 `openspec/changes/<name>/` 下每个 change 级 `.comet.yaml` 状态文件的字段参考。按需查阅，不随 skill 一次性加载。项目级默认配置只放在 `.comet/config.yaml`。

## 示例

```yaml
workflow: full
language: zh-CN
phase: build
design_doc: docs/superpowers/specs/YYYY-MM-DD-topic-design.md
plan: docs/superpowers/plans/YYYY-MM-DD-feature.md
base_ref: a1b2c3d4e5f6...
build_mode: subagent-driven-development
build_pause: null
subagent_dispatch: confirmed
tdd_mode: tdd
review_mode: standard
auto_transition: true
isolation: branch
verify_mode: light
verify_result: pending
verification_report: null
branch_status: pending
created_at: 2026-05-26
verified_at: null
archived: false
```

## 必需字段

| 字段 | 含义 |
|------|------|
| `workflow` | `full`、`hotfix` 或 `tweak` |
| `language` | 产物语言，仅支持 `en` 或 `zh-CN`。由 `comet init` 的初始化语言写入 `.comet/config.yaml`，创建 change 时快照到 `.comet.yaml`，用于约束 OpenSpec / Superpowers 产物主语言 |
| `phase` | 当前阶段：`open`、`design`、`build`、`verify`、`archive`（init 统一设为 `open`，guard 负责过渡） |
| `design_doc` | 关联的 Superpowers Design Doc 路径，可为空 |
| `plan` | 关联的 Superpowers Plan 路径，可为空 |
| `base_ref` | init 时记录的 git commit SHA，用于 scale 评估。无 plan 时作为改动文件数统计基准 |
| `build_mode` | 已选择的执行方式，可为空。取值：`subagent-driven-development`（隔离后台 subagent 逐任务实现并审查）、`executing-plans`（主会话按计划顺序执行）、`direct`（主会话直接编码，默认仅 hotfix/tweak 允许，full workflow 需 `direct_override: true`） |
| `build_pause` | build 阶段内部暂停点。`null` 表示无暂停，`plan-ready` 表示 plan 已生成，用户选择切换模型后暂停 |
| `subagent_dispatch` | `null` 或 `confirmed`。仅当已确认当前平台存在真实后台 subagent / Task / multi-agent 调度能力时，`build_mode: subagent-driven-development` 才能写入并用于离开 build 阶段 |
| `tdd_mode` | `tdd` 或 `direct`。full workflow 离开 build 阶段前必须已选择。`tdd` 强制每个任务先写失败测试再实现；`direct` 不强制 TDD。hotfix/tweak 默认 `direct` |
| `review_mode` | `off`、`standard` 或 `thorough`。full workflow 离开 build 阶段前必须已选择；hotfix/tweak 默认 `off` |
| `isolation` | `branch` 或 `worktree`，工作区隔离方式。full 初始化可为 `null`，但只允许持续到 `/comet-build` Step 3 前；hotfix/tweak 默认 `branch` |
| `verify_mode` | `light` 或 `full`，可为空 |
| `auto_transition` | `true` 或 `false`。只控制阶段守卫推进 phase 后是否自动调用下一个 skill；`false` 时由 `comet-state next` 输出 `manual`，暂停下一 skill 调用，但不阻止 phase 字段更新 |
| `verify_result` | `pending`、`pass` 或 `fail` |
| `verification_report` | 验证报告文件路径，verify 通过前必须指向已存在文件 |
| `branch_status` | `pending` 或 `handled`，分支处理完成后设为 `handled` |
| `created_at` | change 创建日期（init 时自动写入），格式 `YYYY-MM-DD` |
| `verified_at` | 验证通过时间，可为空 |
| `archived` | change 是否已归档 |

## 可选字段

| 字段 | 含义 |
|------|------|
| `direct_override` | `true`/`false`。full workflow 如需使用 `build_mode: direct`，必须显式设为 `true` |

## 状态机硬约束

- `build → verify` 前，`isolation` 必须是 `branch` 或 `worktree`
- `build → verify` 前，`build_mode` 必须已选择
- `build_mode: subagent-driven-development` 必须同时有 `subagent_dispatch: confirmed`
- full workflow 离开 build 阶段前 `tdd_mode` 必须已选择为 `tdd` 或 `direct`
- full workflow 离开 build 阶段前 `review_mode` 必须已选择为 `off`、`standard` 或 `thorough`
- `build_mode: direct` 默认只允许 `hotfix` / `tweak`；full workflow 需要 `direct_override: true`
- `build_pause` 不是执行方式，不得写入 `build_mode`
- 这些约束同时存在于 `comet-guard.mjs build --apply` 和 `comet-state.mjs transition <name> build-complete`
- `preset-escalate` 事件：仅允许 `hotfix`/`tweak` workflow 在 `phase: build` 时调用，原子地把 `workflow`/`classic_profile` 置为 `full`、`phase` 回退到 `design`、清空 `design_doc`（满足 comet-design 入口要求）。这是预设升级到 full 的唯一合法通道——直接 `set phase design` 会被状态机硬拦截，`set classic_profile` 属于 machine-owned 字段不可手动设置
