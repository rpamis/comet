# Outcome

`comet classic workspace prepare` 和 `comet classic workspace resolve` 在所有隔离模式（`current`/`branch`/`worktree`）下都能正常返回结果，不再无条件抛出 `Classic command project context is unavailable`（GitHub issue #335）。

# Scope

- `domains/comet-classic/classic-command-context.ts`：新增一个高阶函数 `withProjectContext(handler: ClassicCommandHandler): ClassicCommandHandler`，把"建立 context 再执行"这件事抽象成一层包装：`return (args, options) => withClassicCommandContext(options, () => handler(args, options));`。这样任何通过它导出的 handler 都不可能再出现"忘记建立 context 就消费"的写法——因为裸的业务函数永远不会被直接导出为 `ClassicCommandHandler`，必须经过这层包装。
- 把仓库里现有 6 个应当共享 context 的 Classic command handler 统一改成用 `withProjectContext(...)` 包裹，收敛成同一种写法：
  - `classic-guard.ts` 的 `classicGuardCommand`
  - `classic-state-command.ts` 的 `classicStateCommand`
  - `classic-handoff.ts` 的 `classicHandoffCommand`
  - `classic-validate-command.ts` 的 `classicValidateCommand`
  - `classic-resume-probe-command.ts` 的 `classicResumeProbeCommand`
  - `classic-workspace-command.ts` 的 `classicWorkspaceCommand`（原本缺失包裹的那个，本次 bug 的直接修复对象）
  以上只是把原本各自手写的 `async (args, options) => withClassicCommandContext(options, async () => {...})` 样板替换成 `withProjectContext(async (args, options) => {...})`，函数体业务逻辑不变。
- `classic-archive.ts`（`classicArchiveCommand`）、`classic-root-command.ts`（`classicRootCommand`）、`classic-openspec-command.ts`（`classicOpenSpecCommand`）、`classic-hook-guard.ts`（`classicHookGuardCommand`）**不纳入**这次统一，它们刻意不使用共享 `AsyncLocalStorage` context（各自直接 `discoverClassicProject(process.cwd())` 或自解析 `--project-root`），语义和这 6 个不同，强行统一会改变其行为边界，超出本次修复范围。
- 补充针对 `classicWorkspaceCommand` 的单元测试，覆盖 `resolve`/`prepare` × `current`/`branch`/`worktree` 的组合，验证不再抛出 context 不可用错误，且能正确解析 `projectRoot`；同时补一个针对 `withProjectContext` 本身的单元测试（未建立 context 时会现场建立、已在 context 中时复用）。
- 修改后运行 `pnpm build:classic-runtime` 重新生成 `assets/skills/comet/scripts/comet-runtime.mjs`，保持生成物新鲜度检查通过。
- 按仓库 CHANGELOG 规范补充一条 `Fixed` 条目。

# Non-goals

- 不改变 `withClassicCommandContext` / `classicCommandProjectRoot` 的实现或语义。
- 不修改 `classic-workspace.ts` 中 `prepareClassicWorkspace` / `resolveClassicWorkspace` 的业务逻辑。
- 不处理仓库当前 `docs/openspec` 配置与实际 `openspec/` 目录不一致的问题（属于预先存在的、与本次修复无关的环境问题）。
- 不新增 `--creation-authorization` 之类未在 runtime 中实现的 CLI 能力。

# Acceptance examples

- A1: 在 Classic 项目根目录运行 `comet classic workspace prepare <name> --isolation current --json`，返回 `exitCode: 0` 且包含 `projectRoot`，不再返回 `exitCode: 70` / `Classic command project context is unavailable`。
- A2: 同样命令分别用 `--isolation branch` 和 `--isolation worktree` 运行，均返回 `exitCode: 0`（不要求真实创建 branch/worktree 全部成功，但不得因 context 缺失而失败）。
- A3: 运行 `comet classic workspace resolve <name> --json`，返回 `exitCode: 0` 且 `projectRoot` 与实际项目根目录一致。
- A4: `classicWorkspaceCommand` 新增的单元测试覆盖 A1-A3 对应的 `resolve`/`prepare` × `current`/`branch`/`worktree` 组合，且全部通过。
- A5: `withProjectContext` 新增单元测试验证两种路径都成立：外部未建立 context 时调用会现场建立一次；已经处于 `withClassicCommandContext` 建立的 context 中再调用会直接复用而不重复解析。
- A6: `guard`/`state`/`handoff`/`validate`/`resume-probe` 五个已迁移到 `withProjectContext` 的 handler，其既有测试套件（`test/domains/comet-classic/`）在改写后无需修改断言即可继续通过，证明这次重构没有改变它们的行为。
- A7: `pnpm build:classic-runtime --check` 与 `npx vitest run test/domains/comet-classic/comet-scripts.test.ts` 通过。

# Constraints and invariants

- `withProjectContext` 内部必须复用现有 `withClassicCommandContext`，不引入新的 context 建立方式或改变其"已在 context 中则直接复用"的短路语义。
- `classicCommandProjectRoot()` / `classicCommandInvocationCwd()` 的错误语义（context 缺失时抛错）保持不变。
- 6 个 handler 迁移到 `withProjectContext` 后，各自函数体内的业务逻辑、参数解析、错误处理和返回结构不得有行为变化，只替换包装写法。
- `classic-archive.ts` / `classic-root-command.ts` / `classic-openspec-command.ts` / `classic-hook-guard.ts` 保持现状，不纳入这次抽象。
- 不引入 bash 依赖，保持 Node.js-only 的 launcher/runtime 约束。

# Decisions

- 不采用 issue #335 里"仅给 workspace 一个 handler 补包裹"的最小修复，而是把这个模式抽成 `withProjectContext` 高阶函数，6 个 handler 统一改用它。原因：issue 本身的根因就是"手写包裹样板容易被漏写"，只修 workspace 一处不能防止未来第 7 个 handler 重犯同样的错；抽象成高阶函数后，忘记建立 context 在类型/结构上就不可能发生。
- 不在 `classic-cli.ts` 的 `dispatch()` 层统一建立 context（曾评估过的另一个方案）：因为 `archive`/`root`/`openspec`/`hook-guard` 四个 handler 刻意不使用共享 context，强行统一会给它们施加不需要的项目发现开销和失败面，属于行为改变，风险高于收益。`withProjectContext` 只作用于选择使用它的 6 个 handler，不影响其余 4 个。

# Open questions

（无阻塞项：根因和修复方式已经通过 issue 描述与本地代码核实，不存在需要用户澄清的用户可见行为分歧。）

# Verification expectations

- 新增/更新的单元测试通过：`npx vitest run test/domains/comet-classic/`。
- `pnpm build:classic-runtime --check` 通过（确认 `comet-runtime.mjs` 与源码同步）。
- `pnpm lint` 通过（涉及 TypeScript 源码修改）。
