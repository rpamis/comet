# 能力：语义个人记忆发布收口

## Requirements

### Requirement: 双语用户文档

系统必须提供中文和英文的个人记忆用户文档。两份文档必须描述相同的已发布行为，包括显式操作、后台复盘、语言、作用域、检索、管理、同步、冲突、安全和失败降级。

#### Scenario: 用户了解自动记忆的边界

- **WHEN** 用户阅读对应语言的个人记忆文档
- **THEN** 能知道一次性命令、测试结果、Issue/PR 摘要、可从仓库重查的事实和敏感内容不会被当作长期个人记忆
- **AND** 能知道稳定成功检查点才触发后台复盘，候选和无内容跳过默认静默

#### Scenario: 用户了解语言和管理入口

- **WHEN** 项目配置使用 `zh-CN` 或 `en`
- **THEN** 文档说明自动生成的正文、标题、类别、标签和原因跟随配置语言
- **AND** 文档列出已发布的 CLI/Dashboard/Markdown/Git sync 管理入口及其边界

### Requirement: 用户体验语义不被发布文档扭曲

发布文档必须把显式管理、后台行为和异常降级分别说明，并不得展示或承诺 Runtime、candidate ID、evidence 数量、隐藏推理或未实现的 Skill 自进化。

#### Scenario: 显式管理

- **WHEN** 用户显式记住、纠正、遗忘、回滚或暂停个人记忆
- **THEN** 文档说明会得到简短确认或错误，并且修改立即影响检索、Markdown 和 Dashboard 的同源状态

#### Scenario: 后台与异常

- **WHEN** 后台复盘、同步、后台 Agent 或远端 Git 不可用
- **THEN** 文档说明普通工作流继续完成，后台过程默认不打扰，用户只在首次实际行为变化、冲突或需要处理的同步状态时看到简短提示

### Requirement: 发布资产和版本一致

package、lockfile、asset manifest 和发布元数据测试必须使用同一个、比 `origin/master` 高一个 beta 版本；中英文 Skill 资产、agent metadata、manifest 和安装发现契约必须保持一致。

#### Scenario: 版本发布检查

- **WHEN** 执行发布元数据测试和生成资产检查
- **THEN** 版本值一致，`comet-memory` 双语资产存在且生成 Runtime 与源码一致
- **AND** 不新增对 Classic、Native、Hotfix 或 Tweak 的独立记忆判断规则

### Requirement: 发布验证完整

发布子 Change 必须运行并记录格式、lint/架构、生成资产、构建、全量测试和语义记忆 Eval 的结果；最终 Verifier 必须逐项判断本规格的验收项。

#### Scenario: 发布候选通过

- **WHEN** 所有发布检查成功且独立 Verifier 逐项通过
- **THEN** release 子 Change 才允许归档合入父 Supervisor Change
- **AND** Changelog 只保留从上一发布基线升级后用户可感知的最终变化

## Non-Goals

- 不改变语义记忆 Runtime、Personal Memory domain、workflow bridge、Dashboard 或 Skill 的核心实现。
- 不实现 Skill 自进化、自动修改 Skill/Agent/Project Rules、embedding、向量检索或团队规则升级。
- 不修改 README、网站或外部 GitHub 状态。
