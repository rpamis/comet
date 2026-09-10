# 目标

让 Dashboard 的 workflow 入口和插件数据状态跟随当前项目的真实配置与数据源。项目配置为 Native 时，Dashboard 首次进入和左上角切换项目都直接进入 Native；配置为 Classic 时保持 Classic。Personal Memory 和 Project Knowledge 在进入页面或切换项目后的首次进入时主动获得最新数据，同时保留缓存预览、失败降级和并发保护，避免用户手动切换或刷新页面。

# 范围

## Source coverage

- `https://github.com/rpamis/comet/issues/402`（complete）：覆盖 Dashboard workflow 默认值、项目切换、设置保存后的即时生效、手动切换的会话级语义、未知配置回退，以及 Personal Memory / Project Knowledge 的新鲜度、缓存预览、失败降级、请求去重、取消、过期响应保护和自动刷新性能约束。

- Dashboard 项目目录/API 返回项目可用于默认 workflow 路由的配置结果及其来源状态。
- Dashboard 当前项目初始化、左上角项目切换和设置保存后的 workflow 状态同步。
- Dashboard 插件页面进入、项目切换后的首次进入、手动刷新和自动刷新期间的 Personal Memory / Project Knowledge 数据加载。
- 页面级缓存作为快速预览；新鲜请求完成后以当前项目和插件身份匹配的结果原子替换；失败时保留可识别缓存并显示非阻塞状态。
- 相关 API、Dashboard 单元/源代码契约测试及浏览器行为测试；改动涉及的 Dashboard 构建产物按仓库规则同步。

# 非目标

- 不改变 Comet Native、Classic 的工作流规则、项目配置格式或 CLI 行为。
- 不把用户手动选择的 workflow 持久化为项目默认配置；手动切换只影响当前 Dashboard 会话，直到项目切换或重新加载。
- 不要求进入 Dashboard 时强制重新加载所有插件，也不改变非 Personal Memory / Project Knowledge 插件的业务语义。
- 不修改网站子模块、README、外部 GitHub Issue 内容或新增后台常驻刷新服务。

# 验收示例

- Scenario: 当前项目配置为 Native 时首次进入 Dashboard
  - Given 当前项目的有效 Comet 配置 `default_workflow` 为 `native`
  - When 用户首次打开 Dashboard
  - Then 首屏默认 workflow 为 Native，且不会先显示 Classic 再切换

- Scenario: 左上角切换到另一个项目时同步默认 workflow
  - Given 当前项目为 Classic，项目选择器中另一个项目的有效配置为 Native
  - When 用户通过左上角选择器切换到该项目
  - Then 当前 workflow 自动变为 Native，并使用目标项目的配置结果

- Scenario: 手动切换不覆盖项目默认值
  - Given 当前项目默认 workflow 为 Native
  - When 用户手动切换到 Classic 后仍停留在当前项目
  - Then 当前会话保持 Classic，切换到其他项目再返回时恢复读取该项目的 Native 默认值

- Scenario: 默认 workflow 配置未知或不可用时安全回退
  - Given 项目配置缺失、非法或暂时无法读取默认 workflow
  - When Dashboard 初始化或切换到该项目
  - Then 使用 Classic 作为回退，并显示可识别的 `configured` 或 `fallback` 状态，不阻塞 Dashboard 其他功能

- Scenario: 进入插件页时刷新 Personal Memory 或 Project Knowledge
  - Given 目标插件已有缓存或刚在另一个项目中完成切换
  - When 用户首次进入 Personal Memory 或 Project Knowledge 页面
  - Then 页面可先展示可识别的缓存预览，同时发起当前项目/插件范围内的新鲜请求；新鲜结果完成后替换为最新数据

- Scenario: 插件新鲜请求失败时保留缓存
  - Given 目标插件存在可识别缓存且新鲜请求失败
  - When 用户进入该插件页面或刷新该页面
  - Then 保留缓存内容，显示非阻塞的同步失败/重试状态，不展示其他项目的数据

- Scenario: 并发插件请求只影响当前项目和插件
  - Given 同一项目或项目切换期间存在重复、取消或乱序的插件请求
  - When 较早请求晚于较新请求返回
  - Then 过期响应不会覆盖当前项目/插件页面，且同一项目/插件的等价请求被去重

- Scenario: 自动刷新保持插件加载性能
  - Given Dashboard 的 30 秒自动刷新到期
  - When 自动刷新执行
  - Then 只更新必要的项目概览和当前可见/需要刷新的插件数据，不强制重新加载所有插件页面

# 约束与不变量

- 项目配置是 workflow 默认路由的唯一权威来源；前端不复制或推断 Native/Classic 规则。
- `configured`、`fallback`、手动会话覆盖和缓存/新鲜状态在用户可观察语义上保持可区分。
- 任何异步结果必须绑定项目 ID、插件 ID 和请求代次；项目切换、插件切换或取消后，旧结果不得写入当前状态。
- 缓存只能作为预览或失败降级，成功的新鲜结果必须原子更新对应缓存和页面状态。
- 请求去重、取消和自动刷新优化不能牺牲首次进入的新鲜请求，也不能让缓存跨项目复用。
- 只提交当前 change 的实现、测试、必要构建产物和用户可见 Changelog；保留其他工作区修改。

# 决策

- 由 Dashboard 项目目录/API 提供已解析的默认 workflow 结果及状态，Dashboard 只消费该结果，不在 UI 层重复解析项目文件。
- 初始化和项目切换使用项目默认 workflow；手动 workflow 选择保留为会话级覆盖，项目切换时清除。
- 插件页面采用“缓存预览 + 进入时按项目/插件新鲜校验”的策略；设置/插件刷新路径共享去重、取消和过期响应保护。
- 30 秒自动刷新继续保持轻量；只有当前可见或显式要求刷新的插件才触发对应数据更新。

# 待解决问题

# 验证预期

- 运行 Dashboard 项目目录/API、前端缓存/状态和相关源代码契约测试。
- 运行 `pnpm build:dashboard`，并检查生成 Dashboard 资产与源码一致。
- 运行覆盖首次进入、项目切换、缓存命中/失败、乱序响应和自动刷新的 Playwright 浏览器测试。
- 按改动风险运行 Dashboard lint/格式检查；最终记录未执行项、环境限制及真实结果，不把本地通过推断为 CI 或真实运行时通过。
