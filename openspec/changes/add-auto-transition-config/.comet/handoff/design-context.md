# Comet Design Handoff

- Change: add-auto-transition-config
- Phase: design
- Mode: compact
- Context hash: 70e8ae830fe5864fd0935a395988d54dac4eb1eda2de4d4f085e3e1f0305de43

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/add-auto-transition-config/proposal.md

- Source: openspec/changes/add-auto-transition-config/proposal.md
- Lines: 1-31
- SHA256: 6917af597ec076f199c2698990f58a0f56cd9c8d54bc3cf3b1ee092088b02309

```md
## Why

当前 Comet 技能默认在非阻塞节点自动流转到下一阶段。多数场景下这能减少用户操作，但也让希望逐步手动确认、手动输入下一条指令的用户缺少项目级控制。

本变更为每个 Change 增加 `auto_transition` 状态参数，让项目可以通过 `openspec/comet.yaml` 设置默认流转策略，并让各阶段 Skill 在自动流转前按当前 Change 状态决定是继续还是提示用户手动执行下一步。

## What Changes

- 新增 Change 级 `.comet.yaml` 字段 `auto_transition`，创建新 Change 时从项目级 `openspec/comet.yaml` 读取，缺省为 `true`。
- 更新 Comet 状态脚本与 YAML 校验，识别并校验 `auto_transition: true|false`。
- 更新中文 Comet Skill，在每个自动流转节点读取当前 Change 的 `.comet.yaml`，仅当 `auto_transition: true` 时自动进入下一 Skill。
- 自动流转关闭时仍必须先完成阶段 guard/state transition；`auto_transition` 只控制是否继续调用下一 Skill，不控制状态机是否推进。
- 当 `auto_transition: false` 时，Skill 不自动流转，并输出明确提示，告诉用户下一步可以执行哪个 Skill。
- 增加脚本测试覆盖默认值、项目级配置读取、状态校验和自动流转提示规则。

## Capabilities

### New Capabilities

- `comet-auto-transition`: 定义 Comet Change 如何记录、读取并执行自动流转开关。

### Modified Capabilities

无。

## Impact

- 影响 `assets/skills/comet/scripts/` 下的状态机和 YAML 校验脚本。
- 影响 `assets/skills-zh/` 下包含自动流转说明的 Comet Skill 文档。
- 影响 `test/ts/comet-scripts.test.ts` 中的状态文件与脚本测试。
- 新增项目级配置文件 `openspec/comet.yaml` 的读取约定，但不存在时保持现有自动流转行为。
```

## openspec/changes/add-auto-transition-config/design.md

- Source: openspec/changes/add-auto-transition-config/design.md
- Lines: 1-79
- SHA256: d7f4c6253fcdf4118f33f030704a2a948d5425c7c6591adaa22f083326aaadf0

