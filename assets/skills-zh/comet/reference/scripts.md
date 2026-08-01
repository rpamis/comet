# 稳定 CLI 与内部脚本兼容说明

规范路径：`comet/reference/scripts.md`

本文件是 Comet 公开 CLI 与内部脚本兼容方式的单一事实来源。每个 Classic 命令都发布了自包含 bundle（`comet/scripts/comet-*.mjs`）。直接调用 bundle 比走 `comet` CLI 外壳更快，因为 CLI 每次调用都要承担 commander 注册和模块加载开销。日常工作流优先使用直连 bundle 调用；`comet` CLI 作为回退方案保留。

## 脚本引导

Comet 脚本随 Skill 包分发在 `comet/scripts/` 下。进入 workflow 时解析一次脚本目录的绝对路径。宿主显示了本 Skill 的 Base directory 时，直接使用该目录下的 `scripts/`，不要再搜索；否则用宿主文件搜索定位 `comet-env.mjs`，再通过 Node 运行，例如：

```bash
for root in "$PWD/../.claude/skills" "$HOME/.claude/skills" "$HOME/.codex/skills" "$HOME/.agents/skills" "$HOME/.config" "$HOME/.gemini" .; do
  [ -d "$root" ] || continue
  COMET_ENV="$(find "$root" -path '*/comet/scripts/comet-env.mjs' -type f -print -quit 2>/dev/null)"
  [ -n "$COMET_ENV" ] && break
done
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.mjs not found. Ensure the comet skill is installed." >&2
  return 1
fi
node "$COMET_ENV"
```

```powershell
$CometEnv = Get-ChildItem -Path "$PWD/../.claude/skills", "$HOME/.claude/skills", "$HOME/.codex/skills", "$HOME/.agents/skills", "$HOME/.config", "$HOME/.gemini", . -Filter comet-env.mjs -File -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '[\\/]comet[\\/]scripts[\\/]comet-env\.mjs$' } |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $CometEnv) { throw 'comet-env.mjs not found. Ensure the comet skill is installed.' }
node $CometEnv
```

命令会输出脚本目录的绝对路径。把该路径记录在任务上下文中，并由它解析 `<comet-state-script>`、`<comet-guard-script>`、`<comet-handoff-script>`、`<comet-archive-script>`、`<comet-intent-script>` 和 `<comet-resume-probe-script>`。后续每次工具调用都必须把带引号的占位符替换为对应 `.mjs` 文件的字面绝对路径；不得把尖括号占位符原样传给 shell，也不得依赖某次 shell 调用中的局部变量在后续调用中继续存在。任一必需 bundle 缺失时停止 workflow。

## 公开工作流协议

日常工作流直接调用已解析的 bundle。参数与 CLI 子命令完全一致（只需去掉 `comet` 关键字）：

```bash
node "<comet-state-script>" select <change-name>
node "<comet-state-script>" current
node "<comet-state-script>" clear-selection
node "<comet-state-script>" check <change-name> <phase>
node "<comet-guard-script>" <change-name> <phase> --apply
node "<comet-handoff-script>" <change-name>
node "<comet-archive-script>" <change-name>
```

当多个 active change 共存时，进入明确的 change 后先运行 `node "<comet-state-script>" select <change-name>`。普通源码写入只受该选择管辖；尚未选择时 hook 会阻塞并要求选择。单 active change 可继续自动归属。切换 branch/worktree 或选择失效后必须重新运行 `select`。

guard 的 `--apply` 在检查通过后推进状态。需要直接表达状态事件时使用 `node "<comet-state-script>" transition`；阶段推进后使用 `node "<comet-state-script>" next` 解析是否自动调用下一 Skill。

| 占位符 | 用途 |
|------|------|
| `<comet-state-script>` | `.comet.yaml` 状态读写、phase 检查和恢复上下文 |
| `<comet-guard-script>` | 阶段退出守卫和 `--apply` 状态推进 |
| `<comet-handoff-script>` | Design/Build handoff 上下文包生成 |
| `<comet-archive-script>` | 一键归档和主 spec 同步 |
| `<comet-intent-script>` | `/comet-classic` 入口意图识别和路由评分 |
| `<comet-resume-probe-script>` | 只读 Ambient Resume 探针，判断是否应恢复 active Comet workflow |

## 自动状态更新

guard 支持 `--apply` 参数，验证通过后自动更新 `.comet.yaml` 状态字段：

```bash
node "<comet-guard-script>" <change-name> <phase> --apply
```

`--apply` 内部委托给状态机 transition。需要直接表达状态事件时使用：

```bash
node "<comet-state-script>" transition <change-name> open-complete
node "<comet-state-script>" transition <change-name> design-complete
node "<comet-state-script>" transition <change-name> build-complete
node "<comet-state-script>" transition <change-name> verify-pass
node "<comet-state-script>" transition <change-name> verify-fail
node "<comet-state-script>" transition <change-name> archive-confirm
node "<comet-state-script>" transition <change-name> archive-reopen
node "<comet-state-script>" transition <change-name> archived
node "<comet-state-script>" transition <change-name> preset-escalate
```

归档完成由 `node "<comet-archive-script>" <change-name>` 负责；OpenSpec 会先把 change 移到带日期前缀的归档目录，再由 Comet 完成状态记录。预归档确认使用 `archive-confirm` 或 `archive-reopen`；不要在归档流程之外手动执行 `archived` transition。

## 解析下一步

阶段守卫推进 phase 后，用 `next` 子命令解析是否自动调用下一个 skill：

```bash
node "<comet-state-script>" next <change-name>
```

输出 `NEXT: auto|manual|done` + `SKILL: <skill-name>`（`done` 时省略）+ `HINT`（仅 `manual` 时）。`auto_transition: false` 时输出 `manual`，只暂停下一 skill 调用，不影响已发生的 phase 推进。

## 归档脚本

一键完成归档全部步骤：

```bash
node "<comet-archive-script>" <change-name>
```
