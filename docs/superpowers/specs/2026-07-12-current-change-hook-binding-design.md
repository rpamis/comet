# Comet 多 Change Hook 当前执行上下文设计

**日期：** 2026-07-12  
**状态：** 已确认  
**关联 Issue：** [#196](https://github.com/rpamis/comet/issues/196)

## 背景

Comet 允许一个仓库同时存在多个未归档 active change，并要求用户在多个 change 中明确选择当前要继续的 change。当前 `comet-hook-guard.mjs` 对 OpenSpec 和 Superpowers 产物已有按路径或产物名归属的逻辑，但普通仓库源码没有 change 标识。

现有实现扫描 `openspec/changes/*/.comet.yaml` 中的全部未归档 change，并优先选择任意一个会阻塞源码写入的 change。结果是：即使用户明确选择的 change 已合法进入 `build`，只要另一个无关 change 仍处于 `open`、`design` 或尚未完成的 `archive`，整个工作树的源码写入仍会被拦截。

该行为同时影响 current-branch、branch 和 worktree 隔离模式。worktree 提供文件与 Git index 隔离，但如果该 worktree 中仍能看到多个 active change，当前 hook 仍缺少“这个执行上下文正在处理哪个 change”的信息。

## 目标

1. 让普通源码写入只受当前明确选择的 change 管辖。
2. 多个 active change 且没有有效选择时，安全失败并给出可执行提示。
3. 保持单 active change 用户的现有体验，无需额外选择命令。
4. 同时支持 current-branch、branch 和 worktree 模式，不依赖分支命名约定。
5. 保持 OpenSpec、Superpowers 和现有白名单路径的按 change 路由行为。

## 非目标

- 不支持多个 agent 在同一个工作树中并发修改源码。
- 不根据源码路径猜测它属于哪个 change。
- 不要求分支名与 change 名相同。
- 不把当前选择写入 `.comet.yaml`，因为它不是 change 生命周期状态。
- 不改变 `open`、`design`、`build`、`verify`、`archive` 各阶段本身的允许操作。

## 方案比较

### 方案 A：显式的工作树本地选择文件

在 `.comet/current-change.json` 中记录当前选择和选择时的分支，通过 `comet state select <name>` 管理。hook 对普通源码读取该选择。

优点：

- 与用户已经完成的 change 选择一致。
- 每个 worktree 天然拥有独立文件。
- 不依赖分支命名。
- 可以检测同一工作树切换分支后的陈旧选择。
- 对单 active change 保持向后兼容。

缺点：

- `/comet` 和阶段 Skill 必须在确定 change 后显式写入选择。
- 需要新增一个小型本地运行时文件及其生命周期命令。

### 方案 B：从 Git 分支名推断 change

根据当前分支名匹配 active change。

优点是没有额外状态文件。缺点是任意分支名、current-branch 模式、detached HEAD 和共享集成分支都无法可靠映射，且会引入未声明的命名协议。因此不采用。

### 方案 C：自动选择唯一的 `build` 或 `verify` change

如果所有 active change 中只有一个允许源码写入的 change，就让它管辖普通源码。

该方案能修复“一个 build 加若干 open”这一表象，但当用户正在处理 open change、仓库中另有 build change 时会错误放行源码写入。因此不采用。

## 选定架构

采用方案 A。新增独立模块负责选择文件的读写与校验，状态命令只提供用户入口，hook 只消费已验证的选择结果。

### 选择文件

规范路径：

```text
.comet/current-change.json
```

文件格式：

```json
{
  "version": 1,
  "change": "change-a",
  "branch": "feature-a"
}
```

字段语义：

- `version`：固定为 `1`，为后续格式演进保留明确边界。
- `change`：OpenSpec 兼容的 kebab-case active change 名。
- `branch`：选择时的当前分支名；detached HEAD 或无法读取 Git 分支时为 `null`。

`.comet/` 已由仓库 `.gitignore` 忽略。该文件不进入提交，也不写入 change 自身的 `.comet.yaml`。

### 状态命令

新增命令：

```bash
comet state select <change-name>
comet state current
comet state clear-selection
```

`select` 必须：

1. 验证 change 名合法。
2. 验证 `openspec/changes/<name>/.comet.yaml` 存在。
3. 严格读取状态并确认 change 尚未归档。
4. 获取当前 Git 分支；无法获取时记录 `null`，而不是猜测。
5. 通过临时文件加 rename 原子写入选择文件。

`current` 必须读取并验证选择；有效时输出 change 名，无有效选择时以非零状态返回可执行原因。

`clear-selection` 必须幂等删除选择文件。文件不存在时仍成功。

### 有效性校验

选择只有同时满足以下条件才有效：

1. JSON 结构和版本合法。
2. change 名符合 OpenSpec 兼容格式。
3. 对应 active change 目录和 `.comet.yaml` 仍存在。
4. change 尚未归档。
5. 如果文件记录了非空 `branch`，它必须与当前分支一致。

分支不一致、change 缺失、change 已归档或文件损坏时，hook 不得继续使用该选择。损坏或无法安全读取的选择文件必须失败关闭，并输出具体原因；正常的“尚未选择”则进入 active change 数量判断。

## Hook 决策流程

### 普通源码

1. 扫描全部未归档 active change。
2. 没有 active change：允许写入。
3. 读取并验证当前选择。
4. 有有效选择：只使用所选 change 的 phase 和状态执行现有阶段判断。
5. 没有选择且只有一个 active change：自动使用该 change，保持向后兼容。
6. 没有选择且存在多个 active change：阻塞写入，列出 active change，并提示先运行 `comet state select <name>`。
7. 选择的 change 为合法 `build` 或 `verify`：允许普通源码写入。
8. 选择的 change 为 `open`、`design` 或未完成的 `archive`：按该 change 自身阶段阻塞。
9. full workflow 的 build change 若 `design_doc` 为空，继续按非法跳转规则阻塞。

“多个 active change 未选择”是独立错误，不伪装成某个 change 的 `Current phase`，避免用户误以为字母序靠前的 change 是当前上下文。

### OpenSpec 路径

`openspec/changes/<name>/...` 继续由路径中的 `<name>` 管辖。新 change 尚未创建 `.comet.yaml` 时仍按 open 产物规则处理，不依赖当前选择。

### Superpowers 产物

`docs/superpowers/...` 继续优先匹配 `.comet.yaml` 已记录的 `design_doc`、`plan`、`verification_report`，其次按 change 名边界匹配。未匹配产物不得借当前选择静默放行。

### 白名单路径

`.comet/`、`.superpowers/`、`.claude/`、根目录 Markdown 等现有白名单保持不变，确保选择命令和工作流产物可以在阻塞阶段正常写入。

## 工作流接入

### `/comet` 路由

当 intent 或 resume probe 已解析出明确 change 后，在进入对应阶段 Skill 前运行：

```bash
comet state select <name>
```

多个 active change 且用户未明确 change 时，仍先询问用户，不得提前写入选择。

### 直接阶段 Skill

用户直接调用 `/comet-open`、`/comet-design`、`/comet-build`、`/comet-verify` 或 `/comet-archive` 并提供 change 名时，阶段 Skill 的第一个状态操作必须是 `select`。hotfix 和 tweak 创建或恢复 change 后也必须建立选择。

### 生命周期

- 选择另一个 change 时，`select` 原子替换旧文件。
- 同一工作树切换分支后，分支校验使旧选择失效，必须重新选择。
- change 归档后，归档流程运行 `clear-selection`；即使清理未执行，已归档校验也会阻止旧选择继续生效。
- 单 active change 且无选择时仍可自动工作，避免升级后强制所有用户执行新命令。

## 错误处理

### 多 change 未选择

hook 返回退出码 `2`，输出：

- 当前目标文件。
- active change 名列表。
- `comet state select <change-name>` 提示。
- 不把任何一个 change 的 phase 标为当前 phase。

### 陈旧选择

分支变化、change 缺失或已归档时，输出选择失效原因。若此时仅剩一个 active change，可以按单 change 兼容规则使用它；若仍有多个 active change，则要求重新选择。

### 损坏或不可读取的选择文件

JSON 损坏、非法字段、权限错误等不是“尚未选择”。hook 必须失败关闭并报告文件问题，不能退回自动选择后继续写源码。

## 安全与并发边界

- 选择文件中的 change 名在参与路径拼接前必须验证，防止路径穿越。
- 写入采用原子 rename，避免 hook 读取半写文件。
- 不支持同一工作树内多个 agent 同时选择不同 change 并写源码；后写入的选择会替换前者。
- 真正并行实施必须使用“一条分支 + 一个 worktree + 一个当前 change”。每个 worktree 的 `.comet/current-change.json` 相互独立。

## 测试策略

### 选择状态测试

- `select` 写入合法、版本化且包含当前分支的 JSON。
- 不存在、已归档或非法 change 不能被选择。
- `current` 返回有效选择。
- `clear-selection` 幂等。
- 原子写失败不会留下临时文件或截断旧选择。

### Hook 回归测试

- `build + open` 未选择时报告多 change 歧义。
- `build + design` 选择 build 后允许源码写入。
- `build + pending archive` 选择 build 后允许源码写入。
- 选择 open change 时，即使另一个 change 在 build，仍阻塞源码写入。
- 单 active change 无选择时保持原有阶段行为。
- 已归档 change 不参与歧义判断。
- 选择指向缺失或已归档 change 时按陈旧选择处理。
- 切换分支后旧选择失效。
- full build 缺少 `design_doc` 仍阻塞。
- OpenSpec、Superpowers 和白名单路径既有测试继续通过。

### 发布资产与仓库检查

- 运行 Classic runtime 构建，将 TypeScript 源码同步到生成资产。
- 运行 focused hook/state 测试和 `comet-scripts.test.ts`。
- 运行格式、lint、TypeScript build 和全量单元测试。
- 对生成资产运行仓库 manifest/架构约束测试。

## 文档与发布说明

Skill 内容先更新中文 `assets/skills-zh/`，用户语义确认后同步英文 `assets/skills/`。更新脚本命令参考、阶段守卫规则和 change 路由说明，不修改 Superpowers 或 OpenSpec 的原始 Skill。

该修复改变多 active change 用户可感知的 hook 行为，应在当前高于 master 的版本 Changelog 中追加一条英文 `Fixed` 项，并关联 #196。版本号继续与 `package.json` 保持一致，不为该修复单独增加开发过程版本。

## 验收标准

1. 用户选择合法 build change 后，其他 active change 的 `open`、`design` 或未完成 `archive` 不再阻塞该 build change 的普通源码写入。
2. 多个 active change 且没有有效选择时，hook 明确阻塞并要求选择。
3. 选择处于阻塞阶段的 change 时，其他 build change 不会让源码写入被错误放行。
4. branch、current-branch 和 worktree 模式使用同一显式选择协议。
5. 单 active change、OpenSpec 产物、Superpowers 产物和白名单路径保持兼容。
6. TypeScript 源码、生成 runtime、双语 Skill 文档和 Changelog 同步。