```md
## Context

Comet 当前通过 `.comet.yaml` 记录每个 Change 的 workflow、phase、build/verify 状态等字段。阶段 Skill 在满足退出条件后会在文档中要求继续调用下一阶段 Skill；这种自动流转默认适合连续执行，但缺少项目级开关。

项目希望在 `openspec/comet.yaml` 中配置默认策略，并将该策略复制到每个新 Change 的 `.comet.yaml`。后续运行时只读取 Change 自己的状态文件，确保每个 Change 可独立覆盖，且归档、恢复、跨上下文继续时行为稳定。

## Goals / Non-Goals

**Goals:**

- 新 Change 初始化时写入 `auto_transition: true|false`。
- 项目级配置读取路径固定为 `openspec/comet.yaml`。
- `openspec/comet.yaml` 不存在、缺少 `auto_transition` 或值无法识别时，默认写入 `true`。
- 状态脚本和 YAML 校验接受并验证 `auto_transition`。
- 中文 Comet Skill 在自动流转节点先读取 `.comet.yaml`，再决定继续调用下一 Skill 或打印手动提示。
- 保持现有默认行为：未配置项目级开关时仍自动流转。

**Non-Goals:**

- 不新增新的 CLI 子命令或外部依赖。
- 不改变 phase transition 本身的状态机约束。
- 不将英文 Skill 作为本次第一阶段修改对象；按项目规范先更新 `assets/skills-zh/`。
- 不改变已有 `build_command` / `verify_command` 的配置读取路径。

## Decisions

### 1. 初始化时复制项目级默认值到 Change 状态

采用 `comet-state.sh init` 读取 `openspec/comet.yaml` 的 top-level `auto_transition`。识别值仅为 `true` 和 `false`；缺失、空值或非法值写入 `true`。

替代方案：

- 每次 Skill 直接读取 `openspec/comet.yaml`：会导致一个项目级配置变更影响已存在 Change，恢复时不够可追踪。
- 仅依赖 agent 记忆：跨上下文和归档后不可验证。

选择复制到 `.comet.yaml`，因为它符合现有状态机以 Change 为核心的设计。

### 2. 将 `auto_transition` 纳入状态 schema

`comet-state.sh set` 允许设置 `auto_transition`，并校验为 `true|false`。`comet-yaml-validate.sh` 将它加入 required fields 与 known keys。这样新字段能被 guard preflight 和测试稳定覆盖。

替代方案是把它设为 optional field，但这会让旧状态和新状态混杂，Skill 读取时必须反复处理缺失字段。由于新 Change 初始化会写入该字段，把它作为 required field 更清晰。

### 3. Skill 自动流转用统一读取模式

中文 Skill 的自动流转段统一增加以下语义：

- 先完成本阶段既有退出条件和 `"$COMET_BASH" "$COMET_GUARD" <change-name> <phase> --apply`，确保 `.comet.yaml` 已更新到下一 phase。
- 再运行 `"$COMET_BASH" "$COMET_STATE" get <change-name> auto_transition`。
- 值为 `false` 时，不调用下一 Skill，输出明确提示，例如「请运行 `/comet-design` 继续」。
- 其他值按默认自动流转处理。

这样 `auto_transition` 只影响 agent 是否继续调用下一 Skill，不影响状态机的准确推进。即使旧 Change 缺少字段，Skill 仍可按默认自动流转继续；脚本 validator 负责新 Change 的严格性。

测试需要显式覆盖 `"$COMET_BASH" "$COMET_STATE" get <change-name> auto_transition`，确认初始化后的值可被 Skill 使用的同一读取路径返回。

### 4. 覆盖所有中文自动流转节点

需要更新常规流程的 `comet-open`、`comet-design`、`comet-build`、`comet-verify`，以及 preset 的 `comet-hotfix`、`comet-tweak`。`comet-archive` 是终点，只需保持完成提示，不需要下一 Skill。

## Risks / Trade-offs

- [Risk] Skill 文档重复出现读取片段，后续可能不一致。 → 使用同一段固定模板，测试用文本扫描覆盖关键提示。
- [Risk] 项目级 YAML 解析只支持 top-level 简单字段。 → 与现有脚本风格一致，需求也只要求读取 `auto_transition` 参数。
- [Risk] 手动模式被误解为“不推进 phase”。 → Skill 文档明确要求 guard/state transition 先执行，`auto_transition: false` 只停止下一 Skill 调用。
- [Risk] 将字段设为 required 可能让旧 Change 校验告警或失败。 → 初始化新 Change 会写入字段；旧 Change 的 Skill 读取仍按默认 true 处理。若需要迁移旧 Change，可通过 `comet-state set <name> auto_transition true` 修复。

## Migration Plan

1. 更新脚本，让新 Change 自动写入 `auto_transition`。
2. 更新中文 Skill 自动流转段。
3. 更新测试覆盖初始化、校验、字段设置和 Skill 文案。
4. 为当前 Change 的 `.comet.yaml` 写入 `auto_transition: true`，使其符合新 schema。

Rollback 时移除新字段校验、初始化读取和 Skill 文案即可；已有 `.comet.yaml` 中的额外字段在旧 validator 中会被视为未知字段告警。

## Open Questions

无。
```

## openspec/changes/add-auto-transition-config/tasks.md

- Source: openspec/changes/add-auto-transition-config/tasks.md
- Lines: 1-23
- SHA256: 3280aa5b202b76a8df5ed8424fcc6cc299527be77b3aab5aed833f030998022e

```md
## 1. 状态脚本与 schema

- [ ] 1.1 在 `comet-state.sh init` 中读取 `openspec/comet.yaml` 的 `auto_transition`，并在新 Change `.comet.yaml` 写入默认值
- [ ] 1.2 在 `comet-state.sh set` 中允许并校验 `auto_transition: true|false`
- [ ] 1.3 在 `comet-yaml-validate.sh` 中将 `auto_transition` 纳入 required fields、known keys 和 enum 校验

## 2. 中文 Skill 自动流转

- [ ] 2.1 更新 `assets/skills-zh/comet-open`、`comet-design`、`comet-build`、`comet-verify` 的自动流转说明，按 `.comet.yaml` 决定继续或提示
- [ ] 2.2 更新 `assets/skills-zh/comet-hotfix`、`comet-tweak` 的连续执行说明，按 `.comet.yaml` 控制 preset 内部自动推进
- [ ] 2.3 更新 `assets/skills-zh/comet` 字段说明和阶段流转原则，记录 `auto_transition` 的默认值与读取规则

## 3. 测试覆盖

- [ ] 3.1 增加 `comet-state.sh init` 默认 `true`、项目配置 `false`、缺失字段和非法值回退 `true` 的测试
- [ ] 3.2 增加 `comet-state.sh get <change> auto_transition`、`comet-state.sh set` 与 `comet-yaml-validate.sh` 对 `auto_transition` 的校验测试
- [ ] 3.3 增加中文 Skill 文案扫描测试，覆盖手动模式提示和下一 Skill 名称

## 4. 验证与收尾

- [ ] 4.1 运行 `npx vitest run test/ts/comet-scripts.test.ts` 验证脚本测试
- [ ] 4.2 运行必要的 Skill 文案测试或全量 `npx vitest run`，确认文档扫描无回归
- [ ] 4.3 用户验收：向用户说明 `auto_transition: false` 时的手动流转效果，用户确认符合预期后才能标记完成
```

