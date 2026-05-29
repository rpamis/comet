---
name: comet-auto
description: "Comet Auto-Pilot：自动续接未完成的 change 并按预配置策略全自动推进流水线。由 SessionStart Hook 自动触发，无需手动调用。"
---

# Comet Auto-Pilot

自动检测活跃的 Comet change，按 `comet-auto.yaml` 配置策略自动推进 5 阶段流水线（open → design → build → verify → archive），仅在阻断条件触发时暂停等待用户。

## 触发方式

由 SessionStart Hook 自动触发，或手动 `/comet-auto` 调用。

## 入口流程

### Step 0: 环境初始化

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found. Ensure the comet skill is installed." >&2
  return 1
fi
. "$COMET_ENV"
```

### Step 1: 循环防护标记

在开始自动流程前，写入循环防护标记：

```bash
echo "<current-change-name>" > openspec/changes/.comet-auto-active
```

SessionStart Hook 检测到此标记存在时会跳过上下文注入，防止 phase transition 触发重复注入。

### Step 2: 加载配置

按优先级合并配置：change 级（`.comet.yaml` 内 `auto:` 字段）> 项目级（`comet-auto.yaml`）> 全局默认。

```yaml
# 默认配置
auto:
  enabled: true
  confirm_design: auto_with_diff
  isolation: branch
  build_mode: subagent-driven-development
  archive: true
  max_retry: 2
  max_consecutive_failures: 5
  pause_on:
    - verify_fail
    - build_error
    - spec_drift_large
    - conflict_detected
    - phase_jump
    - external_commit
    - preset_upgrade
```

### Step 3: 发现活跃 Change

运行 `openspec list --json` 获取所有活跃 change。

**决策表**：

| 活跃 change 数 | 行为 |
|---------------|------|
| 0 | 清理 `.active` 标记，退出（无需操作） |
| 1 | 直接续接该 change |
| 多个 | 按优先级排序后依次处理 |

### Step 4: 优先级排序

按以下优先级（高→低）：

1. `verify_result: fail`（验证失败，需修复）
2. `phase: verify`（待验证）
3. `phase: build`（构建中）
4. `phase: design`（设计中）
5. `phase: open`（刚创建）

取最高优先级的一个 change 开始处理。

### Step 5: 阶段判定与路由

读取 `.comet.yaml` 的 `phase` 字段：

| phase | 路由到 | 自动模式行为 |
|-------|-------|------------|
| `open` 或无 `.comet.yaml` | `/comet-open` | 创建 change + 初始化状态 |
| `design` | `/comet-design` | 按 `confirm_design` 策略处理 |
| `build` | `/comet-build` | 按预配置跳过决策点 |
| `verify` | `/comet-verify` | 自动执行验证 |
| `archive` | `/comet-archive` | 自动归档 |

传递 `auto_config` 参数给子 Skill。

### Step 6: Change 完成后

1. 该 change 归档完成 → 删除该 change 的 `.comet/auto/` 目录（含 `.active`）
2. 如果还有其他活跃 change → 返回 Step 3 续接下一个
3. 所有 change 处理完毕 → 删除 `openspec/changes/.comet-auto-active` 标记
4. 退出

---

## 阻断处理协议

遇到 `pause_on` 列表中条件时：

1. **检查重试策略**：`max_retry`（per-phase）和 `max_consecutive_failures`（cross-phase）
2. **可重试** → 指数退避等待后重试，记录到 `decisions.jsonl`
3. **重试耗尽** → 暂停，输出阻断原因和当前状态摘要
4. **用户响应后** → 继续执行或跳过

### 审计日志

每次自动决策写入 `openspec/changes/<name>/.comet/auto/decisions.jsonl`：

```jsonl
{"ts":"ISO8601","change":"name","phase":"build","decision":"retry_build_error","attempt":1,"reason":"tsc compilation failed"}
{"ts":"ISO8601","change":"name","phase":"design","decision":"auto_confirm_design","mode":"auto_with_diff","diff_hash":"abc123"}
```

---

## 多 Change 冲突检测

在进入 build 阶段前，检查多 change 是否修改同一文件：

```bash
for change in $(openspec list --json | python3 -c "import json,sys;[print(c['name']) for c in json.load(sys.stdin)]"); do
  git diff --name-only "$change"...main 2>/dev/null
done | sort | uniq -d
```

如有冲突 → `conflict_detected` → 暂停，列出冲突 change 和文件。

---

## Dry-Run 模式

手动调用 `/comet-auto --dry-run` 时：

- 不修改任何文件或状态
- 不写入 `.active` 标记
- 输出将执行的操作预览

---

## 清理

`/comet-auto clean`：清理所有遗留的 `.active` 标记和 `.comet/auto/` 运行时目录。

---

## 与手动模式的兼容

用户随时可以手动输入 `/comet` 接管控制。auto-pilot 在以下情况自动降级为提醒模式：

- `comet-auto.yaml` 中 `enabled: false`
- 用户在当前会话中手动调用了任意 comet 子命令
- 检测到 `preset_upgrade` 条件
