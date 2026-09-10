# Agent CLI 执行契约

## 目标与兼容

Comet 的公开 CLI 是 Agent 执行工作流的稳定入口。Classic 与 Native 保持独立状态机，但均提供当前动作所需的有界观察、明确执行目录、完整 argv、输入选项和结构化失败信息。现有 JSON data 与上游机器结果保持兼容，新增投影不得破坏既有调用方。

## 可执行动作

每份可执行动作必须包含明确的控制 cwd 与完整公开 CLI 参数。需要在独立工作区实现时，另给实现目录，不能让调用方猜测两者关系。状态版本、动作、change、runId、验收轮次与候选等已知绑定信息由 Runtime 提供并继续严格校验。

互斥操作分别作为有名称、有选择条件的输入选项返回，每份 template 始终是可单独提交的对象。Agent 仅填写需要业务判断的摘要、检查计划、结论和真实限制。Build handoff、dispatch、request-checks、final-result、execution-error、unavailable 均遵守这一规则；不能返回解析器必然拒绝的整组模板。

Supervisor 任务包包含 Builder/Verifier 所需的控制目录、实现目录、回报命令及对应角色模板；checks 和 integration 同样可据返回协议执行。重复/迟到 runId、错误候选、缺失逐项验收与不匹配的正式回执仍被拒绝。

## 结果与错误

new、status、next 和 Classic 对应操作提供统一字段位置的精简 Agent 观察，包含阶段、状态版本、工作区和最新动作。成功变更结果本身是该次操作后的观察，正常连续执行直接消费；恢复、并发失效、外部任务结束或工作区变化时重新查询。详情按需分页，不重复内联完整状态。

失败结果必须有准确的整体失败状态、稳定错误代码和具体字段/输入路径。字段校验列出 missing/unknown，条件校验给出 actual/expected 或可操作原因；适用时返回安全恢复动作与当前输入结构。JSON 调用方不依赖 ANSI 文本、stderr 文案或内嵌 JSON 字符串判断失败。错误提示不能要求清空有效成果、强制改 phase 或绕过授权。

UTF-8 输入允许一个文件开头 BOM。其他非法 JSON、未知协议、少报/重复/伪造验收、过期版本和候选不匹配继续拒绝。

## Classic 公开门面与插件

快捷入口和 `classic` 完整入口具有相同参数与副作用契约，包括 --comet-task/path/phase/workflow、COMET_TASK、help 和 -- 分隔符；分隔符后的参数属于子命令，按字面保留。需要记录的检查点通过已有公开 Bridge 恰好 dispatch 一次，保留 workflow/change/candidate/project/language 语义，插件错误不得遮蔽或改变主命令结果。加速不能删除无显式集成参数时的生命周期记录。

## OpenSpec 与平台参数

OpenSpec adapter 从配置的规划目录执行上游。面向 Agent 的下一步必须给出正确的 Comet adapter 命令与控制 cwd；上游直接命令仅作为注明上游上下文的原始结果保留，不能成为另一条相互冲突的权威下一步。现有上游 JSON 字段和退出码可继续访问。

Windows 受支持的 Node CLI 与 shim 必须保持字面 argv，包括空字符串、空格、中文、引号、反斜杠、百分号、感叹号和 shell 元字符；不得发生环境变量展开或命令解释。不能安全识别的自定义 shim 在执行前给出明确诊断，不静默回退到不安全 shell 拼接。非 Windows 保持直接 argv 传递。

## 发布与验证

双语产品 Skill 的命令、路径用途和恢复语义与实际 CLI 一致；文件操作用绝对路径，状态登记用受保护的仓库相对引用，不把规划目录当整个实现工作区的权限边界。测试必须实际执行返回的动作和模板，并覆盖根目录/子目录、普通与 Supervisor、失败后纠正和生成包入口；仅检查文案存在不能替代执行契约。