## openspec/changes/add-auto-transition-config/specs/comet-auto-transition/spec.md

- Source: openspec/changes/add-auto-transition-config/specs/comet-auto-transition/spec.md
- Lines: 1-85
- SHA256: 818b435fe0d2720029a64231fc4f0f5f28e4116a231c4b95659e05dc08f04bbc

[TRUNCATED]

```md
## ADDED Requirements

### Requirement: Change initializes auto transition setting

Comet MUST write an `auto_transition` boolean field into every newly initialized Change `.comet.yaml`.

#### Scenario: Project config enables manual flow

- **WHEN** `openspec/comet.yaml` exists with top-level `auto_transition: false`
- **THEN** `comet-state.sh init <change> <workflow>` MUST write `auto_transition: false` into `openspec/changes/<change>/.comet.yaml`

#### Scenario: Project config is absent

- **WHEN** `openspec/comet.yaml` does not exist
- **THEN** `comet-state.sh init <change> <workflow>` MUST write `auto_transition: true` into the Change `.comet.yaml`

#### Scenario: Project config omits the setting

- **WHEN** `openspec/comet.yaml` exists without top-level `auto_transition`
- **THEN** `comet-state.sh init <change> <workflow>` MUST write `auto_transition: true` into the Change `.comet.yaml`

#### Scenario: Project config has an invalid setting

- **WHEN** `openspec/comet.yaml` contains top-level `auto_transition` with a value other than `true` or `false`
- **THEN** `comet-state.sh init <change> <workflow>` MUST write `auto_transition: true` into the Change `.comet.yaml`

### Requirement: Change state validates auto transition

Comet MUST treat `auto_transition` as a known Change state field whose valid values are `true` and `false`.

#### Scenario: State field can be set

- **WHEN** a user runs `comet-state.sh set <change> auto_transition false`
- **THEN** the script MUST update `.comet.yaml` to `auto_transition: false`

#### Scenario: Invalid state value is rejected

- **WHEN** a user runs `comet-state.sh set <change> auto_transition maybe`
- **THEN** the script MUST fail with an enum validation error

#### Scenario: YAML validation includes the field

- **WHEN** `comet-yaml-validate.sh <change>` validates a Change `.comet.yaml`
- **THEN** it MUST require `auto_transition`
- **AND** it MUST reject values other than `true` or `false`

### Requirement: Skills respect manual transition mode

Comet Skill instructions MUST consult the current Change `.comet.yaml` before executing any non-terminal automatic transition.

#### Scenario: State advances before manual pause

- **WHEN** a Skill reaches an automatic transition node and `.comet.yaml` has `auto_transition: false`
- **THEN** the Skill MUST first run the required phase guard with `--apply`
- **AND** `.comet.yaml` MUST record the next phase before the Skill stops for manual continuation

#### Scenario: Auto transition is enabled

- **WHEN** a Skill reaches an automatic transition node and `.comet.yaml` has `auto_transition: true`
- **THEN** the Skill MUST continue to the documented next Skill after required guards and blocking user decisions are complete

#### Scenario: Auto transition is disabled

- **WHEN** a Skill reaches an automatic transition node and `.comet.yaml` has `auto_transition: false`
- **THEN** the Skill MUST NOT invoke the next Skill automatically
- **AND** it MUST print a clear prompt naming the next Skill the user may run manually

#### Scenario: Existing Change lacks the field

- **WHEN** a Skill reaches an automatic transition node and `.comet.yaml` lacks `auto_transition`
- **THEN** the Skill MUST behave as if `auto_transition: true`

### Requirement: Auto transition state is readable by Skill command

Comet MUST expose `auto_transition` through the existing `comet-state.sh get` command so Skill instructions can use a tested read path.

#### Scenario: Reading initialized auto transition value

- **WHEN** a Change `.comet.yaml` contains `auto_transition: false`
- **THEN** `comet-state.sh get <change> auto_transition` MUST print `false`
```

Full source: openspec/changes/add-auto-transition-config/specs/comet-auto-transition/spec.md
