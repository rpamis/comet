# 发布 Comet

Release 工作流支持 preview（预览）、stage（暂存）和 finalize（完成公告）三个动作。
三个安装包托管在 npm：`@rpamis/comet`、`@rpamis/comet-codex-plugin` 和无 scope 的
`comet-dsh-plugin`。工作流不上传 GitHub Release 附件，只在 Actions 内保存暂存记录。
插件包继续使用中文 Skills。

## 首次配置

用各包的 npm 管理账号进入 Settings → Trusted Publisher → GitHub Actions，分别填写：

| 字段                 | 内容                                               |
| -------------------- | -------------------------------------------------- |
| Organization or user | `rpamis`                                           |
| Repository           | `comet`                                            |
| Workflow filename    | `release.yml`                                      |
| Environment name     | 留空                                               |
| Allowed actions      | 仅允许 `npm stage publish`，关闭直接 `npm publish` |

这里的 rpamis 指 GitHub 仓库所有者，与 npm 包的 scope 或管理账号无关。
三个包各自授权同一个工作流；管理账号启用 2FA，并可在 Publishing access 选择
Require two-factor authentication and disallow tokens。OIDC 暂存仍可正常工作。
无需配置 NPM_TOKEN，也不要将 OTP、Passkey 或登录会话交给 Actions。
工作流使用 GitHub 托管的 Ubuntu、Node.js 24 和 npm 11.21.0。

