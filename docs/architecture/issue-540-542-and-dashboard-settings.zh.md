# 更新内容保留、Hook 诊断与取消历史读取

日期：2026-11-08。比较基线：`00a47ebc55f8b32c7995ca715130b247a57c47ef`；已发布版本：npm `@rpamis/comet@0.5.2`，tarball SHA-1 `11866c3e3a2e78a3792cd15b3afe038b9a326a6a`。本次保持版本 `0.5.3`，因为远端 master 与上一个 tag 均为 `0.5.2`。

## 报告与复现

| 来源                                               | 独立行为                                                                | 旧代码结果                                  | 预期及禁止结果                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| [#540](https://github.com/rpamis/comet/issues/540) | update 删除托管区块内的自定义忽略规则和注释，并移动区块                 | npm 0.5.2 与比较基线均删除自定义内容        | 保留用户行及相对顺序；不得让 `!` 例外因区块移动而失效                      |
| #540                                               | 更新配置时丢弃键前及行尾的用户注释                                      | 两版本均复现                                | 保留用户注释、扩展字段和取值，继续刷新自带说明的语言                       |
| [#541](https://github.com/rpamis/comet/issues/541) | 已正确安装的 ZCode 用户级 Hook 被 doctor 当作残留，repair 后仍报警      | 两版本均复现                                | 有效且唯一的配置通过；缺失、禁用、重复及旧配置仍需诊断                     |
| #541 的安装生命周期补充                            | 项目更新删除已有用户级 Hook，写入不会执行的项目 Hook                    | 两版本的项目协调入口均复现                  | 项目操作保留用户级配置，不声称项目 Hook 生效，不越过项目范围安装用户级配置 |
| [#542](https://github.com/rpamis/comet/issues/542) | 内置 cancelled v1 Run 已 closed，清理活动文档后 doctor 与 repair 都失败 | 两版本公开 CLI 均退出 65，`sdk-run-invalid` | 校验原历史后读取原 Run；不重新激活、不伪造 Archive、不改变 revision        |
| `report:2026-11-08-dashboard-change-walkthrough`   | 已有 `change_walkthrough` 缺少 Dashboard 设置入口                       | 新增读写断言在旧接口失败                    | 显示默认开启，支持关闭、保存、刷新和重新开启；旧客户端省略字段时保留原值   |

#542 使用 Runtime 正常创建、取消和封存 v1 Run，随后在临时目录移走活动文档；没有手改终态或 revision。最小案例停在 Shape，同样复现报告的投影错误，并覆盖 linked worktree。原 macOS Verify/revision 59 现场未重建。取消本身不会删除文档。

## 修复边界

- `.gitignore` 保持区块原位置，原有用户规则不重排；只移除明确的旧版生成规则并补齐缺失的 Comet 规则。多个区块无法安全确定顺序时保留原文件并要求人工合并。原格式测试改为核对区块前后顺序，仍保留全部标准规则和幂等断言；新增 Git 实际匹配断言强化覆盖。
- YAML 在原文档节点上合并，保留用户注释；Classic 旧顶层键迁移时同步迁移注释。未受影响的扩展锚点及别名保持关联；锚点被迁移或修改时，仅展开解析值已受影响的引用，避免扩展字段连带变化。Comet 的既有说明可更新语言。CLI 更新和 Dashboard 保存复用同一渲染入口，写入继续绑定原文件摘要。
- ZCode 用户级 Hook 是有效安装范围。项目协调不再安装无效的项目 Hook，也不清理用户级配置；提示使用显式 `--scope global`。doctor 的项目检查读取用户级配置，全局检查按平台能力区分有效配置和历史残留。项目选择修复只在真正生效的 Router 文件与 Hook 都通过只读检查后执行；未就绪时保留选择。底层 ZCode 项目格式序列化及卸载测试继续保留，用于兼容旧文件，不代表当前 ZCode 会执行项目 Hook。
- Native 仅对身份与 artifact root 已校验、无固定应用身份、owner 为内置 Native、Run 为 cancelled、持久化分区为 closed 的记录跳过活动投影同步。doctor 后续定义、执行停止、锁和存储检查继续执行，活动 Run 和未停止执行的取消仍报错。
- Dashboard 使用现有 Ant Design Switch 和双语文案，明确额外 token 消耗，不新增项目字段。

[ZCode 官方文档](https://zcode.z.ai/cn/docs/hooks)明确当前用户级 Hook 会执行、项目配置会被忽略。[Git 官方文档](https://git-scm.com/docs/gitignore)说明同一优先级由最后匹配规则决定结果。临时 `git check-ignore` 对照证实，将用户否定规则搬到托管区块前会改变结果。

## 验证与限制

新增案例在 `config/workflow-regressions.json` 逐行为登记。实现前已取得 `.gitignore`、YAML 注释、ZCode 诊断/清理、Native 历史与 Dashboard 配置的失败断言；公开 update 在旧构建中也先复现自定义规则丢失。

定向验证包括公开 update/doctor、Native doctor 命令 bundle、原配置和 Hook 生命周期测试、Dashboard 实际配置文件读写，以及中英文浏览器中的开关保存和刷新。浏览器使用隔离 API 响应检查请求、状态与渲染，实际 YAML 持久化由配置接口测试独立验证；不将浏览器模拟响应当作服务端持久化证据。

未运行真实模型 Eval（用户未授权）、仓库全量测试、macOS 原现场或 ZCode 客户端实际事件。本次 Hook 改动修复安装作用域与确定性诊断，不改变 Hook 事件协议，也不将配置测试当作真实平台执行证据。

工作区已有 `.ruff_cache`（创建于 2026-11-05），导致原目录的架构检查失败；不删除该无关缓存。交付前在仅含本次变更的干净快照中运行架构检查，并分别记录结果。归档状态文件及 website 子模块的既有修改不纳入提交。

### 最终检查结果

- `pnpm build`、`pnpm check:generated` 和受影响文件的 Prettier 检查通过。Dashboard 构建保留已有的大 chunk 提示。
- 按上述六个 case ID 执行 `pnpm test:core-regressions --case <id> ...`：6 组通过，17 项断言实际执行，无失败。包含公开 update/doctor、Git 优先级、配置迁移与别名、用户级 Router 就绪条件、Native doctor bundle 及 linked worktree 同名活动任务隔离。
- 相关基础批次 259 项通过；最终配置相关四个文件 56 项通过；YAML 合并 20 项通过。范围存在重叠，不将这些数字相加表示总覆盖数。
- Playwright `dashboard-settings-browser.spec.ts --grep 'change walkthrough' --workers 1`：中英文 2 项通过，验证关闭/开启、POST 请求、刷新后保留、1280px 桌面和 390px 窄屏；检查了实际截图。
- `pnpm check:badcase-registration --base 00a47ebc55f8b32c7995ca715130b247a57c47ef` 及带本地完整声明正文的检查通过；没有创建 PR 或向 GitHub 发表评论。
- 原目录 `pnpm lint` 的 ESLint 无错误，但架构检查受既有 `.ruff_cache` 阻塞。基线归档加本次文件覆盖后的干净快照执行完整 `pnpm lint` 通过，保留 9 个既有未使用变量警告；未删除或移动原目录缓存。
- Standards 与 Spec 两个方向的审查均已复核通过。审查发现的注释迁移、锚点引用、有效 Hook 下的选择修复和两项覆盖缺口均已处理；历史 Git 忽略测试的顺序断言调整被确认没有降低覆盖。
