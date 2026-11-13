# 发布

<!-- comet-development-rule:release -->

- 写 Changelog 或调整版本前核对 `origin/master` 版本、当前版本、上一个发布 tag 和已有更高版本条目。
- Changelog 只描述相对上一个发布版本的最终用户可见行为，不记录分支内修正、review follow-up、测试补充或重构过程。
- `package.json`、lockfile 根包版本和 `assets/manifest.json` 保持一致；当前分支已有比 master 更高的版本时追加到同一版本。
- 正式发布准备运行生成物检查、构建、发布元数据测试、prepublish scan、npm pack/package E2E，并按具体影响范围选择回归测试；全量测试条件遵循根 `AGENTS.md` 的“测试”章节。日常版本字段更新只执行相关检查，不自动启动正式发布验证。
- 未获得当前会话的明确发布授权时，不执行 `npm publish`、创建 GitHub Release 或修改远端 release/tag。
- DSH 插件作为独立 npm 包发布；发布 `@rpamis/comet` 不会连带发布 `comet-dsh-plugin`。发布新版时核对两者的 npm 状态，先发布匹配版本的主包，再按 `plugin/dsh/README.md` 的“发布到 npm”步骤构建、检查并发布插件；最后从公共 registry 拉取验证。源码模板保持私有，仅发布构建目录中的正式包。
