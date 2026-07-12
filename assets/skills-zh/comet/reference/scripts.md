# 稳定 CLI 与内部脚本兼容说明

规范路径：`comet/reference/scripts.md`

本文件是 Comet 公开 CLI 与内部脚本兼容方式的单一事实来源。公开工作流必须优先使用稳定命令面：`comet state`、`comet guard`、`comet handoff`、`comet archive`。

## 公开工作流协议

正常安装和日常工作流直接使用 `comet` CLI，不需要定位 launcher，也不要向用户暴露内部 `classic` 命名：

```bash
comet state select <change-name>
comet state current
comet state clear-selection
comet state check <change-name> <phase>
comet guard <change-name> <phase> --apply
comet handoff <change-name>
comet archive <change-name>
```

当多个 active change 共存时，进入明确的 change 后先运行 `comet state select <change-name>`。普通源码写入只受该选择管辖；尚未选择时 hook 会阻塞并要求选择。单 active change 可继续自动归属。切换 branch/worktree 或选择失效后必须重新运行 `select`。

guard 的 `--apply` 在检查通过后推进状态。需要直接表达状态事件时使用 `comet state transition`；阶段推进后使用 `comet state next` 解析是否自动调用下一 Skill。

## 兼容、恢复与内部命令引导

以下脚本定位只用于旧版兼容、CLI 不可用时的恢复，以及 `/comet` 内部入口命令。正常公开工作流不得优先采用此方式。Comet 脚本随 Skill 包分发在 `comet/scripts/` 下；需要恢复时不要硬编码路径，而应定位一次并缓存环境变量：

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.mjs' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.mjs not found. Ensure the comet skill is installed." >&2
  return 1
fi
COMET_SCRIPTS_DIR="$(node "$COMET_ENV")"
COMET_STATE="$COMET_SCRIPTS_DIR/comet-state.mjs"
COMET_GUARD="$COMET_SCRIPTS_DIR/comet-guard.mjs"
COMET_HANDOFF="$COMET_SCRIPTS_DIR/comet-handoff.mjs"
COMET_ARCHIVE="$COMET_SCRIPTS_DIR/comet-archive.mjs"
COMET_INTENT="$COMET_SCRIPTS_DIR/comet-intent.mjs"
COMET_RESUME_PROBE="$COMET_SCRIPTS_DIR/comet-resume-probe.mjs"

# 脚本定位失败时停止流程
if [ -z "$COMET_SCRIPTS_DIR" ]; then
  echo "ERROR: Comet scripts not found. Ensure the comet skill is installed." >&2
  return 1
fi
```

只有进入上述兼容、恢复或内部命令路径时，Agent 才执行这些变量赋值。`COMET_INTENT` 和 `COMET_RESUME_PROBE` 仍是内部入口引导所需变量，不应全局移除。

| 变量 | 用途 |
|------|------|
| `COMET_STATE` | `.comet.yaml` 状态读写、phase 检查和恢复上下文 |
| `COMET_GUARD` | 阶段退出守卫和 `--apply` 状态推进 |
| `COMET_HANDOFF` | Design/Build handoff 上下文包生成 |
| `COMET_ARCHIVE` | 一键归档和主 spec 同步 |
| `COMET_INTENT` | `/comet` 入口意图识别和路由评分 |
| `COMET_RESUME_PROBE` | 只读 Ambient Resume 探针，判断是否应恢复 active Comet workflow |

## 自动状态更新

guard 支持 `--apply` 参数，验证通过后自动更新 `.comet.yaml` 状态字段：

```bash
comet guard <change-name> <phase> --apply
```

`--apply` 内部委托给状态机 transition。需要直接表达状态事件时使用：

```bash
comet state transition <change-name> open-complete
comet state transition <change-name> design-complete
comet state transition <change-name> build-complete
comet state transition <change-name> verify-pass
comet state transition <change-name> verify-fail
comet state transition <change-name> archive-confirm
comet state transition <change-name> archive-reopen
comet state transition <change-name> archived
comet state transition <change-name> preset-escalate
```

归档完成由 `comet archive <change-name>` 负责；OpenSpec 会先把 change 移到带日期前缀的归档目录，再由 Comet 完成状态记录。预归档确认使用 `archive-confirm` 或 `archive-reopen`；不要在归档流程之外手动执行 `archived` transition。

## 解析下一步

阶段守卫推进 phase 后，用 `next` 子命令解析是否自动调用下一个 skill：

```bash
comet state next <change-name>
```

输出 `NEXT: auto|manual|done` + `SKILL: <skill-name>`（`done` 时省略）+ `HINT`（仅 `manual` 时）。`auto_transition: false` 时输出 `manual`，只暂停下一 skill 调用，不影响已发生的 phase 推进。

## 归档脚本

一键完成归档全部步骤：

```bash
comet archive <change-name>
```
