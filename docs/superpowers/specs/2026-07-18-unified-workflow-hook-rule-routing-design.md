# Comet 统一 Workflow Hook 与 Rule 路由设计

## 背景

Comet 允许项目启用 Native、Classic，或同时启用两者。`both` 的产品语义是：同一个项目可以为不同需求选择不同 workflow，但单个需求只能归属 Native 或 Classic 之一。

当前安装逻辑在 `both` 下会同时安装 Native Hook、Classic Hook、Native Rule 和 Classic Rule。这样把“项目具备哪些 workflow 能力”误当成了“每次写入同时受哪些 workflow 管理”。当 Native 和 Classic 各自保留活跃 change 时，一次普通源码写入会同时进入两个 Guard；另一个需求所属 workflow 可能误拦当前需求。两份常驻 Rule 也会同时进入模型上下文，形成软性指令冲突。

本设计把能力安装、默认入口和当前需求归属拆开，并将平台侧收敛为一个 Hook 和一个 Rule。

## 目标

- 保留 `workflow: both`。
- 同一项目可以保留多个 Native/Classic 活跃 change，但同一工作区同一时刻只有一个 current change。
- 一次平台写入事件最多进入一个 workflow Guard。
- 所有 Hook 平台共享相同的 workflow 路由语义。
- 所有 Rule 平台只安装一份常驻 Rule。
- Native 和 Classic 保持独立的状态、阶段和产物，不互相转换或组合。
- 兼容已发布的 Classic current-change selection 和 Hook 安装形态。
- 保留用户自己的 Hook、Rule 和平台配置；迁移失败必须显式报告。

## 非目标

- 不允许单个需求同时使用 Native 与 Classic。
- 不把 Native change 转换成 Classic change，或反向转换。
- 不支持同一个工作区内两个会话并发写两个不同 current change；并发开发使用独立 branch/worktree。
- 不统一 Native 与 Classic 的阶段模型或内部 Guard 规则。
- 不让 Rule 成为第二套可执行状态机；硬性裁决仍由 Runtime Hook 完成。
- 不为不支持 Hook 或 Rule 的平台伪造能力。

## 核心语义

项目状态明确区分三件事：

| 状态               | 含义                                |
| ------------------ | ----------------------------------- |
| `workflows`        | 项目启用了哪些 workflow 能力        |
| `default_workflow` | `/comet` 默认进入哪个 workflow      |
| current selection  | 当前需求由哪个 workflow/change 管理 |

`workflows` 和 `default_workflow` 不能用于推断已有需求的归属。Hook 和 Rule 处理已有需求时只服从有效的 current selection；没有 selection 时只能根据唯一活跃 change 做只读推断。

为兼容未创建新版项目配置的 Classic 旧项目：当 `.comet/config.yaml` 不存在或仅包含旧 Classic 字段时，Router 只启用 Classic legacy fallback；该回退不能启用 Native，也不能把项目解释为 `both`。

## 方案选择

### 采用：统一 Router、共享 selection、统一 Rule

每个平台只安装一个 Router Hook。Router 规范化平台载荷、解析 current selection，并只调用一个 Native 或 Classic Guard。所有 Rule 平台只安装一份轻量路由 Rule。

该方案将三类变化隔离在清晰的 seam 上：

- 平台差异只存在于 Hook Adapter。
- workflow 差异只存在于 Native/Classic Guard。
- 当前需求归属只存在于共享 selection。

### 不采用：统一 Hook、保留双 Rule

该方案能解决硬阻断冲突，但两套常驻 Rule 仍会同时进入上下文，继续产生软性冲突和噪声，只适合作为短期迁移形态。

### 不采用：保留双 Hook并让非当前 Hook 跳过

该方案改动较小，但每个平台仍需维护两份命令、两套载荷解析、两套输出协议和清理逻辑。workflow 识别一旦漂移，就会重新产生误拦，无法形成稳定的深模块。

## 共享 Current Selection

### 文件与格式

共享 selection 使用现有项目级路径：

```text
.comet/current-change.json
```

格式升级为：

```json
{
  "schema": "comet.selection.v2",
  "workflow": "native",
  "change": "hook-router",
  "branch": null
}
```

