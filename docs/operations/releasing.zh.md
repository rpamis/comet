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
5. 再运行 Release，版本号不变，action=finalize；工作流自动找到该版本的原暂存运行，
   不需要填写任何 ID。三个包都已在公共 npm 可下载后，工作流才生成或公开 GitHub Release。

**不等待 master CI。** Release 自行执行生成物检查、构建、发布文件扫描、SDK API 检查、
发布定向测试和主包安装 E2E；任一检查失败便停止。finalize 沿用原暂存提交，并重新进行
版本、生成物、构建、发布物和 npm 下载核对，不重复暂存前的测试与安装 E2E。
这不等于完整仓库 CI，Release 不声明完整 CI 已通过，也不自动启动真实模型或容器 Eval。

## 原提交与公告

finalize 先读取已批准主包在 npm 上的 gitHead，再分页查找本仓库 master 上、同一提交的
Release 手动运行，选择最近一份未过期的 comet-release-stage 记录。预览和 finalize 运行
没有该记录，会被跳过；不读取其他仓库、工作流或提交的记录。然后检出原提交，继续核对
暂存记录的运行 ID、版本和提交。即使 master 已前进，也不把新代码或新 Changelog 混入公告。
主包尚未批准、缺少 gitHead 或找不到有效记录时，会明确停止，不改用当前 master 或其他版本。

公告沿用原样式：GitHub 自动生成的 What's Changed / PR 列表、本版本 Changelog 分类正文、
New Contributors（有则保留）、Full Changelog 比较链接。记录在 stage 时保存完整公告，
finalize 使用同一内容。上个 tag 从 Changelog 下一版本标题取得，必须是候选提交的祖先。
三个正式 npm 版本均需有匹配的 gitHead，并按主包、Codex、DSH 顺序下载验证。
已公开的同版公告保持不变；同版草稿沿用原 ID，在验证后更新并公开。

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
- finalize 发现尚未批准、不可下载、来源不匹配或 npm 服务异常时停止，不创建公告、不代替用户批准。
  完成 npm 批准或修复下载后，重跑该 finalize 运行即可。
- 已有同版包来自其他提交、已有 tag 指向其他提交，或 npm latest 已高于待发布版本时停止。
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
原 --publish 及 publish 布尔输入已由 action 取代。source_run_id 现在由工作流自动查找，不再显示为表单输入；
内部仍保存该 ID 以核对和恢复原执行。此前已成功暂存的记录也可自动查找，无需重新暂存。
旧运行仍使用旧脚本，不会因代码更新自动变为暂存。
启用新流程需从最新 master 发起新的 Release 运行。

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
