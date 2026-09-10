# Dashboard workflow 默认路由与插件数据新鲜度

本规格定义 Dashboard 在项目切换和插件页面生命周期中的完整用户可见行为。项目配置、当前会话选择、缓存预览和新鲜数据分别有明确来源；任何异步结果都不能跨越当前项目、插件或请求代次写入页面。

## 项目 workflow 默认路由

Dashboard 项目目录结果必须为每个项目提供默认 workflow 解析结果。解析结果至少区分有效配置得到的 `native`/`classic`、缺失或非法配置的 `fallback`，以及配置读取暂不可用的状态；Dashboard 不自行读取项目文件或猜测 workflow。无法得到有效配置时，兼容回退为 Classic，并保留用户可识别的 fallback 状态。

### Scenario: 有效 Native 配置决定首次入口

- **Given** 当前 Dashboard 项目的有效 Comet 配置将 `default_workflow` 设置为 `native`
- **When** Dashboard 完成项目目录初始化
- **Then** workflow 选择为 Native
- **And** 初始渲染不先展示 Classic 作为错误默认值

### Scenario: 有效 Classic 配置决定首次入口

- **Given** 当前 Dashboard 项目的有效 Comet 配置将 `default_workflow` 设置为 `classic`
- **When** Dashboard 完成项目目录初始化
- **Then** workflow 选择为 Classic

### Scenario: 项目切换重新读取目标项目默认值

- **Given** 当前项目的会话选择可能已经被用户手动覆盖，目标项目的有效默认 workflow 为 Native
- **When** 用户从左上角项目选择器切换到目标项目
- **Then** 当前项目身份先切换为目标项目，再应用目标项目的 Native 默认值
- **And** 当前项目的手动覆盖不泄漏到目标项目

### Scenario: 手动选择只覆盖当前会话

- **Given** 当前项目的配置默认 workflow 为 Native
- **When** 用户在 Dashboard 中手动选择 Classic
- **Then** 当前项目在本次会话中使用 Classic
- **And** 不写回项目配置
- **And** 项目切换后再次进入该项目时重新使用配置中的 Native 默认值

### Scenario: 配置不可用时回退并可识别

- **Given** 项目配置缺失、非法或读取发生非致命错误
- **When** Dashboard 初始化或切换到该项目
- **Then** workflow 使用 Classic
- **And** 项目状态标记为 fallback 或等价的用户可识别状态
- **And** 该状态不会阻止项目列表、设置和插件页面继续工作

## 插件缓存与新鲜数据

Personal Memory 和 Project Knowledge 的页面数据按 `(projectId, pluginId)` 隔离。已有缓存可以立即作为预览，但缓存不能被标记为最新；首次进入插件页面、项目切换后首次进入插件页面和用户显式刷新都必须为当前键发起或复用一个有效的新鲜请求。成功的新鲜结果原子更新页面与对应缓存。

### Scenario: 缓存预览后以新鲜结果替换

- **Given** 当前项目的 Personal Memory 或 Project Knowledge 存在缓存页面
- **When** 用户首次进入该插件页面
- **Then** 页面可以立即展示带同步中的可识别缓存预览
- **And** Dashboard 为当前项目和插件发起一次新鲜请求
- **And** 新鲜请求成功后页面与缓存同时替换为新结果

### Scenario: 项目切换后的首次进入不复用其他项目数据

- **Given** 项目 A 和项目 B 都有同名插件页面缓存
- **When** 用户切换到项目 B 并首次进入该插件页面
- **Then** 页面只显示项目 B 的缓存或加载状态
- **And** 项目 B 的新鲜请求只更新项目 B
- **And** 项目 A 的响应不能覆盖项目 B 的页面

### Scenario: 新鲜请求失败保留可识别缓存

- **Given** 当前插件有缓存预览
- **When** 当前项目/插件的新鲜请求失败、超时或被宿主拒绝
- **Then** 缓存内容继续可见
- **And** 页面显示非阻塞的同步失败或重试状态
- **And** 失败结果不写入为最新缓存

### Scenario: 无缓存且新鲜请求失败

- **Given** 当前插件没有可用缓存
- **When** 新鲜请求失败
- **Then** 页面显示明确的空状态/失败状态和重试入口
- **And** 不显示其他项目或其他插件的内容

### Scenario: 重复请求去重与取消

- **Given** 同一项目和插件在预加载、页面进入或显式刷新路径中产生等价请求
- **When** 请求尚未完成
- **Then** 可复用同一个进行中的请求或安全取消被替代的请求
- **And** 不因重复请求造成重复的页面提交或无界网络增长

### Scenario: 过期响应不能覆盖当前页面

- **Given** 同一项目/插件存在两个不同请求代次，或用户在请求完成前切换了项目/插件
- **When** 较早请求晚于较新请求返回
- **Then** 较早响应被丢弃
- **And** 当前页面、缓存和同步状态只接受当前项目、插件和请求代次的结果

## 自动刷新与性能

Dashboard 的周期刷新必须保持概览更新能力，但不得把所有插件页面当作可见页面强制重载。当前可见插件、设置页面或用户显式要求刷新的数据可以按键更新；未进入的插件继续使用已有缓存/懒加载策略。

### Scenario: 30 秒自动刷新不重载所有插件

- **Given** Dashboard 已经打开且存在多个未进入的插件页面
- **When** 30 秒自动刷新触发
- **Then** 项目概览按现有刷新语义更新
- **And** 只刷新当前可见或显式要求刷新的插件数据
- **And** 未进入的插件不会被全部强制重新加载

### Scenario: 设置页面刷新使用同一套新鲜度保护

- **Given** 用户正在查看 Dashboard 设置或插件管理页面
- **When** 用户显式刷新或从项目切换后重新进入
- **Then** 当前设置数据按当前项目发起新鲜请求
- **And** 缓存预览、失败降级、请求去重和过期响应保护与插件页面一致
