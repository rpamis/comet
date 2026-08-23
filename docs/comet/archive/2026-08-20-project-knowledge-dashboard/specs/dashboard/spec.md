# 项目知识 Dashboard 页面

## 目标与入口

Dashboard 通过现有 `PluginRuntime.dashboardPages()` 发现第一方 `comet.project-knowledge` 页面。插件模块提供 `status` capability 返回可序列化状态快照；页面加载过程不得创建任何 Provider、读取项目语料、启动 ripgrep 或调用远端 HTTP。

## 状态快照

快照字段保持稳定且有界：

- `provider`：`local` 或 `remote`；
- `configured`：规范化 Provider 配置是否有效；
- `remote`：仅在 Remote 时返回脱敏 endpoint、可选 scope、timeout、token 环境变量名和环境变量是否存在；
- `retrieval`：说明当前 Provider 的行为；Local 必须说明不维护索引，Remote 必须说明配置不等于请求成功；
- `diagnostics`：最多三条 `{ code, message }`，消息最多 240 个字符并去除 Bearer 值。

Remote endpoint 只保留协议、主机和路径，清除 username、password、query、hash。token 环境变量的值永远不进入 page data；Remote 未配置 token 时显示未配置状态，不能为了展示状态发起未认证请求。

## 页面内容

页面包含四格状态行：Provider、插件状态、当前项目暂停状态和配置有效性。配置摘要展示 Local/Remote 的安全字段；诊断区展示最近有界诊断或“没有新的诊断”空状态。页面只提供现有生命周期操作：启用、当前项目暂停/恢复和卸载。

禁用页面不能调用插件 capability；`DashboardPluginHost` 继续返回 `data: null` 并拒绝 invoke。全局停用与当前项目暂停通过页面摘要中的 `globallyDisabled` 和 `projectPaused` 区分。

## 生命周期

- `lifecycle({ action: 'disable' })` 复用既有 project scope pause；
- `lifecycle({ action: 'enable' })` 清除当前项目暂停，并在必要时恢复全局停用；
- `lifecycle({ action: 'uninstall' })` 复用既有显式卸载，保留文档和插件状态语义。

页面不实现第二套生命周期状态机，也不把配置错误变成 Dashboard mutation。

## 安全与边界

页面不显示 token、Authorization header、完整远端响应、绝对路径或本地文档正文。diagnostics 仅复用插件已有短诊断并限制条数/长度；页面加载错误仍由 Dashboard host 错误边界转换，不能阻塞普通任务执行。

## 验收

### A1 — 页面发现

**Given** 默认 first-party bridge 已协调插件，**When** Dashboard 请求插件列表，**Then** 返回个人记忆和 `/plugins/project-knowledge` 项目知识页面。

### A2 — 安全状态

**Given** Local 或 Remote 规范化配置，**When** Dashboard 加载项目知识页面，**Then** 返回 provider、configured、retrieval 和安全 remote 摘要，且不包含 token、凭据、query、hash、Authorization 或 Provider 请求副作用。

### A3 — 生命周期状态

**Given** 插件全局启用、全局停用或当前项目暂停，**When** Dashboard 获取页面，**Then** `status`、`globallyDisabled`、`projectPaused` 与 Runtime 状态一致；disable/enable/uninstall 使用现有 host lifecycle API。

### A4 — 诊断边界

**Given** 插件最近产生任意诊断，**When** Dashboard 获取页面，**Then** 最多返回三条、每条最多 240 个字符、Bearer 值被替换；没有诊断时页面显示空状态。

### A5 — MVP 边界

**Given** 用户打开项目知识页面，**Then** 页面只展示状态、配置摘要、检索语义、诊断和生命周期操作，不展示搜索、索引、embedding、监听器、历史或配置编辑控件。

### A6 — 兼容性

**Given** 现有项目知识检索、个人记忆 Dashboard 和归档 `project-knowledge-retrieval` Change，**When** 新页面实现并通过测试，**Then** 三者既有行为和归档产物保持不变。