字段约束：

- `schema` 必须为 `comet.selection.v2`。
- `workflow` 必须为 `native` 或 `classic`，且必须包含在项目 `workflows` 中。
- `change` 必须满足对应 workflow 的名称和 containment 校验，并指向活跃、未归档 change。
- `branch` 在 Classic selection 中保留现有分支绑定语义；Native 写入 `null`，不为读取 Git 分支引入新的外部进程依赖。

共享 selection 由 `domains/comet-entry` 内的模块统一读写和验证。Native/Classic 可以提供 workflow 专属 change 校验 Adapter，但不再各自拥有项目级归属文件。

### 生命周期

1. `init --workflow both` 只安装两种能力，不创建 selection。
2. `/comet` 继续由 `default_workflow` 路由；显式 `/comet-native` 和 `/comet-classic` 不受默认值限制。
3. Native `new/select/resume` 成功验证 change 后写入 `workflow: native`。
4. Classic 创建/恢复流程和 `comet state select` 成功验证 change 后写入 `workflow: classic`。
5. 后一次成功 selection 表示用户已切换当前需求。
6. 归档当前选中的 workflow/change 时清除 selection；归档其他 change 不修改 selection。
7. 修改 `default_workflow` 不覆盖有效 selection。

### 无 Selection 时的解析

Router 对两个 workflow 的活跃 change 进行有预算、只读的枚举：

- 活跃 change 总数为 0：返回 `none`，Hook 放行。
- 活跃 change 总数为 1：返回 `inferred`，仅本次只读归属，不由 Hook 写 selection。
- 活跃 change 总数大于 1：返回 `ambiguous`，Hook 失败关闭并要求选择。

即使多个 change 全部来自同一个 workflow，也必须选择；Router 不按名称、时间、`default_workflow` 或目录顺序猜测。

### 失效处理

以下情况返回 `stale` 并失败关闭：

- selection JSON 无法读取或 schema/字段非法。
- `workflow` 未启用。
- change 不存在、已归档或状态无法安全读取。
- Classic selection 的 branch 与当前 branch 不一致。

错误必须包含确定性的恢复动作，例如重新运行 `/comet-native`、`/comet-classic` 或相应 select 命令。

## 单 Hook 架构

### 平台入口

每个平台只安装一个命令：

```text
comet-hook-router.mjs --project-root <root> --platform <platform-id>
```

`--platform` 由安装 Adapter 写入，不允许 Runtime 根据载荷猜测平台。未知或缺失平台 ID 是配置错误，不能回退到其他平台格式。

项目级 Hook 使用安装时解析的绝对 project root。全局 Hook 不得把用户 home 当成固定 project root；它从 Hook 当前工作目录向上发现实际项目，未发现 Comet 项目时直接放行。项目发现必须复用现有 Comet project discovery，不在平台 Adapter 中各写一套路径逻辑。

Router runtime 位于 workflow 中立的 Comet 入口资产中。现有 Native/Classic Guard 继续作为内部实现参与生成，不再分别作为平台 managed Hook。

### 规范化接口

平台 Adapter 将原始 stdin、环境变量和平台工具名转换为：

```ts
interface CometHookRequest {
  intent: 'write' | 'non-write' | 'unknown';
  targets: string[];
  toolName: string | null;
}

interface CometHookDecision {
  allowed: boolean;
  reason: string;
  workflow?: 'native' | 'classic';
  change?: string;
  phase?: string;
}
```

Adapter 只负责：

- 解析平台载荷。
- 提取单文件、多文件和 patch 中的全部目标。
- 将抽象 decision 转成平台要求的退出码、stdout 和 stderr。

Adapter 不读取 Comet 状态，也不包含阶段语义。

### Router 职责

Router：

1. 读取项目配置与共享 selection。
2. 解析并验证当前需求所有者。
3. 将规范化请求交给恰好一个 Guard。
4. 返回平台无关 decision。

Router 不并行或顺序调用两个 Guard。核心防回归不变量是：

```text
一次平台 Hook 事件最多调用一个 workflow Guard
```

### Workflow Guard 接口

Native 与 Classic Guard 对外统一为类似接口：

