# .comet.yaml 字段说明

规范路径：`comet-classic/reference/comet-yaml-fields.md`

本文件说明每个 change 的 `.comet.yaml` 状态字段，文件位于 `<classic-change-dir>/`。该目录按 `comet-classic/reference/classic-layout.md` 解析。需要了解字段时再查阅，不随 Skill 一次性加载。项目默认配置位于 `.comet/config.yaml`，全局默认配置位于 `~/.comet/config.yaml`；项目配置优先于全局配置。

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
bound_branch: null
verify_mode: light
verify_result: pending
verify_failures: 0
verification_report: null
branch_status: pending
created_at: 2026-05-26
verified_at: null
archive_confirmation: null
archived: false
```

## 必需字段

| 字段                   | 含义                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow`             | `full`、`hotfix` 或 `tweak`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `language`             | 产物语言，仅支持 `en` 或 `zh-CN`。`comet init` 根据安装范围，将 `classic.language` 写入项目或全局 `.comet/config.yaml`。创建 change 时，优先采用项目配置，没有时再用全局配置，并把选定值保存到 `.comet.yaml`，作为 OpenSpec / Superpowers 产物的主要语言                                                                                                                                                                                                                                                                                                      |
| `phase`                | 当前阶段：`open`、`design`、`build`、`verify`、`archive`（init 统一设为 `open`，guard 负责过渡）                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `design_doc`           | 关联的 Superpowers Design Doc 路径，可为空                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `plan`                 | 关联的 Superpowers Plan 路径，可为空                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `base_ref`             | init 时记录的 git commit SHA，用于 scale 评估。无 plan 时作为改动文件数统计基准                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `build_mode`           | 已选择的执行方式，可为空。`autonomous`：由用户明确选择后，自主规划和执行，可以把范围明确的一组任务交给子代理，不强制加载外部规划/执行 Skill；`subagent-driven-development`：主会话协调，后台子代理负责实现；`executing-plans`：主会话按计划顺序执行；`direct`：默认仅适用于 hotfix/tweak，full 需要 direct_override。写计划前确认执行方式，不根据模型名称擅自替换旧配置                                                                                                                                                                                       |
| `build_pause`          | build 阶段的暂停状态。`null` 表示未暂停；`plan-ready` 表示计划已生成，且用户明确要求计划后暂停（包括切换模型）。收到继续指令后沿用有效计划与配置，不因这个暂停状态而重新询问配置                                                                                                                                                                                                                                                                                                                                                                              |
| `subagent_dispatch`    | `null` 或 `confirmed`。`confirmed` 记录用户已选择 `subagent-driven-development`；该模式只有带此记录时才能离开 build 阶段                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `tdd_mode`             | `tdd` 或 `direct`。full workflow 离开 build 阶段前必须已选择。`tdd` 强制每个任务先写失败测试再实现；`direct` 不强制逐任务 TDD，但仍需相关测试与 bug 回归证据。hotfix/tweak 默认 `direct`                                                                                                                                                                                                                                                                                                                                                                      |
| `review_mode`          | `off`、`standard` 或 `thorough`。full workflow 离开 build 阶段前必须已选择；hotfix/tweak 默认 `off`                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `isolation`            | `current`、`branch` 或 `worktree`。full change 在 Open 阶段创建产物前决定工作区；hotfix/tweak 在入口决策点后也可如实使用三种模式，不得在未创建分支时虚构为 `branch`                                                                                                                                                                                                                                                                                                                                                                                           |
| `bound_branch`         | 工作区绑定的分支，可为空。首次设置 `isolation: current` / `branch` / `worktree` 或执行入口检查时，记录命令所在目录的当前 Git 分支。worktree 模式下，必须在对应工作区内执行 set/check/guard，否则会绑定或比较错误的分支。切换 `isolation` 模式会重新绑定当前分支；重复设置同一模式则保留原绑定。后续 `comet state select` / `comet state check` 会核对当前分支是否与绑定一致；不一致时 select 拒绝执行，检查返回 `BLOCKED`。此时按决策点协议，请用户选择切回绑定分支，或在明确确认后运行 `comet state rebind <change-name>`。清空 `isolation` 时也会清空本字段 |
| `verify_mode`          | `light` 或 `full`，可为空                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `auto_transition`      | `true` 或 `false`。只控制阶段守卫推进 phase 后是否自动调用下一个 skill；`false` 时由 `comet-state next` 输出 `manual`，暂停下一 skill 调用，但不阻止 phase 字段更新                                                                                                                                                                                                                                                                                                                                                                                           |
| `verify_result`        | `pending`、`pass` 或 `fail`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `verify_failures`      | 由 Runtime 维护的连续验证失败次数。`verify-fail` 自动加一；`verify-pass` 或 `archive-reopen` 重置为 `0`。已经失败 `3` 次后，如果再次失败，必须请用户决定如何继续                                                                                                                                                                                                                                                                                                                                                                                              |
| `verification_report`  | 验证报告文件路径，verify 通过前必须指向已存在文件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `branch_status`        | `pending` 或 `handled`。Verify 阶段保持 pending；归档时的 handled 只用于兼容旧状态，不能据此认定用户已授权 local/push/pr 或相应操作已成功。实际授权由 state delivery 保存；Runtime 确认所选本地或远端操作全部完成后，才清除当前 change 的选择                                                                                                                                                                                                                                                                                                                 |
| `created_at`           | change 创建日期（init 时自动写入），格式 `YYYY-MM-DD`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `verified_at`          | 验证通过时间，可为空                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `archive_confirmation` | `null`、`pending` 或 `confirmed`。verify-pass 进入 archive 时设为 pending。用户明确选择归档，并选定仅本地保存、push 或 PR 的交付方式后，通过 archive-confirm 设为 confirmed。archive-reopen 会清除确认，并使旧 delivery 授权失效；重新验证后需要再次确认                                                                                                                                                                                                                                                                                                      |
| `archived`             | change 是否已归档                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## 可选字段

