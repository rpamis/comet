# Comet 上下文感知项目规范研究

日期：2026-08-14

## 研究问题

Comet 能否把两类能力组合成一个对用户友好的项目规范系统：团队用普通 Markdown 自由维护规则；能够确定性判断的要求交给 Maven、Gradle、compiler plugin、linter、静态分析、测试、构建或 CI 执行；仍需语境判断的规则只在相关任务中提供给 Agent，而不是全量占用上下文？Hook 在其中应该是什么位置？如果宿主没有 Hook，又如何工作？

## 结论

这个方向可行，但更准确的架构不是“Rule + Hook + compiler”，而是：

> **可读规则源 + 上下文路由 + 原生检查 + 自动修复循环。**

其中 Hook 只是宿主支持时的投递适配，不是核心依赖。核心能力是 Comet 的规则选择器与检查循环：Runtime 发现项目已有的验证入口、运行相关命令，并把失败诊断交还给 Agent 修复。投递依次使用动态 Hook、轻量宿主 Rule 加载器和 Comet Skill fallback；没有 Hook 的宿主仍然能够完成主流程。

三个关键判断如下：

1. **项目规则应完全独立于 Comet change。** 规则属于仓库，任何任务和任何 Agent 都应使用；用户可以直接编辑规则文件，不需要先开启、创建或切换 change。某次 change 当然可能修改规则文件，但 change 只是普通 Git 改动的工作容器，不是规则的生命周期。
2. **Hook 应是可选投递适配。** 不同宿主的 Hook 事件、输出字段、云端行为和信任机制并不一致。把 Hook 作为核心会让能力在宿主之间退化；把它作为增强层，则可用来更及时地刷新规则、拦截危险操作或把检查结果送回 Agent。
3. **跨宿主的核心应是同一份项目规范和同一个选择器。** Comet 不应复制维护多份 Cursor、Claude、Copilot、Codex 规则。宿主原生的路径规则可以复用，但 Comet 自己只维护普通 Markdown 规则源、内部索引和检查计划。

## 一、行业事实：自然语言规则正在走向按需加载

### Cursor

