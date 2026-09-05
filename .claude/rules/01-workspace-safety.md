# Comet 开发工作区保护

<!-- comet-development-rule:workspace-safety -->

- 开始修改前检查当前分支、比较基线、未提交文件和子模块状态。
- 保留无关修改；不得使用 `reset`、`clean`、删除或批量格式化无关文件来换取检查通过。
- 提交时只显式暂存本任务文件。
- `website` 是独立 Git 子模块，只有任务明确涉及网站时才能修改其内容或引用状态。
- `.agents/skills/comet*`、`.claude/skills/comet*` 和平台安装目录是本地安装或 dogfood 副本，不是产品源码。
