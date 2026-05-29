---
name: comet-archive
description: "Comet 阶段 5：归档。用 /comet-archive 调用。同步 delta spec 到主 spec，归档 change。"
---

# Comet 阶段 5：归档（Archive）

## 前置条件

- 验证已通过（阶段 4 完成）
- 分支已处理
- `openspec/changes/<name>/.comet.yaml` 中 `verify_result: pass`

## 步骤

### 0. 入口状态验证（Entry Check）

执行入口验证：

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found. Ensure the comet skill is installed." >&2
  return 1
fi
. "$COMET_ENV"
bash "$COMET_STATE" check <name> archive
```

验证通过后继续 Step 1。

### 1. 执行归档

**手动模式**：运行归档脚本前需用户确认。

**Auto-Pilot 模式**：当 `auto_config.archive: true` 时自动执行，标注 `[AUTO]`，不询问确认。

```bash
bash "$COMET_ARCHIVE" "<change-name>"
```

脚本自动执行：
1. 入口状态验证（phase=archive, verify_result=pass, archived=false）
2. Delta spec 同步到主 spec
3. Design doc 前置元数据标注（archived-with, status）
4. Plan 前置元数据标注（archived-with）
5. 移动 change 到归档目录
6. 通过 `comet-state transition <archive-name> archived` 更新 `archived: true`

如脚本返回非零退出码，报告错误并停止。
如脚本返回零退出码，归档完成。

Auto-Pilot 归档完成后记录审计：

```bash
echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"change\":\"<name>\",\"phase\":\"archive\",\"decision\":\"auto_archive\"}" >> openspec/changes/archive/YYYY-MM-DD-<name>/.comet/auto/decisions.jsonl 2>/dev/null || true
```

当待同步的 delta spec 与已有主 spec 不一致时，脚本会在覆盖前打印 unified diff 预览，帮助确认归档同步内容。

如需预览而不实际执行，使用 `--dry-run` 参数。

### 2. Auto-Pilot 清理

归档成功后，Auto-Pilot 模式清理运行时文件：

```bash
# 清理当前 change 的 auto 运行时目录
rm -rf openspec/changes/archive/YYYY-MM-DD-<name>/.comet/auto/

# 检查是否还有其他活跃 change
ACTIVE_COUNT=$(openspec list --json 2>/dev/null | python3 -c "import json,sys;print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

if [ "$ACTIVE_COUNT" -eq 0 ]; then
  # 清理全局 auto 标记
  rm -f openspec/changes/.comet-auto-active
fi
```

### 3. 生命周期闭环

Spec 生命周期在此完成：
```
brainstorming → delta spec → 实施 → 验证 → 主 spec 覆盖 → design doc 标注 → 归档
```

## 退出条件

- 归档脚本执行成功（退出码 0）
- 归档目录 `openspec/changes/archive/YYYY-MM-DD-<change-name>/` 存在
- 归档后的 `.comet.yaml` 中 `archived: true`
- Auto-Pilot 模式：auto 运行时文件已清理

## 完成

Comet 流程全部完成。如需开始新工作，调用 `/comet` 或 `/comet-open`。