Cursor Project Rules 位于 `.cursor/rules`，支持 `Always`、按 glob 自动附加、由 Agent 根据 description 请求，以及手动引用；嵌套规则会在相关目录文件被引用时加载。这说明“路径过滤 + Agent 相关性判断”已经是主流做法，而不是把所有规则常驻上下文。[Cursor Rules](https://docs.cursor.com/context/rules)

Cursor Hook 可以在 session start 注入初始上下文，也可以在 `postToolUse` 后返回 `additional_context`；但 `beforeSubmitPrompt` 只能继续或阻止提交，`preToolUse` 的正式输出主要是允许、拒绝或改写工具输入。Cursor Cloud Agent 早期只读阶段不运行 Hook，并且不支持真正的 cloud `sessionStart`。因此，单靠 Hook 不能保证所有环境都在第一次读取或编辑前收到动态规则。[Cursor Hooks](https://cursor.com/docs/hooks)

### GitHub Copilot

Copilot 支持仓库级 `.github/copilot-instructions.md`、带 `applyTo` glob 的 `.github/instructions/*.instructions.md`，以及 `AGENTS.md`、`CLAUDE.md` 等 Agent 指令。路径指令只在当前工作文件匹配时加入；官方也明确提示自然语言指令具有非确定性，不能保证每次完全遵守。[Custom instructions](https://docs.github.com/en/copilot/concepts/prompting/response-customization)、[Copilot CLI instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions)

Copilot Hook 的 `postToolUse` 可以给模型附加上下文，多个结果合并后上限为 10 KB；`userPromptSubmitted` 的 `modifiedPrompt` 只对 SDK 程序化 Hook 生效，配置文件中的 command/HTTP Hook 输出会被丢弃。不同 Copilot surface 也支持不同事件。因此，Copilot 上可以用 Hook 增强工具执行后的反馈，但不能假定所有形态都支持提交提示词时动态注入。[GitHub Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)

### Claude Code

Claude Code 的 `.claude/rules/*.md` 支持 `paths`，只在读取匹配文件时加载；子目录 `CLAUDE.md` 也按需加载。官方建议将只适用于某类文件的内容移入路径规则，以降低上下文噪声，并明确说明 CLAUDE.md 是上下文而非强制配置。[Claude Code memory and rules](https://code.claude.com/docs/en/memory)

Claude Code Hook 能在 `UserPromptSubmit`、`PreToolUse`、`PostToolUse` 等事件返回 `additionalContext`。官方同时提醒：静态规范应优先放在 CLAUDE.md；中途注入的动态内容会进入 session transcript，恢复旧会话时可能重放旧值；超长内容会转存为文件，只把路径和预览交给模型。[Claude Code hooks](https://code.claude.com/docs/en/hooks)

### OpenAI Codex

Codex 从项目根目录向当前工作目录发现并拼接 `AGENTS.md`，更近目录的内容出现在后面；合计默认上限为 32 KiB，并且在一次 run/session 开始时建立这条指令链。这种目录层级适合稳定、局部的项目说明，但不等于按当前任务和实际触及文件动态检索。[Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md)

Codex Hook 已支持在 `SessionStart`、`UserPromptSubmit`、`PreToolUse` 和 `PostToolUse` 等事件加入 `additionalContext`，并允许为输出设置大小阈值。但官方也说明 Hosted tools 不经过本地工具 Hook，部分特殊工具路径可以选择绕过默认 Hook；项目 Hook 还需要工作区信任和逐定义审查。因此它是有效增强，不是完整执行边界。[Codex Hooks](https://developers.openai.com/codex/hooks)

### 事实归纳

- 路径作用域、目录层级和按相关性加载已经是 Cursor、Copilot、Claude Code、Codex 的共同方向。
- 自然语言规则只是模型上下文，不能提供 compiler、linter 或测试那样的确定性。
- Hook 能更及时地观察、阻止或追加上下文，但各宿主能力并不对齐，云端与本地也不完全一致。
- 因此，Comet 应把“选择相关规则”做成自己的可移植能力，把 Hook 当作宿主优化。

## 二、行业事实：确定性要求适合进入原生构建与检查系统

Maven 的核心是 build lifecycle，plugin goal 可以绑定到 `validate`、`compile`、`test`、`verify` 等阶段；官方在不确定调用哪个阶段时推荐 `mvn verify`，因为它会运行之前阶段和附加质量检查。Maven Enforcer 还能让规则失败直接使构建失败，也允许使用 warning 级别。[Maven build lifecycle](https://maven.apache.org/guides/introduction/introduction-to-the-lifecycle)、[Maven Enforcer](https://maven.apache.org/enforcer/maven-enforcer-plugin/usage.html)

Gradle Plugin 可以添加任务和约定；Base Plugin 的 `check` 是聚合验证入口，插件和构建作者应把测试及其他验证任务接到 `check`。这让自定义 Gradle Plugin、Checkstyle、SpotBugs 或项目自有任务自然进入同一构建入口，而不需要 Comet 知道每个插件的命令语法。[Gradle Base Plugin](https://docs.gradle.org/current/userguide/base_plugin.html)、[Gradle Plugin Basics](https://docs.gradle.org/current/userguide/plugin_basics.html)

ESLint 用退出码区分通过、规则错误和配置错误；warning 是否使命令失败由 `--max-warnings` 等项目配置决定。Semgrep 默认本地 scan 不因 finding 失败，但可用 `--error` 使 finding 返回退出码 1；`semgrep ci` 默认按组织策略产生失败结果。OPA 的 `--fail` 和 `--fail-defined` 也可把策略查询结果映射为非零退出码并接入 CI。[ESLint CLI](https://eslint.org/docs/latest/use/command-line-interface)、[Semgrep CLI](https://semgrep.dev/docs/cli-reference)、[OPA in CI/CD](https://www.openpolicyagent.org/docs/cicd)

这些机制的共同接口不是某个固定工具或固定命令，而是：

```text
项目声明的验证入口
→ 进程退出状态
→ 原生诊断输出
→ Agent 修复
→ 重跑同一检查
```

这意味着 Comet 无需为 Maven、Gradle、ESLint、Semgrep、OPA 或未来插件分别发明插件 SDK。MVP 只需发现并执行项目已有命令、保留原生命令语义、把诊断交给 Agent。结构化结果适配器可以以后按价值增加，但不是首发前提。

## 三、推荐架构：双通道项目规范

### 1. 规则通道：只提供当前任务需要理解的内容

团队可以直接维护 `.comet/rules/*.md`。一个文件可以按主题包含多条规则，不要求“一条规则一个文件”，也不要求 frontmatter、ID、状态等机器字段：

```markdown
# 后端规范

## Controller 只负责协议转换

适用范围：`server/**/controller/**`

Controller 不直接访问数据库；业务逻辑进入 service。

## 数据库迁移

适用范围：`server/**/migration/**`

已发布 migration 不允许原地修改，新增 migration 完成修正。
```

`适用范围` 是可选的普通说明。省略时，Comet 可以根据文件所在目录、标题、任务文本和实际访问路径选择。用户也可以继续维护已有 `AGENTS.md`、`.claude/rules/`、`.github/instructions/` 或 `.cursor/rules/`；Comet 将它们视为现有项目输入，不要求迁移，也不覆盖原文件。

上下文路由分三次逐步收敛：

1. **任务开始**：根据用户请求、cwd、项目技术栈选择少量项目级规则。
2. **目标明确**：当 Agent 读取、引用或准备修改具体路径时，补充匹配该路径的规则。
3. **验证前**：只补充与即将运行的构建、发布、安全或数据操作有关的规则。

MVP 使用固定上限，不依赖宿主是否暴露上下文大小：每次最多选择 5 个规则段落、合计不超过 8 KiB；同一会话已经提供且未变化的内容不重复注入。用户最终只看到一句低干扰摘要，例如“本次应用了后端和数据库迁移规范”。

### 2. 检查通道：让项目自己的工具决定通过或失败

Comet 从 wrapper、manifest、构建文件、项目脚本、已有 Agent 指令、开发文档和 CI 中发现验证入口，例如 Maven phase、Gradle task、npm script、Make target 或任意项目命令。它不硬编码“所有 Java 项目运行某条命令”，也不要求某个插件实现 Comet 接口。

执行策略是：

```text
代码形成一个稳定编辑点
→ 按改动路径选择最小相关检查
→ 失败则把原生诊断交给 Agent
→ Agent 修复并重跑同一检查
→ 通过后按改动风险运行更宽的项目检查
```

Comet 遵循原生工具对 error、warning 和退出码的定义，不再维护第二套严重级别。命令成功时 warning 默认不阻塞；团队需要更严格时，应在 Maven、Gradle、linter、测试或 CI 配置中把它升级为失败。

机器索引、已发现命令、规则选择缓存和检查记录放在 `.comet/runtime/`，不写进用户规则文件。它们可以重建，也不应成为团队需要手工维护的内容。

### 3. 同一选择器，三种投递方式

Comet 的规则选择器无论宿主提供哪种扩展能力，都应完成以下动作，用户无需打开 Dashboard 或主动运行 CLI：

- 任务开始时读取规则目录的标题、作用域和短摘要；
- 在目标路径明确后读取选中的完整规则段落；
- 修改完成后运行相关原生检查；
- 检查失败时修复并重跑；
- 只有规则实际改变处理方式或检查失败时才简短说明。

支持 Hook 的宿主可更及时地完成同样的动作：session/prompt 事件用于粗选，read/edit/tool 事件用于按路径刷新，post-tool/stop 事件用于把诊断送回 Agent 或继续修复。

无 Hook 但支持宿主 Rule 时，Comet 安装一条很小的项目级规则加载器。它不复制整套规范，只告诉 Agent 在任务开始和目标路径变化时读取 `.comet/rules` 中相关段落，并沿用项目原生检查。Hook 和 Rule 都不可用时，Comet Skill 直接调用内部选择器；这里的 CLI/Runtime 是 Skill 的内部实现，不是要求用户学习的新入口。

## 四、为什么这比“全量 Rule 注入”更先进

### 单一可读来源，多宿主投递

团队维护的是项目规范，而不是为每个宿主复制一份配置。Cursor、Claude Code、Copilot、Codex 的原生规则可以继续使用，但 Comet 不把复制和同步它们作为必需流程。选择器输出同一份短 Markdown，宿主适配器负责用可用机制交给 Agent。

### 自然语言负责意图，原生检查负责判定

“Controller 不直接访问数据库”可以先作为可读规则；当项目已有 ArchUnit、Semgrep、自定义 Maven/Gradle Plugin 或测试能够判断它时，检查结果成为实际执行依据。这样既保留人能理解的原因和例外，又不要求模型每次靠记忆遵守。

### 渐进加载而不是一次性提示词

任务开始时通常还不知道最终会修改哪些文件。按“请求 → 已读路径 → 已改路径 → 验证命令”逐步缩小规则集合，比只在 session start 猜一次更可靠，也比把整套规范塞入上下文更节省。

### 反馈闭环而不是只做阻塞

检查失败不是终点，而是结构化修复信号。Comet 需要明确要求 Agent 读取诊断、修复、重跑同一命令，直到通过或确认是与本次改动无关的既有失败。用户获得的是更少的 Review 返工，而不是更多规则提示。

## 五、与 Comet change 的关系

项目规范的读取、应用和执行与 change 无关：

- 普通 Comet Skill 任务、Native、Classic、Hotfix、Tweak 以及非 Comet Agent 都可以读取同一份规则并运行同一组项目检查。
- 用户手动创建或编辑 `.comet/rules/*.md` 时，文件立即成为普通仓库改动，不要求新建特殊 change。
- 如果当前任务本来就在修改规范，规则文件和构建配置就像其他代码一样进入当前 diff。
- 自动发现的候选不应擅自写入当前 change，也不应自动创建另一个 change；它先作为一次简短建议出现，用户说“加入项目规范”后再产生普通仓库 diff。
- 是否使用 Comet change 只由用户当前工作流决定，不属于规则系统本身。

## 六、MVP 与演进顺序

### MVP

1. 支持普通 `.comet/rules/*.md`，一个文件可写多条规则；允许用户手动创建和直接编辑。
2. 识别仓库已有 Agent 指令和原生检查配置，不要求迁移。
3. 提供基于任务文本、cwd 和路径的确定性预过滤，再由 Agent 在候选中选择；设置固定数量和大小上限。
4. 从项目现有构建、脚本、文档和 CI 发现检查命令；优先使用 wrapper 和仓库已经使用的入口。
5. 在 Comet Skill 中完成“选择规则 → 修改 → 相关检查 → 自动修复 → 重跑”。
6. 对已支持的宿主安装轻量 Hook 适配；无 Hook 但支持 Rule 时安装一条项目级规则加载器；两者都不可用时退回 Skill 主流程。
7. 正常应用默认安静，只有规则实际改变处理方式或检查失败时才说明，不要求用户访问 CLI 或 Dashboard。

### 后续演进

- 为常见工具增加结构化诊断适配器，但保留“任意命令 + 退出码 + 原始输出”通用路径。
- 根据连续成功任务和 Review 反馈发现候选规则；候选仍由团队通过普通 Git Review 采用。
- 对新检查提供非阻塞评估模式，先观察误报和覆盖范围，再由团队决定是否让它影响构建或 CI。
- 当某条自然语言规则反复对应同类失败时，建议把它转成 Semgrep、ESLint、测试、Maven/Gradle Plugin 或其他原生检查；Comet 负责提出和验证改动，不自造通用规则语言。
- 为规则选择和检查效果提供按需可见的简要说明，例如“为何加载这条规则”“哪个文件触发”“哪个检查证明通过”，但不把内部证据字段塞进规则文件。

## 最终建议

用户提出的设计方向是正确的，但应把 Hook 从“系统核心”降为“宿主适配”，并在 Rule 与 compiler 之间加入两个关键能力：**上下文路由**和**自动修复循环**。

最终产品表述可以是：

> **项目规范：团队用可读规则说明如何开发；Comet 只把当前任务需要的内容提供给 Agent，并复用项目已有的编译、lint、测试、构建和 CI 检查，让 Agent 根据真实失败自动修复。**

这套设计不依赖 Dashboard，不要求用户学习 CLI，不把规则绑定到 Comet change，也不要求团队维护机器字段或一条规则一个文件。
