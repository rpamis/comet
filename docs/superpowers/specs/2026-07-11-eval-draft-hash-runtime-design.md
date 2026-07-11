# Eval draftHash 运行时解析设计

## 背景

Factory 生成的 `comet/eval.yaml` 使用 `metadata.draftHash: <current-bundle-hash>`，以避免 Bundle hash 将自身值作为输入形成循环依赖。Bundle hash 已在读取清单时把该字段规范化回占位符，因此生成文件必须继续保持稳定占位符。

Eval Harness 的 Python 清单解析器只接受 64 位小写 SHA-256。当前 `comet eval` 将生成清单原样传给 pytest，导致 `/comet-any` 生成后立即 collect 在清单解析阶段失败。

## 目标

- Factory 生成的原始清单继续保留 `<current-bundle-hash>`，Bundle hash 语义不变。
- `comet eval` 在运行前将占位符解析为所属 Bundle 的当前稳定 hash。
- 临时清单保持原始 Skill 路径语义，且无论成功或失败都清理。
- 普通合法清单不复制、不改写；非法或脱离 Bundle 的占位符清单给出可操作错误。

## 设计

1. 新增 Bundle 领域运行时清单准备模块。输入原始清单路径，输出实际传给 Eval Harness 的清单路径和幂等清理函数。
2. 读取 YAML；只有 `metadata.draftHash` 精确等于 `<current-bundle-hash>` 时进入解析流程。其他值保持原路径，由现有 Python schema 继续验证。
3. 从原始清单目录向上查找最近的 `bundle.yaml`，将其目录作为所属 Bundle 根。找不到或 Bundle 无法加载时，抛出包含原始清单路径的明确错误。
4. 使用现有 `loadBundle()` 与 `hashBundle()` 计算 hash。现有 hash 规范化逻辑保证结果不依赖最终写入的真实 `draftHash`。
5. 在系统临时目录创建运行清单，将 `draftHash` 替换为真实 hash。由于清单位置改变，将相对 `skill.source` 基于原清单目录解析为绝对路径后写入临时清单；原始文件保持不变。
6. `comet eval` 的 run/collect 共用准备结果，并在 `finally` 中执行清理。启动详情继续展示用户传入的原始清单目标；pytest 参数使用准备后的运行清单。

## 错误处理

- 找不到所属 Bundle：提示占位符只能用于 Comet 生成并仍位于 Bundle draft 内的清单。
- Bundle 加载或 hash 失败：保留原始错误作为原因，并指出无法解析 `draftHash`。
- 临时文件创建失败：不启动 `uv`。
- `uv` 或 pytest 失败：保留原错误，同时在 `finally` 清理临时目录。

## 测试

- 先证明当前占位符清单被原样传给 pytest，形成 RED。
- 验证生成 Bundle 的临时清单包含真实 64 位 hash，原始清单仍是占位符。
- 验证相对 `skill.source` 在临时清单中变为指向原 Skill 的绝对路径。
- 验证普通合法 hash 清单沿用原路径且无需清理。
- 验证脱离 Bundle 的占位符清单给出明确错误且不调用 `uv`。
- 验证 `uv` 抛错时临时目录仍被删除。
- 增加 Factory 生成清单到 `comet eval --collect` 参数准备链的回归覆盖。

## 发布

该修复属于现有 `0.4.0-beta.4` 的用户可见修复，在当前版本 Changelog 的 `Fixed` 下追加一条，不升级版本。