```ts
inspectWrite({
  projectRoot,
  change,
  request
}): Promise<CometHookDecision>
```

Guard 只处理自身领域规则，不再负责：

- 读取 stdin 或环境变量。
- 识别平台或生成平台输出。
- 决定当前 workflow。
- 枚举另一个 workflow 的 change。
- 设置进程退出码。

### 写入裁决

- 多目标写入整体判断；任一项目内目标不允许，整个写入拒绝。
- 明确的非写工具直接放行。
- 有 current change 且写入目标无法解析：仅在该 workflow 明确允许普通项目写入的阶段放行，即 Native Build、Classic Build/Verify；其他阶段失败关闭。
- selection 损坏、失效或归属不明确时失败关闭。
- 没有活跃 Comet change 时不影响普通开发。
- Native/Classic 控制产物按各自精确路径判断，不使用“所有点文件均放行”的宽泛白名单。
- Router 或 Guard 内部异常时失败关闭，并输出可执行的恢复提示。

平台拒绝由 Adapter 按各自协议生成。例如 Copilot 使用结构化 denial；其他平台不得统一假设退出码 `2` 一定表示拒绝。

## 单 Rule 架构

所有支持 Rule 的平台只安装一个语言对应文件：

```text
comet-workflow-guard.md
```

平台特有的 `.md`、`.mdc`、`.instructions.md` 包装继续由现有 Rule 安装 Adapter 完成。

统一 Rule 只保留稳定的跨 workflow 不变量：

1. `workflows` 表示能力，`default_workflow` 表示默认入口，current selection 表示当前需求。
2. 每轮开始或上下文恢复后先确认 current selection。
3. 只加载并遵循选中 workflow 的阶段规则。
4. selection 缺失且存在多个活跃 change 时停止并要求选择。
5. 不使用 `default_workflow` 猜测已有需求归属。
6. Hook 拒绝时恢复对应 workflow，不绕过 Hook。

Rule 只保留简短阶段写入表：

| Workflow | 禁止普通实现写入       | 允许普通实现写入 |
| -------- | ---------------------- | ---------------- |
| Native   | Shape、Verify、Archive | Build            |
| Classic  | Open、Design、Archive  | Build、Verify    |

Classic 的确认点、Superpowers 协议和恢复细节继续位于 Classic Skill/reference；Native 的证据、自动推进和恢复细节继续位于 Native Skill/reference。统一 Rule 在上下文恢复后把模型送回正确 Skill，但不复制两套完整工作流。

不支持 Rule 的平台仍可依赖 Skill 与 Hook；安装和 Doctor 不得将 Rule 报告为已安装。

## 安装与迁移

### 安全顺序

更新顺序必须避免“新 selection + 旧 Hook”：

1. 严格读取并校验现有 Hook JSON、Rule 路径和 selection。
2. 安装新的 Router runtime。
3. 原子替换平台 Hook 配置，使 Router 接管。
4. 原子迁移 Classic v1 selection。
5. 写入统一 Rule。
6. 删除多文件平台和旧安装位置中残留的 managed Hook/Rule。
7. 更新安装注册信息。

Router 必须兼容只读解析 Classic v1 selection，因此在步骤 3 与 4 之间中断仍然安全。selection v2 只会在 Router 已接管后写入，旧 Classic Hook 无需理解 v2。

### Classic v1 Selection

已发布格式：

```json
{
  "version": 1,
  "change": "example",
  "branch": "feature/example"
}
```

确定性迁移为：

```json
{
  "schema": "comet.selection.v2",
  "workflow": "classic",
  "change": "example",
  "branch": "feature/example"
}
```

Native 尚未发布，直接切换到共享 v2 selection，不保留长期双读层。

### Hook 配置迁移

单 JSON 文件平台在内存中完成合并后原子替换：

- 移除旧 Native、Classic 和重复 Router managed 条目。
- 保留用户 Hook、matcher 和组 metadata。
- 插入一个当前 Router Hook。

Kiro 等多文件平台无法跨文件原子替换：先写 Router 文件，再删除两个旧 managed 文件。Doctor 将新旧文件并存识别为可安全修复的中间态。

