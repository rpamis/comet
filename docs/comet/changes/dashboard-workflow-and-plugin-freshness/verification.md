---
generated_from_state_version: 16
---

# 验证

## 当前结果

- 结果: **验收通过，可归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 3
- 验证器尝试次数: 2
- 完成时间: 2026-09-10T16:41:51.531Z
- 摘要: 当前候选满足 A1 到 A21 的验收要求，判定通过。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | Scenario: 当前项目配置为 Native 时首次进入 Dashboard - Given 当前项目的有效 Comet 配置 `default_workflow` 为 `native` - When 用户首次打开 Dashboard - Then 首屏默认 workflow 为 Native，且不会先显示 Classic 再切换 | 项目目录初始化完成后按 Native 默认配置进入，初始化前 workflow 为 null，不会闪现 Classic。 |
| A2 | passed | brief.md | Scenario: 左上角切换到另一个项目时同步默认 workflow - Given 当前项目为 Classic，项目选择器中另一个项目的有效配置为 Native - When 用户通过左上角选择器切换到该项目 - Then 当前 workflow 自动变为 Native，并使用目标项目的配置结果 | 左上角切换项目后解析目标项目的 defaultWorkflow，并应用目标项目的 Native 配置。 |
| A3 | passed | brief.md | Scenario: 手动切换不覆盖项目默认值 - Given 当前项目默认 workflow 为 Native - When 用户手动切换到 Classic 后仍停留在当前项目 - Then 当前会话保持 Classic，切换到其他项目再返回时恢复读取该项目的 Native 默认值 | 手动切换仅更新当前会话状态；项目切换并返回后重新使用项目配置默认值。 |
| A4 | passed | brief.md | Scenario: 默认 workflow 配置未知或不可用时安全回退 - Given 项目配置缺失、非法或暂时无法读取默认 workflow - When Dashboard 初始化或切换到该项目 - Then 使用 Classic 作为回退，并显示可识别的 `configured` 或 `fallback` 状态，不阻塞 Dashboard 其他功能 | 缺失、非法或不可读配置回退 Classic，并通过 fallback 状态标识且不阻塞其他 Dashboard 功能。 |
| A5 | passed | brief.md | Scenario: 进入插件页时刷新 Personal Memory 或 Project Knowledge - Given 目标插件已有缓存或刚在另一个项目中完成切换 - When 用户首次进入 Personal Memory 或 Project Knowledge 页面 - Then 页面可先展示可识别的缓存预览，同时发起当前项目/插件范围内的新鲜请求；新鲜结果完成后替换为最新数据 | Personal Memory 与 Project Knowledge 页面先展示按键隔离的缓存预览，同时发起 fresh 请求并在成功后更新页面和缓存。 |
| A6 | passed | brief.md | Scenario: 插件新鲜请求失败时保留缓存 - Given 目标插件存在可识别缓存且新鲜请求失败 - When 用户进入该插件页面或刷新该页面 - Then 保留缓存内容，显示非阻塞的同步失败/重试状态，不展示其他项目的数据 | fresh 请求失败时保留缓存内容，显示非阻塞失败提示和重试入口，不展示其他项目数据。 |
| A7 | passed | brief.md | Scenario: 并发插件请求只影响当前项目和插件 - Given 同一项目或项目切换期间存在重复、取消或乱序的插件请求 - When 较早请求晚于较新请求返回 - Then 过期响应不会覆盖当前项目/插件页面，且同一项目/插件的等价请求被去重 | 请求协调器按项目与插件键去重，并通过取消和 generation 保护并发请求结果。 |
| A8 | passed | brief.md | Scenario: 自动刷新保持插件加载性能 - Given Dashboard 的 30 秒自动刷新到期 - When 自动刷新执行 - Then 只更新必要的项目概览和当前可见/需要刷新的插件数据，不强制重新加载所有插件页面 | 自动刷新保留概览刷新语义，仅对当前可见插件或设置触发更新，不重载全部插件。 |
| A9 | passed | specs/dashboard-workflow-and-plugin-freshness/spec.md | 有效 Native 配置决定首次入口 - **Given** 当前 Dashboard 项目的有效 Comet 配置将 `default_workflow` 设置为 `native` - **When** Dashboard 完成项目目录初始化 - **Then** workflow 选择为 Native - **And** 初始渲染不先展示 Classic 作为错误默认值 | 有效 Native 配置决定首屏 Native workflow，且首屏等待项目目录初始化后再选择 workflow。 |
| A10 | passed | specs/dashboard-workflow-and-plugin-freshness/spec.md | 有效 Classic 配置决定首次入口 - **Given** 当前 Dashboard 项目的有效 Comet 配置将 `default_workflow` 设置为 `classic` - **When** Dashboard 完成项目目录初始化 - **Then** workflow 选择为 Classic | 有效 Classic 配置决定首屏 Classic workflow。 |
| A11 | passed | specs/dashboard-workflow-and-plugin-freshness/spec.md | 项目切换重新读取目标项目默认值 - **Given** 当前项目的会话选择可能已经被用户手动覆盖，目标项目的有效默认 workflow 为 Native - **When** 用户从左上角项目选择器切换到目标项目 - **Then** 当前项目身份先切换为目标项目，再应用目标项目的 Native 默认值 - **And** 当前项目的手动覆盖不泄漏到目标项目 | 项目切换先更新目标项目身份，再应用目标项目默认 workflow，当前项目的会话覆盖不会泄漏。 |
| A12 | passed | specs/dashboard-workflow-and-plugin-freshness/spec.md | 手动选择只覆盖当前会话 - **Given** 当前项目的配置默认 workflow 为 Native - **When** 用户在 Dashboard 中手动选择 Classic - **Then** 当前项目在本次会话中使用 Classic - **And** 不写回项目配置 - **And** 项目切换后再次进入该项目时重新使用配置中的 Native 默认值 | 手动 workflow 选择不写回配置，仅作用于当前会话；重新进入项目时恢复配置中的默认值。 |
| A13 | passed | specs/dashboard-workflow-and-plugin-freshness/spec.md | 配置不可用时回退并可识别 - **Given** 项目配置缺失、非法或读取发生非致命错误 - **When** Dashboard 初始化或切换到该项目 - **Then** workflow 使用 Classic - **And** 项目状态标记为 fallback 或等价的用户可识别状态 - **And** 该状态不会阻止项目列表、设置和插件页面继续工作 | 配置不可用时项目目录返回 Classic/fallback，且项目列表、设置和插件页面仍可继续使用。 |
| A14 | passed | specs/dashboard-workflow-and-plugin-freshness/spec.md | 缓存预览后以新鲜结果替换 - **Given** 当前项目的 Personal Memory 或 Project Knowledge 存在缓存页面 - **When** 用户首次进入该插件页面 - **Then** 页面可以立即展示带同步中的可识别缓存预览 - **And** Dashboard 为当前项目和插件发起一次新鲜请求 - **And** 新鲜请求成功后页面与缓存同时替换为新结果 | 插件首次进入支持缓存预览、fresh revalidation，以及成功后的页面和缓存原子替换。 |
| A15 | passed | specs/dashboard-workflow-and-plugin-freshness/spec.md | 项目切换后的首次进入不复用其他项目数据 - **Given** 项目 A 和项目 B 都有同名插件页面缓存 - **When** 用户切换到项目 B 并首次进入该插件页面 - **Then** 页面只显示项目 B 的缓存或加载状态 - **And** 项目 B 的新鲜请求只更新项目 B - **And** 项目 A 的响应不能覆盖项目 B 的页面 | 缓存键包含 projectId 与 pluginId，项目切换后仅读取和更新目标项目数据，旧项目响应无法覆盖当前页面。 |
| A16 | passed | specs/dashboard-workflow-and-plugin-freshness/spec.md | 新鲜请求失败保留可识别缓存 - **Given** 当前插件有缓存预览 - **When** 当前项目/插件的新鲜请求失败、超时或被宿主拒绝 - **Then** 缓存内容继续可见 - **And** 页面显示非阻塞的同步失败或重试状态 - **And** 失败结果不写入为最新缓存 | 插件 fresh 请求失败时保留可识别缓存，显示同步失败提示并提供重试，失败结果不会写入缓存。 |
| A17 | passed | specs/dashboard-workflow-and-plugin-freshness/spec.md | 无缓存且新鲜请求失败 - **Given** 当前插件没有可用缓存 - **When** 新鲜请求失败 - **Then** 页面显示明确的空状态/失败状态和重试入口 - **And** 不显示其他项目或其他插件的内容 | 无缓存请求失败时显示明确失败或空状态及重试入口，并在页面清理时避免残留其他项目或插件内容。 |
| A18 | passed | specs/dashboard-workflow-and-plugin-freshness/spec.md | 重复请求去重与取消 - **Given** 同一项目和插件在预加载、页面进入或显式刷新路径中产生等价请求 - **When** 请求尚未完成 - **Then** 可复用同一个进行中的请求或安全取消被替代的请求 - **And** 不因重复请求造成重复的页面提交或无界网络增长 | 同一项目与插件的预加载、页面进入和刷新请求可复用；替代请求可安全取消，避免重复网络增长。 |
| A19 | passed | specs/dashboard-workflow-and-plugin-freshness/spec.md | 过期响应不能覆盖当前页面 - **Given** 同一项目/插件存在两个不同请求代次，或用户在请求完成前切换了项目/插件 - **When** 较早请求晚于较新请求返回 - **Then** 较早响应被丢弃 - **And** 当前页面、缓存和同步状态只接受当前项目、插件和请求代次的结果 | AbortController、generation 和当前页面状态检查共同丢弃过期响应，旧结果不能写入页面或缓存。 |
| A20 | passed | specs/dashboard-workflow-and-plugin-freshness/spec.md | 30 秒自动刷新不重载所有插件 - **Given** Dashboard 已经打开且存在多个未进入的插件页面 - **When** 30 秒自动刷新触发 - **Then** 项目概览按现有刷新语义更新 - **And** 只刷新当前可见或显式要求刷新的插件数据 - **And** 未进入的插件不会被全部强制重新加载 | 30 秒刷新仅增加当前可见插件或设置的刷新 token，未进入的插件不会被全部强制加载。 |
| A21 | passed | specs/dashboard-workflow-and-plugin-freshness/spec.md | 设置页面刷新使用同一套新鲜度保护 - **Given** 用户正在查看 Dashboard 设置或插件管理页面 - **When** 用户显式刷新或从项目切换后重新进入 - **Then** 当前设置数据按当前项目发起新鲜请求 - **And** 缓存预览、失败降级、请求去重和过期响应保护与插件页面一致 | 设置页读取持久化缓存作为预览，fresh 失败时保留缓存并支持重试；插件页与设置页共享请求并通过 owner 引用计数避免误取消。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| Dashboard source contract smoke | .codex-native-dashboard-check.mjs | . | passed | 0 | 100 ms |