参考：[npm 暂存发布](https://docs.npmjs.com/staged-publishing/)、
[Trusted Publisher 权限](https://docs.npmjs.com/trusted-publishers/)。

## 每次发版

1. 准备版本号、发布元数据、Codex 市场清单和英文 CHANGELOG，合并到 master。
2. 打开 Actions → Release → Run workflow，分支选 master，填写版本号（如 0.5.4，不带 v）。
   action 默认 preview，只检查、打包和生成公告预览。
3. 准备好后选择 action=stage。工作流检查并将三个包暂存到 npm，Summary 显示每个 stage ID
   作为运行记录；无需复制运行 ID。它不会直接公开 npm 版本，也不会创建 Git tag 或公告。
4. 到 npm 的 Staged Packages 页面检查包名、版本和发布标签，通过 2FA 批准。
   先批准主包，再批准插件；支持批量审批的账号也可批量处理，但批量操作并非原子操作，需确认三项均成功。
5. 再从最新 master 新建 Release 运行，版本号不变，action=finalize。
   工作流确认指定版本的三个 npm 包已公开且可下载，然后以本次 master 提交创建 GitHub Release。
   不需要填写运行 ID，也不需要原暂存记录。

**不等待 master CI。** Release 自行执行生成物检查、构建、发布文件扫描、SDK API 检查、
发布定向测试和主包安装 E2E；任一检查失败便停止。finalize 使用本次 master 的代码，重新核对
版本、生成物、构建和发布文件，并验证指定 npm 版本；不重复暂存前的测试与安装 E2E，也不重新打包上传。
这不等于完整仓库 CI，Release 不声明完整 CI 已通过，也不自动启动真实模型或容器 Eval。

## finalize 的版本与公告

finalize 是维护者人工选择的发布动作，GitHub Release 的 tag 指向本次 dispatch 的 master 提交。
先检查该提交的 package、assets、Codex 插件和市场清单版本均与输入一致，再检查三个 npm 包的
指定版本是否公开，按主包、Codex、DSH 的顺序下载验证。npm 包的 gitHead 无需与 master 一致，
也不要求指定版本仍是 npm latest；finalize 不修改 npm dist-tag。

master 可以领先 stage 时的提交。因此，GitHub tag 与 npm 包的源码提交可能不同，这是该人工
发布流程允许的行为。stage 及 stage 重跑仍检查同版本包的原提交，拒绝混用来源或倒退 npm latest。

公告从本次 master 重新生成：GitHub 自动生成的 What's Changed / PR 列表、本版本 Changelog
分类正文、New Contributors（有则保留）、Full Changelog 比较链接。标题前后补齐空行，保留
代码块内容。stage 保存的旧公告不覆盖本次内容。上个 tag 从 Changelog 下一版本标题取得，
必须是本次 master 的祖先。已公开的同版公告保持不变；同版草稿沿用原 ID，在验证后更新并公开。

工作流仅使用默认 GITHUB_TOKEN 的 Contents 写权限，无需额外令牌。
本次提交与创建公告时的默认分支没有 workflow 差异时，可避免旧流程指向历史提交触发的额外权限限制。
参考：[GitHub 创建 Release 的权限要求](https://docs.github.com/en/rest/releases/releases#create-a-release)。

## 失败与恢复

Actions 的 comet-release-stage artifact 只保存版本、原提交、公告、各包 stage ID 和提交状态，
不保存 npm 安装包或认证信息，保留 30 天。

- stage 部分失败时，对原运行选择 Re-run all jobs。它先恢复暂存记录：已记录 stage ID 的包不重传，
  已正式发布的同源包跳过暂存，尚未开始的包继续上传。每次上传前先写入 submitting，成功后记录 stage ID。
- 网络错误、超时或返回内容缺少 stageId 时，结果记为未知；重跑不会盲目重发。到 npm 核对该包，
  如已暂存则审阅并批准，再重跑原任务；如确认未上传或已拒绝，人工核对后重新发起 stage。
  不要在旧状态不明时启动第二个 stage 运行。
- 首次运行在暂存记录生成前就失败时，没有 npm 写入；修复前置检查后重新发起 stage。
  artifact 不存在时，恢复步骤会停止，不猜测旧上传结果。
- finalize 发现指定 npm 版本尚未公开、不可下载或 npm 服务异常时停止，不创建公告、不代替用户批准。
  完成 npm 批准或修复下载后，从最新 master 新建相同版本的 finalize 运行。
- 本次 master 的版本与输入不一致，或已有 tag 指向其他提交时停止；不移动已有 tag。
- stage 发现已有同版 npm 包来自其他提交，或 npm latest 已高于待发布版本时停止。
- 旧 finalize 运行的 Re-run 仍使用旧工作流，不能带入这次修复。需要从最新 master 新建运行。
- npm 拒绝或删除暂存版本后，旧 stage ID 只表示曾经上传成功，不表示仍待批准；人工确认后发起新的 stage 运行。

## 本地检查

```text
pnpm exec vitest run test/scripts/publish-release.test.ts test/scripts/staged-release.test.ts
node scripts/release/publish-release.mjs --help
```

构建后可在干净检出中设置 GH_TOKEN 并运行默认预览：

```text
node scripts/release/publish-release.mjs --version 0.5.4
```

stage 和 finalize 的写入只接受本仓库 master 上明确触发、提交匹配的 Actions 运行。
原 --publish 及 publish 布尔输入已由 action 取代，source_run_id 不再是表单输入。

以下记录描述早期实现；finalize 当前采用上文的人工 master 发布规则。
早期自动查找暂存记录的只读辅助入口及回归保留，但不参与当前 finalize。

## 2026-11-16 发布策略调整与回归

用户明确要求去掉 master CI 等待，并在 npm 通过 2FA 批准后发布。
旧 master 84ab3c11 的真实运行 [43837439354](https://github.com/rpamis/comet/actions/runs/43837439354)
在 master CI 排队时退出；旧代码的直接发布路径使用 npm publish。
同样的暂存断言在旧代码中失败，新代码仅调用 npm stage publish；没有执行真实 registry 写入。
登记来源 report:2026-11-16-release-stage-2fa 和 report:2026-11-16-release-no-master-ci。

原直接上传、发布后轮询以及等待 CI 的普通测试按本次明确授权调整：保留原提交归属、主包先验证、
下载失败即停止、不倒退 latest 的断言；用暂存前保存状态、未知结果不重发、重复运行复用 stage ID、
用户批准前不能完成公告替代旧直接上传断言。历史 release-562-pending-tag-draft 案例的来源、选择器、
草稿分页恢复及验证后才更新原草稿的断言保持不变。普通测试与 npm CLI/打包证据不替代真实 OIDC、
账户 2FA 或托管 Actions 验收；这些真实边界须在获得发布授权后验证。

本次实际执行：相关定向测试、三个真实 npm 包的打包检查、构建、生成物检查、发布文件扫描、
SDK API 检查、主包安装 E2E、lint、Prettier、actionlint 和回归登记检查均通过。
另用 npm 11.21.0 的真实 CLI 对本地模拟 registry 完成三次 stage POST，确认上传保留 gitHead、
JSON stageId 能被脚本读取，且未出现直接发布 PUT 或 approve 请求。该检查没有访问真实 npm 写入接口。
未执行仓库全量测试、Eval、真实 npm OIDC 暂存、账号 2FA 批准或托管 Actions 发布；后者仍需首次启用验证。

## 0.5.4 开发期 Review 验证

[草稿恢复 Review](https://github.com/rpamis/comet/pull/562#discussion_r4583250651)对应
[GitHub 发布 API](https://docs.github.com/en/rest/releases/releases)：按 tag 查询针对已发布公告，
拥有推送权限的已认证列表查询可读取草稿。原测试错误地让按 tag 查询直接返回草稿；
改为 404 后，`e76845b6` 未调用原草稿 PATCH，断言失败。新实现查找分页列表中的精确版本，
保留 npm 下载验证先于公告写入以及已发布公告不改写的断言。

[npm 测试隔离 Review](https://github.com/rpamis/comet/pull/562#discussion_r4583250657)指出真实打包
测试可能读取本机配置。[npm 配置规则](https://docs.npmjs.com/cli/v11/configuring-npm/npmrc/)允许通过
`userconfig` 和 `globalconfig` 指定配置。测试将 HOME、USERPROFILE、配置与缓存指向临时目录；
在临时默认 `.npmrc` 写入 `dry-run=true`，再显式使用空白 userconfig，确认仍生成三个真实包。
测试结束恢复环境；没有读取或修改开发者的 npm 配置，没有执行 npm publish 或创建远端 Release。

## 自动查找暂存运行的验证

来源 report:2026-11-16-release-auto-source-run：用户反馈每次手动查找和填写运行 ID 不便。
8a3a0abe 的 finalize 表单要求 source_run_id；当前版本从表单移除该输入，按 npm 正式版本的原提交
自动发现记录，保存和下载记录的内部 ID 绑定保持不变。新增单元测试先在旧代码因缺少自动查找入口失败，
再覆盖正常查找、master 前进、分页、过期记录、其他来源及尚未批准等情况；保留原显式来源核对测试。
本机只读查询已验证主包尚未批准时会停止；该结果不代表已验证完整托管 finalize。
本轮不修改打包、npm 暂存、人工批准或下载验证逻辑，不启动真实发布、全量测试或 Eval。

## master 发布与标题空行回归

[运行 43865158436](https://github.com/rpamis/comet/actions/runs/43865158436/job/133291723722)
已在原暂存提交 8a3a0abe 完成三个 npm 包的下载验证，创建公告时返回 403。
日志确认默认令牌有 Contents 写权限；原提交与 master 的 workflow 存在差异，GitHub 要求额外的
Workflows 写权限。用户明确选择人工 finalize 以最新 master 发布，只核验指定 npm 版本公开可下载。
因此移除 finalize 的原提交检出、原运行查询、artifact 和收据依赖，保留原 stage 恢复机制。
不引入额外令牌，不要求 npm 原提交与 master 一致。

新增的 master 前进、缺少收据、无 gitHead 和版本不匹配断言在旧实现中失败，修改后通过。
公开 CLI 测试实际启动发布脚本和 npm 子进程，使用本地模拟 API/下载响应，确认只下载指定的三个包，
不重新构建 npm 包或上传，也不查询暂存记录。该测试不能代替真实 GitHub 发布与 npm 网络下载验收。
原来源检查及 latest 不倒退测试继续覆盖 stage；finalize 的行为按用户上述明确要求调整。
草稿恢复、下载失败不写公告、已公开公告不改写等历史断言保持不变。

标题空行另登记为 report:2026-11-16-release-heading-spacing：用户样例中 What's Changed 标题后
直接接列表。组合函数补齐标题前后空行，代码块和正文保持原样；相同断言先在旧实现失败，再在新实现通过。
本轮没有写入真实 GitHub Release/tag，没有重新上传 npm 包，也未执行全量测试或 Eval。
用户可继续手动发布；若采用修复后的 CI，应从最新 master 新建 finalize 运行。

本轮验证：88 项定向测试通过，包含三个真实 npm 包的本地打包；lint、受影响文件的 Prettier、
actionlint、差异空白检查及 badcase 基线保留检查通过。公开 CLI 的发布和下载响应使用模拟服务，
真实 GitHub 写入、真实 npm 下载及完整托管发布未执行。
