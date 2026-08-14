# Comet 项目规范术语研究

日期：2026-08-14

## 研究问题

Comet 计划主动发现项目与团队的编码习惯，把能够确定性判断的内容接入 compiler、linter、静态分析、测试、构建或 CI，把仍需上下文判断的内容按需提供给 Agent。这个能力应采用哪些行业主流术语，才能避免用“团队契约”描述一组实际属于规范发现、规则治理和自动检查的对象？

## 结论摘要

建议采用下面这套分层术语：

| 层级         | 推荐中文                  | 保留英文                                         | 用途                                                                  |
| ------------ | ------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| 能力总称     | **项目规范**              | **Project Standards**                            | Comet 面向一个仓库发现、评估、采用和维护规范的完整能力                |
| 治理方法     | **策略即代码**            | **Policy as Code**                               | 把已采用且能够确定性判断的规则版本化，并交给自动化系统执行            |
| 单项要求     | **规则**                  | **Rule**                                         | 用户与团队能够直接理解的一项要求                                      |
| 规则集合     | **规则集**                | **Ruleset**                                      | 按语言、框架、目录或风险类别组织的一组规则                            |
| 自动执行结果 | **检查**                  | **Check**                                        | compiler、linter、静态分析、测试、构建或 CI 对规则的具体执行          |
| 非确定性内容 | **指导项**                | **Guideline**                                    | 需要设计判断、项目语境或人工 Review，不能可靠转换为自动检查的规范内容 |
| Agent 载荷   | **仓库指令 / Agent 指令** | **Repository Instructions / Agent Instructions** | 将相关指导项选择后交给 Agent 的短指令                                 |

因此，Comet 的用户可见能力宜称为 **“项目规范（Project Standards）”**，其中的单项要求可以称为 **“规则（Rule）”**。术语选择不意味着 Comet 需要建立机器规则数据库；当前 Shape 支持可选的 `.comet/rules/*.md`，同时复用仓库已有的 Agent 指令和原生检查配置。

