# 发布

<!-- comet-development-rule:release -->

- 写 Changelog 或调整版本前核对 `origin/master` 版本、当前版本、上一个发布 tag 和已有更高版本条目。
- Changelog 只描述相对上一个发布版本的最终用户可见行为，不记录分支内修正、review follow-up、测试补充或重构过程。
- `package.json`、lockfile 根包版本和 `assets/manifest.json` 保持一致；当前分支已有比 master 更高的版本时追加到同一版本。
- 发布准备运行生成物检查、构建、发布元数据测试、prepublish scan、npm pack/package E2E，以及风险要求的完整测试。
- 未获得当前会话的明确发布授权时，不执行 `npm publish`、创建 GitHub Release 或修改远端 release/tag。
