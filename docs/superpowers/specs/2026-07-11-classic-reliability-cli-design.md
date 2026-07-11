# Classic 可靠性与稳定 CLI 设计

## 背景

本设计统一解决以下四个 beta4 问题：

- [#185](https://github.com/rpamis/comet/issues/185)：归档注释给 Markdown 文件增加 EOF 空行，导致 `git diff --check` 失败。
- [#186](https://github.com/rpamis/comet/issues/186)：Agent 需要发现或猜测 `comet-state.mjs`、`comet-archive.mjs` 等内部脚本路径。
- [#187](https://github.com/rpamis/comet/issues/187)：混合仓库中无法统一识别普通 OpenSpec change 与 Comet-managed change，也无法稳定推荐正确归档入口。
- [#192](https://github.com/rpamis/comet/issues/192)：无法推断构建命令的项目没有可审计的 Guard 完成路径，只能使用 `COMET_SKIP_BUILD=1` 绕过。

目标是在不复制 Classic 业务规则、不恢复任意配置命令执行、不中断旧 launcher 兼容性的前提下，提供稳定公共命令、可靠归档输出、混合 change 状态和持久化手工检查证据。

## 范围

### 包含

- 修复 Classic archive 对 Superpowers Markdown 的 EOF 格式处理。
- 公开 `comet state`、`comet guard`、`comet handoff`、`comet archive` 四个顶层命令。
- 在 `comet state` 下增加 `record-check`，记录已经执行过的 build/verify 命令结果。
- 扩展 `comet status`，默认显示普通 OpenSpec 与 Comet-managed change。
- 更新中英文 Comet Skill 文档和 beta4 Changelog。

### 不包含

- 不公开 `validate`、`intent`、`resume-probe`、`hook-guard` 等内部命令。
- 不删除现有 `.mjs` launcher。
- 不恢复 `.comet/config.yaml` 的 `build_command` 或 `verify_command`。
- 不自动执行 `record-check` 中保存的命令。
- 不实现 #188/#189 的子模块 ownership、脏状态分类或工作树内容指纹。

## 架构

### 领域层保持唯一业务实现

`domains/comet-classic/` 继续拥有 state、guard、handoff、archive 的全部规则。app 层只负责 Commander 注册、参数转发、输出和退出码，不重新实现 Classic 行为。

内部 launcher 与新的公共 CLI 都调用同一个领域 dispatcher：

```text
internal .mjs launcher ─┐
                       ├─> runClassicCli() ─> Classic domain handlers
public comet commands ─┘
```

### 归档 Markdown 格式

归档注释处理从命令流程中收敛为一个可独立测试的转换单元：

```text
读取 Markdown
→ 识别 frontmatter
→ 删除旧 archived-with
→ 写入 archived-with/status
→ 只清理 EOF 多余空白行
→ 追加恰好一个 LF
→ 写回
```

正文内部空行不变；输出统一为 LF；重复处理必须字节级幂等。

### 公共 CLI 适配

公开以下稳定入口：

```bash
comet state [args...]
comet guard [args...]
comet handoff [args...]
comet archive [args...]
```

app 层提供统一适配函数：

```ts
type PublicClassicCommand = 'state' | 'guard' | 'handoff' | 'archive';

async function runClassicFacade(command: PublicClassicCommand, args: string[]): Promise<number>;
```

它将 `[command, ...args]` 传给 `runClassicCli()`，原样写出 stdout/stderr，并保留返回退出码。参数通过 Commander 的 variadic/passthrough 方式传递，`--json`、`--apply`、`--dry-run` 不得被 app 层改写或吞掉。

### 持久化命令检查证据

公共命令格式：

```bash
comet state record-check <change> build \
  --command "python scripts/build.py" \
  --exit-code 0

comet state record-check <change> verify \
  --command "python -m pytest" \
  --exit-code 0
```

`record-check` 只记录已经发生的执行，不执行 command。记录追加到当前 Run trajectory：

```json
{
  "sequence": 12,
  "timestamp": "2026-07-11T12:00:00.000Z",
  "type": "command_check_recorded",
  "runId": "...",
  "data": {
    "scope": "build",
    "command": "python scripts/build.py",
    "exitCode": 0,
    "cwd": "."
  }
}
```

校验规则：

- scope 只允许 `build` 或 `verify`。
- command 必须是非空文本，只保存不执行。
- exitCode 必须是整数；非零结果允许记录，但不能满足 Guard。
- cwd 默认项目根目录 `.`，保存为项目相对路径并拒绝项目外路径。
- change 必须存在并具有有效的当前 Run。
- 每次记录追加新事件；查询只读取当前 runId、对应 scope 的最新事件。

该证据是一项持久化执行声明，与 `branch_status=handled` 一样依赖 Agent/用户如实记录。首版不引入完整工作树指纹。

### Guard 命令选择与恢复

构建检查先检测是否存在受支持的推断命令：

1. `package.json` 中存在 build script；
2. `pom.xml`；
3. `Cargo.toml`。

如果存在推断命令，Guard 继续实际执行它。推断命令失败时，历史手工证据不能掩盖失败。

如果无法推断，Guard 读取当前 Run 最新的相应 `command_check_recorded`：

- 最新 exitCode 为 0：检查通过，并输出 command、记录时间和证据来源。
- 无记录或最新记录非零：检查失败，列出检查过的项目标志，并给出完整的 `comet state record-check` 恢复命令。

verify scope 与 build scope 相互独立。现有受支持项目的自动推断行为保持兼容；无法推断的项目必须分别记录所需的 build/verify 结果。

`COMET_SKIP_BUILD=1` 暂时保留兼容，但输出必须明确说明检查被跳过，不能表现为普通构建成功或持久化证据通过。

## 状态模型

`comet status` 默认扫描 `openspec/changes/*` 中除 `archive` 外的所有目录。

```ts
interface RecordedCommandCheck {
  scope: 'build' | 'verify';
  command: string;
  exitCode: number;
  cwd: string;
  recordedAt: string;
  runId: string;
}

interface ChangeStatus {
  name: string;
  cometManaged: boolean;
  archiveReady: boolean;
  recommendedArchiveCommand: string;
  workflow: string | null;
  phase: string | null;
  buildMode: string | null;
  isolation: string | null;
  verifyMode: string | null;
  verifyResult: string | null;
  designDoc: string | null;
  plan: string | null;
  tasksCompleted: number;
  tasksTotal: number;
  nextCommand: string | null;
  currentStep: string | null;
  runtimeMode: string | null;
  runtimeEval: ExistingRuntimeEval | null;
  commandChecks: {
    build: RecordedCommandCheck | null;
    verify: RecordedCommandCheck | null;
  } | null;
  error?: string;
}
```

分类规则：

- 存在 `.comet.yaml` 时始终为 `cometManaged=true`。
- `.comet.yaml` 损坏时返回 Comet-managed error，不能降级为普通 OpenSpec。
- 不存在 `.comet.yaml` 时作为普通 OpenSpec change 展示，Comet 专属字段为 `null`。
- 普通 OpenSpec change 的 archiveReady 仅在 `tasks.md` 存在、至少包含一项任务且全部勾选时为 true。
- Comet change 的 archiveReady 根据有效 Classic archive 状态判断，不仅依赖任务勾选。
- `recommendedArchiveCommand` 始终存在：Comet 使用 `comet archive <name>`，普通 OpenSpec 使用 `openspec archive <name> -y`。
- 文本界面只在 archiveReady 时突出推荐归档命令；JSON 始终返回该字段。
- 输出按 change 名称稳定排序。

## 错误处理

### 公共 CLI

- 参数错误沿用 Classic dispatcher 的退出码和错误文本。
- app 适配层不把非零结果改写为通用异常。
- 输出写入失败或 dispatcher 意外抛错时，保留原始错误，不伪造成功退出码。

### record-check

- 无效 scope、空 command、非整数 exitCode、项目外 cwd、缺失 change 或无有效 Run 均在写入前失败。
- trajectory 追加失败时不修改 `.comet.yaml` 或其他状态。
- 非零 exitCode 是合法审计记录，而非 CLI 记录动作本身失败。

### Guard 无推断命令

错误不得为空，至少包含：

```text
No supported build command was inferred.
Checked:
- package.json with a build script
- pom.xml
- Cargo.toml

Run the project build manually, then record the result:
comet state record-check <change> build --command "<command>" --exit-code 0
```

## 兼容与文档

- npm 版本保持 `0.4.0-beta.4`。
- 旧 `.mjs` launcher 保留，不改变现有参数契约。
- `comet/reference/scripts.md` 保留旧变量作为兼容和恢复说明，但公共 CLI 成为 Agent 主调用协议。
- Skill 更新先修改 `assets/skills-zh/`，用户确认后再同步 `assets/skills/`。
- Classic runtime 源码修改后运行 `pnpm build:classic-runtime`，同步生成 `assets/skills/comet/scripts/comet-runtime.mjs`。
- 不修改冻结的 `test/fixtures/classic-0.3.9/`。
- Changelog 使用英文，在现有 beta4 条目中记录最终用户可见行为：#185/#192 归入 Fixed，#186/#187 归入 Added 或 Changed。

## 测试策略

### #185

- 有 frontmatter、一个 EOF newline。
- 有 frontmatter、多个 EOF 空行。
- 无 frontmatter、无 EOF newline。
- 正文内部空行保留。
- 重复注释字节级幂等。
- 结果通过 `git diff --check` 等价的 whitespace 断言。

### #186

- 通过真实 Commander 解析四个顶层命令。
- `--json`、`--apply`、`--dry-run` 和参数顺序原样传递。
- stdout/stderr 与非零退出码保留。
- help 中只出现四个批准的公共 Classic 命令。
- 公共入口不访问 launcher 路径或启动内部脚本子进程。

### #192

- commandless 项目得到非空、可操作、列出检测项的错误。
- 成功 build 证据满足 build Guard，但不满足 verify。
- 成功 verify 证据满足 verify Guard，但不满足 build。
- 最新失败证据覆盖旧成功证据。
- 其他 change/run 的证据不能复用。
- 参数校验在写入前失败。
- 保存的 command 永不执行。
- 存在推断命令时仍实际执行，手工证据不能掩盖失败。
- 生成 runtime 与 TypeScript 源码行为一致。

### #187

- 同一 fixture 中包含有效 Comet、损坏 Comet、普通 OpenSpec 和已归档 change。
- 默认同时显示普通与 Comet change。
- 分类、null 字段、readiness、推荐命令、commandChecks 和稳定排序正确。
- 损坏 `.comet.yaml` 不会误分类。
- 文本与 JSON 从同一状态结果生成。

## 实施顺序

1. 修复 #185 归档 EOF，并独立验证。
2. 实现 #186 四个公共命令，为后续恢复命令提供稳定入口。
3. 实现 #192 trajectory command-check 与 Guard 恢复路径，同步 runtime。
4. 实现 #187 混合 change 状态和 command-check 展示。
5. 先更新中文 Skill 并请求确认，再同步英文 Skill。
6. 更新 beta4 Changelog，运行完整验证。

## 验收标准

- 归档注释后的 Markdown 通过 `git diff --check`，重复执行不产生新差异。
- Agent 可以仅依赖 `comet state/guard/handoff/archive`，不发现或猜测安装脚本路径。
- commandless 项目在真实构建成功后可记录持久证据并通过 Guard，且无任意配置命令执行。
- `comet status` 默认正确展示并区分普通 OpenSpec 与 Comet-managed change。
- 中英文 Skill 对公共命令和恢复流程保持一致。
- Prettier、ESLint、架构检查、构建、聚焦测试和全量串行测试全部通过。