“策略即代码（Policy as Code）”适合描述确定性规则的治理与执行方法，但不适合作为整个功能或单条记录的名字：OPA 将 policy 定义为一组 rules，Semgrep 也把 policy 定义为规则集合及其命中后的工作流动作，而不是一条独立编码规范。[OPA Philosophy](https://www.openpolicyagent.org/docs/philosophy)、[Semgrep Code glossary](https://semgrep.dev/docs/semgrep-code/glossary)

## 一、官方术语证据

### 1. Google：Style Guide 与 Coding Standards 表示项目编码规范

Google 将 style guide 定义为项目如何编写代码的一组 conventions，并明确指出其覆盖范围不只是格式，还包括“不要使用全局变量”“不要使用异常”等编码约束。[Google Style Guides](https://google.github.io/styleguide/)

Google Java Style Guide 进一步称自身为 Java 源码 **coding standards** 的完整定义，重点描述普遍适用的 hard-and-fast rules，并有意避免无法由人或工具明确执行的建议。这说明行业中的 Style Guide/Coding Standards 并不只表示排版风格，也可以覆盖可强制的工程规则。[Google Java Style Guide](https://google.github.io/styleguide/javaguide.html)

Google C++ Style Guide 同样说明，“Style”也称 readability，实际涵盖远多于源码格式的 conventions，并把具体条目称为 individual rules 或 style rules。[Google C++ Style Guide](https://google.github.io/styleguide/cppguide)

Google Code Review 指南规定：涉及 style 时，style guide 是权威来源；不在 guide 中的纯样式意见只是个人偏好。这支持 Comet 区分“项目已采用规范”和“从代码频率或个人意见推断出的候选”，后者不能自动覆盖前者。[The Standard of Code Review](https://google.github.io/eng-practices/review/reviewer/standard.html)

**对 Comet 的含义**：能力总称应使用“项目规范（Project Standards）”。当范围明确只覆盖源码编写时，可以在界面或文档中使用“编码规范（Coding Standards）”；由于 Comet 还计划覆盖测试、构建、CI 和仓库结构，“项目规范”作为总称更准确。

### 2. ESLint：Rule 是最小验证单元，Plugin 用于复用扩展

ESLint 把 rule 称为核心构件：一条 rule 验证代码是否满足某个 expectation，并决定不满足时如何处理。规则可以带选项，并可通过配置设置为 `off`、`warn` 或 `error`。[ESLint Core Concepts](https://eslint.org/docs/latest/use/core-concepts/)、[Configure Rules](https://eslint.org/docs/latest/use/configure/rules)

ESLint 官方还明确列出创建 custom rule 的典型理由：执行公司或项目最佳实践、防止已发生的缺陷再次出现、确保遵守 style guide；多个 custom rules 可以由 plugin 打包、共享和复用。[ESLint Custom Rule Tutorial](https://eslint.org/docs/latest/extend/custom-rule-tutorial)

ESLint 对 `warn` 和 `error` 的解释也提供了成熟的渐进执行语义：`warn` 用于尚不阻塞、可能有误报或准备以后提升为 `error` 的规则，`error` 通过非零退出码在 CI、pre-commit 和 PR 合并中执行阻塞。[Configure Rules](https://eslint.org/docs/latest/use/configure/rules)

**对 Comet 的含义**：面向用户的单项要求可以叫“规则（Rule）”，生态扩展宜沿用“插件（Plugin）”或具体工具的原生名称；确定性要求直接落到 ESLint rule、plugin/config 和对应检查，不需要再创建一份 Comet 规则记录。

### 3. Semgrep：Rule 产生 Finding，Ruleset 组织相关规则，Policy 决定运行与处置

Semgrep 将 rule 定义为模式规范：引擎依据它匹配代码并生成 finding，规则使用 YAML 表达。[Semgrep Rule-writing glossary](https://semgrep.dev/docs/writing-rules/glossary)

Semgrep 的官方术语进一步区分：

- **Ruleset** 是按语言、OWASP 类别或框架组织的相关 rules；
- **Policy** 是实际运行的规则集合，以及规则产生 finding 后采取的 workflow actions；
- **Finding** 是规则运行后发现的问题，而不是规则源文件本身。

这些定义见 [Semgrep Code glossary](https://semgrep.dev/docs/semgrep-code/glossary)。Semgrep 还建议把反复出现的 Code Review 意见和已有 coding guidelines 转换为 custom rules，并可在 CI/CD 中标记问题或阻止合并。[Semgrep Rule ideas](https://semgrep.dev/docs/writing-rules/rule-ideas)

**对 Comet 的含义**：单条声明用 Rule，分类包用 Ruleset；执行器产出的用户可见结果可统一称为“检查结果（Check Result）”，在静态分析适配器内部保留原生术语 Finding。Policy 应保留给“哪些规则在哪里运行、命中后怎样处置”的治理层，而不应作为每条项目规范的同义词。

### 4. OPA：Policy as Code 是规则集合的声明、决策与执行分离

OPA 把 policy 定义为治理软件行为的一组 rules，并强调把 policy decision-making 与 policy enforcement 分离。OPA 使用声明式 Rego 表达 Policy as Code，规则经求值产生 decision，可在微服务、Kubernetes、CI/CD、API gateway 等执行面实施。[OPA Documentation](https://www.openpolicyagent.org/docs)、[OPA Philosophy](https://www.openpolicyagent.org/docs/philosophy)

OPA 的 Policy Language 也明确区分 policy、module、rule 与 query：policy 由模块中的规则表达，查询对数据进行断言并产生决策。[OPA Policy Language](https://www.openpolicyagent.org/docs/policy-language)

**对 Comet 的含义**：Policy as Code 是适合采用的方法论名称，尤其适用于架构、安全、依赖、配置和 CI 治理，但它表示“把一组组织要求声明化、版本化并自动决策/执行”，不是单条 YAML 元数据记录的名称。Comet 也应分离规则源、检查适配器和实际执行面。

### 5. GitHub：Rule、Ruleset、Check 与 Evaluate 是仓库治理术语

GitHub 将 ruleset 定义为应用于一个或多个仓库的命名规则列表。Ruleset 可以作用于分支、标签或 push，并可要求 PR、签名提交、状态检查、Code Scanning 或 Code Quality 结果等。[About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)、[Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)

GitHub Enterprise 的 ruleset enforcement status 使用 **Active / Evaluate / Disabled**。Evaluate 模式不执行阻塞，但会记录如果规则生效时哪些操作会通过或失败，官方明确将其用于在正式执行前测试 ruleset。[Enforcing code governance with rulesets](https://docs.github.com/en/enterprise-cloud@latest/admin/enforcing-policies/enforcing-policies-for-your-enterprise/enforcing-policies-for-code-governance)

**对 Comet 的含义**：`shadow` 可以保留为内部实现术语，但用户可见生命周期更宜使用“评估模式（Evaluate）”或“非阻塞评估”，随后再进入“启用（Active）”。这比自定义 `shadow → validated → adopted → enforced` 更接近现有仓库治理产品的表达。

### 6. GitHub Copilot：非确定性 Agent 输入使用 Instructions

GitHub Copilot 将自然语言定制内容称为 personal、repository、organization custom instructions，并把 `AGENTS.md`、`CLAUDE.md`、`GEMINI.md` 归为 Agent instructions。官方明确说明 AI 具有非确定性，因此不保证每次以完全相同方式遵守这些 instructions；同时建议 instruction 使用简短、自包含的陈述，并可按路径拆分，避免把只适用于部分文件的内容塞入仓库级指令。[GitHub Copilot response customization](https://docs.github.com/en/copilot/concepts/prompting/response-customization)

**对 Comet 的含义**：需要人工或模型语境判断的规范内容，在规范模型中可以叫 Guideline；经过检索、裁剪并实际交给 Agent 的载荷应叫 Repository Instructions 或 Agent Instructions。这样能区分“仓库中维护的指导项”和“某次任务实际加载的指令”，也不会暗示自然语言注入具有 linter 一样的确定性。

## 二、推荐的 Comet 术语模型

### 1. 能力总称：项目规范（Project Standards）

推荐产品表述：

> Comet 主动发现项目规范，将能够确定性判断的规则接入自动检查，将仍需语境判断的指导项按需提供给 Agent。

“项目规范”覆盖编码风格、架构边界、依赖选择、测试要求、构建方式、CI 和 Review 习惯；“团队”是规范的共同维护者，不需要进入每个对象名称。这样也能准确表达规则属于仓库，而不是属于某位用户或某个 Comet 账户。

### 2. 用户入口：Rule 是自然语言，不是新文件格式

- 用户可以直接说“把这条加入项目规范”，不需要创建规则文件或填写机器字段。
- 用户也可以手动创建 `.comet/rules/*.md`，一个普通 Markdown 文件可以写多条规则，不要求 frontmatter、ID 或状态字段。
- 能够确定性检查的要求进入仓库已有的 compiler、linter、测试、构建或 CI 配置。
- 需要 Agent 判断的要求进入最相关的 Agent 指令文件，并沿用仓库或路径作用域。
- 用户也可以直接编辑这些熟悉的仓库文件；Comet 后续能够识别。
- 自动发现只保留内部候选，采用时仍生成普通仓库 diff，由现有 Review 和合并流程决定。
- Ruleset 只在底层工具本身使用该概念时沿用，不作为 Comet 强加给用户的维护结构。

### 3. 确定性执行：Check 与 Enforcement

Rule 是团队审查的规范源；Check 是某个执行器对 Rule 的具体实现和运行；Enforcement 表示检查是否会影响退出码、构建或合并。三者不应混为同一对象：

```text
Rule（规范源）
  → Adapter / native config（适配）
    → Check（执行）
      → Result / Finding / Diagnostic（结果）
        → warn / block（处置）
```

推荐用户可见表述：

- “已为这条规则生成 ESLint 检查”；
- “该检查当前处于评估模式，不阻塞 CI”；
- “评审合并后，将检查级别从 warn 提升为 error”；
- “编译器、linter、测试或 CI 是执行后端”。

不要笼统说“把契约编译进 CI”。更清晰的说法是“把规则接入 CI 检查”或“为规则生成可执行检查”。并非所有后端都真的经过编译：有些只是引用原生配置、运行已有测试或要求 GitHub status check。

### 4. 非确定性内容：Guideline 与 Instructions

不能可靠由工具判定的内容不应伪装成 Rule Check。例如“优先选择更易维护的深模块接口”可能需要设计语境和人工 Review。推荐称为 **Guideline（指导项）**：

- 指导项仍是项目规范的一部分，保留必要的来源和适用范围；
- 指导项按路径、语言、任务类型或阶段检索；
- 指导项按当前任务读取相关内容，不注入整套项目说明；
- 指导项不能产生确定性失败码，也不能被描述为已经通过自动验证；
- 如果以后出现可靠的 linter、测试或 schema 表达，可通过仓库评审把指导项转换为 Rule Check。

相关指导项经匹配后形成某次任务的 **Repository Instructions / Agent Instructions**。Instructions 是 Agent 的输入方式，不是新的规范权威来源，并服从当前用户要求和仓库中更高权威的可执行配置。

Google Java Style Guide 对“hard-and-fast rules”和难以清晰执行的 advice 做了类似区分；ESLint 也建议把可能误报、需要人工复核的规则先设置为 warning，而不是直接在 CI 中作为 error。[Google Java Style Guide](https://google.github.io/styleguide/javaguide.html)、[ESLint Configure Rules](https://eslint.org/docs/latest/use/configure/rules)

## 三、为什么不建议使用 Contract

### 1. 与主流工具的对象模型不一致

ESLint、Semgrep、GitHub 和 OPA 在这一领域稳定使用 Rule、Ruleset、Policy、Check、Finding 和 Enforcement。使用 Contract 会迫使 Comet 为已有行业概念维护一套自有翻译，降低用户理解和适配器命名的一致性。

### 2. Contract 在软件工程中已有更具体的含义

Microsoft 的 Code Contracts 用 contract 表示方法或对象的 precondition、postcondition 和 invariant；Eiffel 的 Design by Contract 也把 contract 定义为调用者与实现者之间的责任和保证。[Microsoft Code Contracts](https://learn.microsoft.com/en-us/dotnet/framework/debug-trace-profile/code-contracts)、[Eiffel Design by Contract](https://www.eiffel.org/doc/eiffel/I2E-_Design_by_Contract_and_Assertions)

Comet 当前讨论的对象不是调用方与实现方之间的前置/后置条件，也不一定形成双边保证；它可能只是候选编码规范、一个 lint 配置、CI 要求或需要人工判断的指导项。称为 Contract 容易让开发者误以为它属于 API/类型/运行时不变量语义。

### 3. 会把不同确定性层级混在一起

同一个“团队契约”当前可能表示：尚未确认的观察、非阻塞评估中的候选、已经合并的规则、编译后的检查，以及只能注入 Agent 的自然语言指导。这些对象的权限、确定性和执行后果不同。使用 Rule、Check、Guideline 和 status 明确拆分后，用户可以直接判断什么会阻塞、什么只是建议。

### 4. Contract 仍可保留在真正的接口合同语境

本结论只针对“主动发现并执行项目规范”能力，不要求全仓库机械替换 `contract`。如果 Comet 已有模块用 contract 表示两个 workflow、Runtime 或 API 之间的稳定输入输出约定，继续使用该术语是合理的；不要把这种接口合同扩展成项目规范的总称。

## 四、落到当前 Shape

- 能力总称使用“项目规范”，单项要求在自然语言中可以称为“规则”。
- Comet 支持可选的 `.comet/rules/*.md`，但不把它设计成一条规则一个文件或要求 ID、状态与执行字段的规则数据库。
- 自动发现形成内部候选；用户显式添加则立即形成可读的仓库改动提案。
- 确定性要求复用原生检查配置，需要语境判断的要求复用 Agent 指令。
- 合并后的仓库文件才是团队共享来源，修改与回滚继续使用 Git。

## 最终建议

Comet 不应把这项能力命名为“团队契约”。建议采用：

> **Project Standards：从项目证据发现规范建议，把可确定性要求接入原生检查，并按需向 Agent 提供相关指导。**

中文产品表述：

> **项目规范：主动发现项目中的规则和指导项；可自动判断的规则进入 lint、test、build 或 CI 检查，需要语境判断的指导项只在相关任务中按需加载。**

这套术语直接对齐 Google 的 Style Guide/Coding Standards、ESLint 与 Semgrep 的 Rule、GitHub 的 Ruleset/Check/Evaluate，以及 OPA 的 Policy as Code，同时保留各对象之间真实的权限与确定性差异。
