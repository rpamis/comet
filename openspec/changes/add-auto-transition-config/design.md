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
