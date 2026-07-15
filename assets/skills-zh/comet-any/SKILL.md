---
name: comet-any
description: "仅在用户明确调用 /comet-any，或明确要求定制 /comet-classic 五阶段流程、创建或升级由 Comet Creator 管理的 workflow Skill 时使用；不要用于一般 Skill 的编写、整理或评审。"
---

# Comet Any - Skill Creator

`/comet-any` 是 Comet 的 Skill 创建向导。用户只需要描述想要的工作流；本 Skill 负责读取真实 Skill、提出方案、等待确认、生成可验证的 Comet-native Skill Bundle，并通过内部 CLI 完成 eval、review、publish readiness 和安装预览。

普通用户第一层只看到三种起点：

- `基于 /comet-classic 的五阶段定制`：覆盖 `open / design / build / verify / archive` 五阶段的 Skill 编排，但不修改 `/comet-classic` 永久入口本身。
- `创建全新 workflow Skill`：从目标和候选 Skills 生成新的 `workflow-kernel`。
- `整理已有 Skill`：读取已有 Skill，补齐 Workflow Node、Skill Binding、Output Schema、Guardrail、Handoff、eval 和 readiness。

后端 Bundle、Factory、composition 仍是内部审计词；不要把它们作为普通用户的第一屏概念。

## 核心模型

所有路径都必须编译到同一种 Workflow Contract：

- `Workflow Node`：流程中的可恢复节点，例如 `open`、`design`、`plan`、`execute`、`subagent-execute`、`review`、`verify`、`archive`。
- `Node Responsibility`：该 Node 在 Agent workflow 中承担的职责，用来解释它为什么存在、需要产出什么、能否替换。
- `Skill Binding`：某个 Node 的实现 Skill 或辅助 Skill。
- `Required Skill Call`：要求 Node 内必须调用某个 Skill，不替换 Node implementation。例如 `execute` 和 `subagent-execute` 必须调用 `elementui`，`review` 必须调用 `whitebox-code-standard`。
- `Output Schema`：Node 必须产出的文件、状态或 evidence。Output Schema 必须挂到具体 Workflow Node 才算生效；只定义在 `workflow.outputSchemas` 里不会触发 guard、eval 或 readiness。脚本、eval、readiness 只依赖挂到 Node 的 Output Schema，不依赖 Skill 名称。
- `Guardrail`：阻断或放行 Node 推进的检查。
- `Handoff`：子代理或跨 Node 交接时必须带回的 evidence。
- `workflow-protocol.json`：生成包的唯一运行事实源，kind 为 `comet-five-phase-overlay` 或 `workflow-kernel`。

## 受保护边界

`comet-five-phase-overlay` 保留 Comet Classic 五阶段主流程和 `.comet.yaml` 状态语义。普通模式下：

- `comet-five-phase-overlay` 的主状态只来自 `openspec/changes/<name>/.comet.yaml`；没有 active change 或多个 active changes 时必须阻塞并请用户选择。
- 不得创建 `.comet/runs/<workflow>/state.json` 作为 Comet overlay 主状态。Bundle 草稿、eval evidence 和 publish readiness 可以有自己的证据文件，但不能替代 `.comet.yaml`。
- `control` Node 不允许 override：`open`、`execute`、`verify`、`archive`。
- `producer` Node 可以 override：`design`、`plan`，但必须满足对应 Output Schema。
- `handoff` 和 `guardrail` Node 可以 require / augment。
- 用户坚持替换 control Node 时，改走高级 `workflow-kernel`，并要求重新声明 state、Output Schema 和 Guardrail。
- 所有 Node 都必须用 responsibility 说明职责，不使用内部坐标作为用户理解流程的方式。

## 工作步骤

1. 恢复现有状态：先运行 `comet creator guide --project . --json`，展示恢复摘要和下一步。
2. 读取项目偏好：读取 `.comet/skill-preferences.yaml`，用 `comet creator candidates --json` 发现真实本地 Skill，再用 `comet skill show <name> --json` 读取候选的真实内容与 hash。不得只按名字推测能力。
3. 生成方案：把用户目标表达为 Workflow Nodes、Skill Bindings、Output Schemas、Guardrails、Handoffs 和 Evidence。
4. 展示确认页：说明每个 Node 的职责、绑定 Skill、Required Skill Call、Output Schema、可执行披露和 readiness 影响。确认页必须为每个新增 binding 或 schema 显示 enforcement：`guarded`、`handoff-guarded`、`evidence-only` 或 `advisory`。
5. 等待用户确认：未确认前不得写 Bundle draft；存在 missing / ambiguous Skill 时必须暂停。
6. 初始化后端状态：确认后调用 `comet creator init <name> --file <plan.json> --confirmed-proposal --json`。
7. 运行创作管线并生成 Bundle：先运行 `comet creator authoring-plan <name> --depth quick|full --json` 取得 lane DAG。按 DAG 派发 lane——wave1（`script`、`reference`、`pause-points`）在支持子代理的平台可并发（否则按依赖顺序内联），wave2（`workflow-entry`、`skill-core`）在 script 契约之后，`skill-review` 作为汇聚 barrier。每个 lane 的产出用 `comet creator authoring-record <name> --lane <id> --file <out.json> --json` 记录（经 schema 校验；BLOCKED/NEEDS_CONTEXT 会被拒绝）。随后运行 `comet creator generate <name> --json`：把记录的内容叶子草稿（entry/node SKILL.md、decision-points、recovery）合并进包，而确定性脊梁（protocol/scripts/manifest）保持模板化，并渲染真实审查证据。产出 entry Skill、Node Skills、`reference/workflow-protocol.json`、六个 scripts、rules、hooks 与 `comet/eval.yaml`。
8. 验证：展示 quick/full eval 工作量，运行或记录当前 draft hash 的 eval evidence；失败、skip 或证据 hash 过期时不得进入 ready。
9. Review / readiness：读取 `comet publish review <name> --platform <reference-platform> --json`，展示 `Readiness:`、`Blockers:`、`Warnings:`、`Evidence:`。
10. Publish / install preview：人工批准后才能 publish；安装前必须先运行 preview，并展示 `No files were written`。

## 方案示例

组件库和白盒审查场景应生成类似 plan：

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
  }
}
```

## 硬性规则

- 必须先展示方案确认页，再生成。
- 确认页必须为每个新增 binding 或 schema 显示 enforcement：`guarded`、`handoff-guarded`、`evidence-only` 或 `advisory`。
- Required Skill Call 不替换 Node implementation。
- producer override 必须声明 `satisfies` 的 Output Schema。
- Output Schema 必须挂到具体 Workflow Node 才算生效；只定义在 `workflow.outputSchemas` 里不会触发 guard、eval 或 readiness。
- control Node 普通模式不得 override。
- eval、review、publish readiness 必须读取同一份 `workflow-protocol.json`。
- readiness blockers 必须阻止 publish：缺少当前 draft hash 的 eval evidence、人工 approval、required capability 或 executable disclosure 任一项都不能进入 ready。
- 子代理 Handoff 必须要求子代理加载 Required Skill Call 并回传 evidence。
- 脚本只读取 protocol 和 state，不把 Skill 名称当成校验依据。
- 安装前必须询问用户，不得自动安装。

## 参考资料

- `comet-any/reference/authoring-protocol.json`
- `comet-any/reference/authored-zone-example.md`
- `comet-any/reference/bundle-authoring.md`
- `comet-any/reference/authoring-subagents.md`
- `comet-any/reference/eval-provider.md`