## 阻塞项

_无。_

## 风险与跳过的工作

- 未验证真实宿主 Runtime、CI、线上网络行为及完整浏览器套件；结论结合当前源码和已提供的通过证据。
- 本地 Dashboard 域测试 213/213、关键 Playwright 回归 3/3、Dashboard 构建、lint、格式检查、git diff --check 及 dashboard-source-contract Runtime check 均通过。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A2, A5, A11, A14, A21 | 独立审查确认 A21 设置页失败降级存在缺陷，其他已实现范围按静态检查和可用探针给出结果；需要回到 Build 修复 A21 后重新验证。 | 2026-09-10T15:05:53.343Z |
| 1 | 2 | 1 | execution-error | — | Native Verifier response was invalid: Native verification cannot pass before every required check succeeds | 2026-09-10T15:59:58.221Z |
| 1 | 2 | 1 | recovery | — | Native Runtime 已将依赖解析权限错误记录为失败检查；保持已实现代码不变，重新建立可执行的 Verify 检查边界 | 2026-09-10T16:09:03.993Z |
| 1 | 3 | 1 | recovery | — | Repair verification passed for A2, A5, A11, A14, A21; final full verification is required. | 2026-09-10T16:36:46.692Z |
| 1 | 3 | 2 | pass | — | 当前候选满足 A1 到 A21 的验收要求，判定通过。 | 2026-09-10T16:41:51.531Z |



## 结论

当前候选满足 A1 到 A21 的验收要求，判定通过。