| 字段              | 含义                                                                             |
| ----------------- | -------------------------------------------------------------------------------- |
| `direct_override` | `true`/`false`。full workflow 如需使用 `build_mode: direct`，必须显式设为 `true` |

## 状态更新规则

- `build → verify` 前，`isolation` 必须是 `current`、`branch` 或 `worktree`
- `build → verify` 前，`build_mode` 必须已选择
- `build_mode: subagent-driven-development` 必须同时有 `subagent_dispatch: confirmed`
- full 采用 `build_mode: autonomous` 时，design_doc、plan、isolation、tdd_mode 仍须有效，并须选择 standard/thorough 独立审查；这不等于开启 direct_override，也不改变已有执行方式
- full workflow 离开 build 阶段前 `tdd_mode` 必须已选择为 `tdd` 或 `direct`
- full workflow 离开 build 阶段前 `review_mode` 必须已选择为 `off`、`standard` 或 `thorough`
- `build_mode: direct` 默认只允许 `hotfix` / `tweak`；full workflow 需要 `direct_override: true`
- `build_pause` 不是执行方式，不得写入 `build_mode`
- 协调与交付记录通过 `state checkpoint` / `state delivery` 管理，不把其中的 JSON 字段直接写入 .comet.yaml；读取和恢复方式见 context-recovery.md 与 comet-archive
- 这些约束同时存在于 `comet-guard.mjs build --apply` 和 `comet-state.mjs transition <name> build-complete`
- `archive_confirmation` 由 Runtime 管理，只能通过 `verify-pass`、`archive-confirm` 和 `archive-reopen` 状态机事件更新，不能用 `set` 直接伪造确认；`archived` 事件和实际归档命令都要求它的值为 `confirmed`
- `preset-escalate` 事件：仅允许 `hotfix`/`tweak` workflow 在 `phase: build` 时调用。它会原子更新 `workflow`/`classic_profile` 为 `full`，将 `phase` 回退到 `design`，并清空 `design_doc`，以满足 comet-design 的入口要求。这是预设升级到 full 的唯一合法方式。直接 `set phase design` 会被状态机拒绝；classic_profile 由 Runtime 管理，不能通过 `set classic_profile` 手动更改
