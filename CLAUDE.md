## 测试

```bash
npx vitest run test/ts/comet-scripts.test.ts   # shell 脚本测试
npx vitest run                                   # 全量测试
```

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
