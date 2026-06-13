## 测试

```bash
npx vitest run test/ts/comet-scripts.test.ts   # shell 脚本测试
npx vitest run                                   # 全量测试
```

## 提交前检查

仓库已配置 Git pre-commit 钩子（husky + lint-staged），每次 `git commit` 会自动对 `src/` 下的暂存源文件运行 `prettier --write`（与 CI `format:check` 范围一致），编辑器无关，所有贡献者生效。

提交前建议手动确认（CI 会强制检查）：

```bash
pnpm format:check   # Prettier 格式检查
pnpm lint           # ESLint
pnpm build          # TypeScript 构建
pnpm test           # 单元测试
```

注：本地 Windows 若 `core.autocrlf=true`，未改动的旧文件可能因 CRLF 被 `prettier --check` 误报；钩子只处理暂存文件，不受影响，旧文件下次编辑时会自动转为 LF。

## Shell 脚本规范

脚本位于 `assets/skills/comet/scripts/`，必须跨平台兼容（macOS / Linux / Windows Git Bash）：

- **禁止** `sed -i`（GNU/BSD 不兼容），用 `awk` 做字段替换
- 必须兼容 `sha256sum`（GNU）和 `shasum -a 256`（BSD/macOS）
- 所有可选 grep 结果加 `|| true` 防止 `pipefail` 误杀
- 新增脚本必须加入 `beforeEach` 的拷贝列表和 manifest.json

## 脚本依赖关系

```
comet-state.sh ← comet-guard.sh, comet-handoff.sh, comet-archive.sh
comet-yaml-validate.sh ← comet-guard.sh (preflight 阶段)
comet-handoff.sh ← comet-state.sh (写入 handoff_context/handoff_hash)
comet-hook-guard.sh ← (独立脚本，由 .claude/settings.local.json 的 PreToolUse hook 调用)
```

新增共享工具函数时（如 hash、yaml 解析），如果两个脚本都需要，允许在各自脚本中独立实现，不强制抽共享文件。

## .comet.yaml 状态机

每个 change 的状态文件，字段变更需要同步三处：
1. `comet-state.sh` — `cmd_set` 白名单 + enum 验证
2. `comet-yaml-validate.sh` — schema 校验 + KNOWN_KEYS
3. `test/ts/comet-scripts.test.ts` — 测试中的 yaml 字符串

## 双语言 Skill

skill 优化时先写中文版本（`assets/skills-zh/`），用户确认后再修改英文版本（`assets/skills/`）。

## Skill 触发表述规范

修改 skill 时，新增或调整依赖 skill 的触发方式必须和既有写法保持一致：

- 中文统一使用：`**立即执行：** 使用 Skill 工具加载 <skill-name> 技能。禁止跳过此步骤。`
- 英文统一使用：`**Immediately execute:** Use the Skill tool to load the <skill-name> skill. Skipping this step is prohibited.`
- 后续输入、上下文或执行要求写在“技能加载后 / After the skill loads”段落，不要把 `ARGUMENTS`、`fast-forward` 等另一套调用术语混入触发句。

## Changelog 规范

每次代码产生变更你都应该在完成后写Changelog，并确定是否需要升级版本号，版本号只会比master分支的版本号大一个版本，你需要确定一下当前master的版本号后做决定

如果当前已经有了一个比master大的版本Changelog，则应该追加到同一个版本的Changelog条目下

如果修改的是Skill内容，则需要等中英文完全同步之后再写Changelog

文件：`CHANGELOG.md`，新版本条目置顶。

```
## What's Changed [x.y.z] - YYYY-MM-DD

### Added / Changed / Fixed / Tests / Removed / Security

- **功能名**: 描述做了什么以及为什么
```

要点：
- 版本号与 `package.json` 的 `version` 字段一致
- 每条以 `- **粗体关键词**: ` 开头，后接具体变更内容
- 按类型分组：Added → Changed → Fixed → Tests → Removed → Security
- 描述侧重 **行为变更**（what + why），不是实现细节
- `### Tests` 条目汇总新增测试覆盖的场景，不逐条列出测试用例

## 修改Skill规范

不能够直接修改Superpowers和OpenSpec的原始Skill

## github规范

不能未经过同意直接在github上评论或者提交PR