### Rule 迁移

先写统一 Rule，再删除两个旧 managed Rule。只操作 Comet 已知文件名，不按目录或内容模糊删除用户 Rule。

## 生命周期命令行为

### Init

- `native`、`classic`、`both` 均只安装一个 Router Hook 和一个统一 Rule。
- `both` 只改变配置中的 `workflows` 和可用 workflow 能力。
- 不创建 current selection。

### Update

- 将旧双 Hook/双 Rule 收敛为单份。
- 严格 JSON 解析失败时不覆盖用户文件。
- 迁移失败必须出现在最终命令结果中。
- 只能自动迁移确定性的 Classic v1 selection；不能猜测 Native/Classic 归属。

### Doctor

Doctor 检查：

- Router runtime 存在且为当前版本。
- 每个平台恰好存在一个 managed Router Hook。
- 不存在旧 Native/Classic managed Hook。
- 每个平台最多存在一个 managed Rule。
- selection schema、workflow、change、branch 有效。
- selection workflow 已启用，change 活跃且未归档。
- `both` 项目中多个活跃 change 是否缺少 selection。
- 平台命令是否携带正确 `--platform`。

`doctor --repair` 可安全执行：

- 重装 Router Hook 和统一 Rule。
- 删除旧 managed Hook/Rule。
- 迁移确定性的 Classic v1 selection。
- 清除指向不存在或已归档 change 的 selection。

Doctor 不自动选择 Native 或 Classic；多个候选必须交给用户。

### Uninstall

- 同时识别新 Router 和旧 Native/Classic Hook。
- 同时识别统一 Rule 和旧双 Rule。
- 仅删除 Comet 管理的条目和文件。
- 保留用户 Hook、Rule、matcher metadata 和其他配置。
- 清理失败必须传递到最终结果，并保留可重试目标。

## 测试策略

### 平台矩阵

对仓库声明的全部 Hook 平台分别验证：

- init 安装。
- update 幂等。
- doctor 检查与 repair。
- uninstall 清理。
- 用户 Hook 保留。
- 非法配置不覆盖。
- 单文件、多文件、patch、非写工具、malformed payload。
- allow 与 deny 的平台输出。

平台测试必须使用真实载荷 fixture，不能只断言配置文件中出现了 Router 命令。实现时应根据各平台当前官方 Hook 契约更新 fixture 和输出断言。

### 路由矩阵

| 场景                                     | 预期                 |
| ---------------------------------------- | -------------------- |
| Native-only + Native selection           | 只调用 Native Guard  |
| Classic-only + Classic selection         | 只调用 Classic Guard |
| both + Native selection                  | Classic Guard 不执行 |
| both + Classic selection                 | Native Guard 不执行  |
| both + 两边有活跃 change + 无 selection  | 阻断并要求选择       |
| 无 selection + 全项目只有一个活跃 change | 只读推断唯一所有者   |
| selection 指向 archived/missing change   | 失败关闭             |
| `default_workflow` 与 selection 不同     | 服从 selection       |
| 没有活跃 change                          | 放行                 |

加入直接防回归测试：任意一次 Router 调用的 workflow Guard 调用计数不得大于 1。

### Rule 与迁移

- 所有 Rule 平台只安装一个统一 Rule。
- `native`、`classic`、`both` 的 managed Hook/Rule 数量相同。
- Rule 中英文行为一致。
- Rule 明确区分 enabled/default/current 三种语义。
- 旧双 Hook/Rule 可由 update、doctor 和 uninstall 识别并清理。
- Classic v1 selection 可原位迁移；非确定性归属不会被自动选择。
- 迁移任一步骤中断后，下一次 update/doctor 可以收敛到唯一 Router/Rule。

## 验收标准

实现完成后必须同时满足：

```text
一个项目可以启用 Native + Classic
一个需求只有一个 workflow + change 所有者
一个平台写入事件只进入一个 Router
Router 只调用一个 Guard
所有 Rule 平台只注入一份 Rule
所有 Hook 平台共享同一套归属语义
```

完整验证至少包括聚焦测试、格式检查、Lint、TypeScript 构建、生成 runtime 一致性检查和全量测试。
