# Assets 与内置 Skill

<!-- comet-development-rule:assets-and-skills -->

- `assets/` 是发布资产根；Runtime `.mjs` 由 `domains/` 源码构建，不能直接写入业务逻辑。
- Skill 内容先修改 `assets/skills-zh/` 中文版本，用户确认后再同步 `assets/skills/` 英文版本。
- 不修改 Superpowers 和 OpenSpec 的原始 Skill；适配行为写在 Comet 自有 Skill、Runtime 或平台集成中。
- Skill 修改完成后运行相关 Skill 契约测试和受影响 Markdown 的 Prettier 检查；中英文未完成同步前不写 Changelog。
- 新增或重命名发布资产时同步 `assets/manifest.json`、`config/repository-layout.json` 和对应仓库测试。
