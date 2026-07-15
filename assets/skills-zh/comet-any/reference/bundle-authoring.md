# Bundle Authoring 参考

`comet creator` 是 `/comet-any` 的普通 CLI 表面，背后复用 `comet bundle` 的确定性后端。普通用户不需要记忆 Bundle 子命令；Skill Creator 负责把用户确认的 Workflow Contract 写成 plan，再调用 CLI 维护状态。

## Workflow Contract 输入

新的 `plan.json` 使用 `workflow` 作为主输入：

```json
{
  "goal": "基于 /comet-classic 的五阶段定制，要求组件库和白盒审查。",
  "skillCreatorIntent": "customize-comet",
  "workflow": {
    "kind": "comet-five-phase-overlay",
    "name": "team-comet",
    "goal": "要求组件库和白盒审查。",
    "nodes": {
      "execute": {
        "requiredSkillCalls": [
          {
            "skill": "elementui",
            "reason": "Use project component library during direct implementation."
          }
        ]
      },
      "subagent-execute": {
        "requiredSkillCalls": [
          {
            "skill": "elementui",
            "scope": "handoff"
          }
        ]
      },
      "review": {
        "requiredSkillCalls": [
          {
            "skill": "whitebox-code-standard",
            "scope": "review"
          }
        ]
      }
    }
  },
  "engineMode": "deterministic",
  "runnerMode": "standalone"
}
```

字段约定：

- `workflow.kind`: `comet-five-phase-overlay` 或 `workflow-kernel`。
- `workflow.nodes`: 按 Node id 覆盖或增强 Workflow Node。
- `implementation`: 替换 Node implementation。只能用于允许 override 的 Node。
- `requiredSkillCalls`: Required Skill Call，要求 Node 内必须调用 Skill。
- `augmentations`: 增强 Node，不替换主 implementation。每个新增 binding 或 schema 都必须声明 enforcement：`guarded`、`handoff-guarded`、`evidence-only` 或 `advisory`。
- `satisfies`: producer override 满足的 Output Schema id。
- `outputSchemas`: 高级 `workflow-kernel` 可以声明自定义 Output Schema。Output Schema 必须挂到具体 Workflow Node 才算生效；只定义在 `workflow.outputSchemas` 里不会触发 guard、eval 或 readiness。
- `customNodes[].responsibility`: 自定义 Node 必须声明它在 Agent workflow 中承担的职责。
- `customNodes[].requiredSkillCalls`: 自定义 Node 可直接声明必须调用的 Skill，生成脚本会按 evidence 阻断。

## 内置 Comet Nodes

`comet-five-phase-overlay` 内置这些 Workflow Node：

- `comet-five-phase-overlay` 的主状态只来自 `openspec/changes/<name>/.comet.yaml`；没有 active change 或多个 active changes 时必须阻塞并请用户选择。
- 不得创建 `.comet/runs/<workflow>/state.json` 作为 Comet overlay 主状态；overlay 脚本只能读取并推进 `.comet.yaml`，其他文件只能作为 draft、eval 或 publish evidence。
- `open`: control，保留 Comet intake 和 `.comet.yaml` 初始化。
- `design`: producer，可 override，但必须满足 `comet.design.v1`。
- `plan`: producer，可 override，但必须满足 `comet.plan.v1`。
- `execute`: control，可 require / augment，例如要求 `elementui`。
- `subagent-execute`: Handoff，可要求子代理使用 `elementui` 并回传 evidence。
- `review`: Guardrail，可要求 `whitebox-code-standard`。
- `verify`: control，保留验证和分支收尾。
- `archive`: control，保留 OpenSpec archive 和 delta sync。

自定义 `workflow-kernel` Node 示例：

```json
{
  "id": "delegate-notes",
  "label": "Delegate Notes",
  "kind": "handoff",
  "responsibility": "Delegate release note drafting and require returned evidence.",
  "implementation": {
    "skill": "handoff-coordinator",
    "scope": "handoff"
  },
  "requiredSkillCalls": [
    {
      "skill": "release-notes",
      "scope": "handoff"
    }
  ],
  "operations": ["require", "augment"],
  "outputSchemas": ["release.notes.v1"],
  "guardrails": [
    {
      "id": "handoff-returned",
      "label": "Handoff returned evidence",
      "validation": "semantic"
    }
  ]
}
```

## 生成物

Factory 必须生成：

- entry `SKILL.md`
- 每个 Workflow Node 对应的 internal Skill
- `reference/workflow-protocol.json`
- `reference/resolved-skills.json`
- `reference/decision-points.md`
- `reference/recovery.md`
- `reference/authoring-lanes.json`
- `reference/skill-review.md`
- `scripts/workflow-state.mjs`
- `scripts/workflow-guard.mjs`
- `scripts/workflow-handoff.mjs`
- `scripts/comet-plan.mjs`
- `scripts/comet-check.mjs`
- `scripts/comet-hook-guard.mjs`
- `comet/eval.yaml`

三个 `workflow-*.mjs` 按 workflow 契约创作；三个 `comet-*.mjs` 由 factory 确定性生成（plan 别名、必需文件检查、hook guard），同样读取 `workflow-protocol.json`。

`workflow-protocol.json` 是 runtime、eval、review、publish readiness 的共同事实源。

## CLI 生命周期

常用 Creator 命令：

```bash
comet creator guide --project . --json
comet creator candidates --json
comet creator propose <name> --file <plan.json> --json
comet creator init <name> --file <plan.json> --confirmed-proposal --json
comet creator resolve <name> --candidate <query> --source <root-or-hash> --json
comet creator generate <name> --json
comet bundle compile <name> --platform <id> --json
comet eval <generated-skill>/comet/eval.yaml --quick --html
comet eval <generated-skill>/comet/eval.yaml --full --html
comet publish review <name> --platform <reference-platform> --json
comet publish approve <name> --reviewer <reviewer> --json
comet publish run <name> --platform <reference-platform> --json
comet publish distribute <name> --platform <id> --scope project --preview --json
```

`<generated-skill>` 是 compile 后生成 Skill 的目录。eval 结果必须登记为当前 draft hash 的 eval evidence；readiness 只读取该 hash 对应的证据，旧 hash 证据只能保留作审计，不能推进 ready。

## Readiness

readiness 必须检查：

- resolved Skills 无 missing / ambiguous。
- proposal 已确认。
- `workflow-protocol.json` 可加载。
- control Node 没有普通 override。
- producer override 满足 Output Schema。
- 每个新增 binding 或 schema 都有 `guarded`、`handoff-guarded`、`evidence-only` 或 `advisory` enforcement。
- 当前 draft hash 的 eval evidence 已存在且未过期。
- 人工 review 已批准当前 hash。
- capability gap 和 executable disclosure 已展示。

非 JSON 输出也必须向用户展示 `Readiness:`、`Blockers:`、`Warnings:`、`Evidence:`。
