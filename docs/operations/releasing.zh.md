# 发布 Comet

GitHub Actions 的 `Release` 工作流负责发布三个 npm 包，并生成 GitHub Release 公告：

- `@rpamis/comet`
- `@rpamis/comet-codex-plugin`
- `comet-dsh-plugin`（无 scope）

安装包托管在 npm，工作流不上传 Release 附件。GitHub 自动提供的源码归档仍会显示。
插件包使用现有构建器的中文 Skills；此次不改变发布包的语言约定。

## 首次配置

先将 `.github/workflows/release.yml` 合并到默认分支 `master`。

用各个包的 npm 管理账号，分别进入包的 Settings → Trusted Publisher，选择 GitHub Actions：

| 字段                 | 内容               |
| -------------------- | ------------------ |
| Organization or user | `rpamis`           |
| Repository           | `comet`            |
| Workflow filename    | `release.yml`      |
| Environment name     | 留空               |
| Allowed actions      | 允许 `npm publish` |

这里的 `rpamis` 是 GitHub 仓库所有者，与 npm 包的 scope 或所属账号无关。
三个包必须分别授权，即使它们由不同 npm 账号管理，也可绑定同一个工作流。
工作流使用 GitHub 托管的 Ubuntu 执行器、Node.js 24 和 npm 11.21.0，以 OIDC 临时凭据发布；
不需要添加 `NPM_TOKEN`。GitHub Release 使用本次运行的 `GITHUB_TOKEN`。

主包和插件的 `repository.url` 必须指向 `https://github.com/rpamis/comet`。
参考：[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)。

## 每次发版

1. 准备好版本号、发布元数据、Codex 市场清单和英文 `CHANGELOG.md`，合并到 `master`。
2. 等待该提交的 `CI` 推送检查成功；其他提交的成功结果不能替代。
3. 打开 GitHub 仓库 → Actions → Release → Run workflow，选择 `master`。
4. 填写版本号，例如 `0.5.4`，不带 `v`。先保持 `publish` 未勾选，运行预览。
5. 在运行 Summary 中检查三个包的计划状态及完整公告。确认后再次运行，勾选 `publish`。

预览也会运行生成物检查、构建、发布扫描、SDK API 检查、相关定向测试、主包安装 E2E，
并构建和打包两个插件。它只查询 npm 状态和生成公告，不发布 npm 包、创建 tag 或保存 Release。
正式发布执行相同检查；使用同一提交已通过的完整 CI，不重新启动仓库全量测试。
两种模式都不启动真实模型或容器 Eval，也不声称已取得模型验收证据。

发布顺序是主包、Codex 插件、DSH 插件。每个包发布后，从公共 npm 检查提交归属并拉取 tarball；
主包下载成功后才发布插件。所有包都完成后才公开 GitHub Release。
整个运行绑定启动时的提交；不会在运行中重新取 `master` 最新内容。

## 公告格式

从 `CHANGELOG.md` 提取目标版本，下一版标题确定上个发布 tag。工作流核对上个 tag
是当前提交的祖先，并明确将这两个版本与当前提交传给 GitHub 的 Generate release notes API。
公告依次组合：

1. GitHub 自动生成的 `What's Changed` 和 PR 列表。
2. 目标版本 Changelog 的 `Added`、`Changed`、`Fixed` 等分类正文。
3. 自动生成的 `New Contributors`（有则保留）。
4. 自动生成的 `Full Changelog` 比较链接。

不会带入旧版 Changelog，也不会把同一标题重复拼接。版本 tag 沿用 `0.5.4` 的格式。

## 失败与补发

工作流不自动重试 `npm publish`。写入失败或超时后，先查看 npm 和运行日志，再对**原运行**
选择 Re-run all jobs，保留原版本与原提交。不要直接以后来新增提交重新发布同一版本。

发布包记录 npm 标准的 `gitHead` 字段。重跑时先检查三个包的同版记录；属于原提交的包
会跳过发布，但仍重新下载验证，剩余包按顺序补发。任何已存在版本来自其他提交或缺少
`gitHead` 时都会停止，需人工核对，不会当成可覆盖或可复用的包。已经公开的同版
Release 保留原公告；尚未公开的同版草稿会在三个包验证成功后更新并公开。
按 tag 查不到草稿时，会用当前凭据分页查询发布列表，按精确版本找回尚未创建 tag 的草稿。

npm 已发布成功但短暂查不到版本时，工作流只重试读取，最多约 25 秒；仍不可见便停止。
网络错误、授权错误和 npm 服务错误都按失败处理，不当成“尚未发布”。
已存在的同名 Git tag 若指向其他提交，也会停止。
如果任一包的 npm `latest` 已指向更高版本，旧版本重跑会停止，避免把默认安装版本退回。

## 本地检查

```text
pnpm exec vitest run test/scripts/publish-release.test.ts
node scripts/release/publish-release.mjs --help
```

本地也可在已通过 `master` CI 的干净检出中，完成构建后设置 `GH_TOKEN` 并运行：

```text
node scripts/release/publish-release.mjs --version 0.5.4
```

默认只预览。`--publish` 只接受本仓库 `master` 上手动触发且提交匹配的 Actions 运行。
当前实现新增发布能力，不宣称修复旧版发布行为。开发期 Review 的草稿恢复案例登记为
`release-562-pending-tag-draft`；来源与原失败/修复后证据见下节。

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
