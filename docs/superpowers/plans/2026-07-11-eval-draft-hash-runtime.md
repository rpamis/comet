# Eval draftHash 运行时解析实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不修改 Factory 原始清单或 Bundle hash 语义的前提下，让 `comet eval` 将 `<current-bundle-hash>` 解析为真实 hash 后再调用 Eval Harness。

**Architecture:** Bundle 领域新增运行时清单准备模块，负责识别占位符、定位所属 Bundle、计算稳定 hash、重写临时清单和清理。CLI 的 run/collect 生命周期只负责调用该接口，并确保所有成功或失败路径执行清理。

**Tech Stack:** TypeScript、Node.js `fs/os/path`、YAML、现有 `loadBundle()`/`hashBundle()`、Vitest。

## Global Constraints

- Factory 生成的原始 `comet/eval.yaml` 必须继续保存 `<current-bundle-hash>`。
- 只有精确占位符值进入运行时解析；已有合法 hash 或其他值保持原路径并交给现有 Harness 校验。
- 临时清单必须把相对 `skill.source` 转换为基于原清单的绝对路径。
- 原清单不得被修改，临时目录在成功、`uv` 失败及参数准备失败后都必须清理。
- 版本保持 `0.4.0-beta.4`，在当前 Changelog 的 `Fixed` 下追加用户可见修复。

---

### Task 1: Bundle 领域运行时清单准备

**Files:**
- Create: `domains/bundle/eval-manifest-runtime.ts`
- Create: `test/domains/bundle/eval-manifest-runtime.test.ts`

**Interfaces:**
- Consumes: `loadBundle(root: string)`、`hashBundle(bundle: SkillBundle)`。
- Produces: `prepareEvalManifest(manifestPath: string): Promise<PreparedEvalManifest>`，其中 `PreparedEvalManifest` 为 `{ path: string; cleanup: () => Promise<void> }`。

- [ ] **Step 1: 写入失败的占位符解析测试**

创建最小合法 Bundle fixture：`bundle.yaml`、`skills/demo/SKILL.md`、`skills/demo/comet/eval.yaml`。清单的 `draftHash` 为 `<current-bundle-hash>`、`skill.source` 为 `..`。测试调用：

```ts
const prepared = await prepareEvalManifest(manifestPath);
const runtime = parse(await fs.readFile(prepared.path, 'utf8')) as {
  metadata: { draftHash: string };
  skill: { source: string };
};

expect(runtime.metadata.draftHash).toMatch(/^[a-f0-9]{64}$/u);
expect(runtime.skill.source).toBe(path.resolve(path.dirname(manifestPath), '..'));
expect(await fs.readFile(manifestPath, 'utf8')).toContain('<current-bundle-hash>');
```

- [ ] **Step 2: 运行测试确认 RED**

运行：`npx vitest run test/domains/bundle/eval-manifest-runtime.test.ts`

预期：FAIL，模块或 `prepareEvalManifest` 尚不存在。

- [ ] **Step 3: 实现最小占位符解析**

在新模块中定义并导出：

```ts
interface PreparedEvalManifest {
  path: string;
  cleanup: () => Promise<void>;
}

export async function prepareEvalManifest(manifestPath: string): Promise<PreparedEvalManifest>;
```

实现步骤：解析绝对清单路径；非占位符返回原路径和异步空 cleanup；占位符从清单目录逐级向上查找 `bundle.yaml`；用 `loadBundle()`/`hashBundle()` 计算 hash；把 `skill.source ?? '..'` 解析为原清单相对的绝对路径；用 `fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-manifest-'))` 创建临时目录并写入 `eval.yaml`；写入失败时立即删除临时目录。

- [ ] **Step 4: 增加边界与清理测试**

添加独立测试：

```ts
it('keeps an already resolved manifest in place', async () => {
  // draftHash 为 'a'.repeat(64)
  expect((await prepareEvalManifest(manifestPath)).path).toBe(path.resolve(manifestPath));
});

it('rejects a placeholder manifest outside a Bundle', async () => {
  await expect(prepareEvalManifest(manifestPath)).rejects.toThrow(
    'Cannot resolve <current-bundle-hash>',
  );
});

it('removes the temporary manifest idempotently', async () => {
  const prepared = await prepareEvalManifest(manifestPath);
  await prepared.cleanup();
  await prepared.cleanup();
  await expect(fs.access(prepared.path)).rejects.toMatchObject({ code: 'ENOENT' });
});
```

- [ ] **Step 5: 运行领域测试确认 GREEN**

运行：`npx vitest run test/domains/bundle/eval-manifest-runtime.test.ts test/domains/bundle/bundle-hash.test.ts`

预期：全部通过，原有 Bundle hash 规范化测试不回归。

- [ ] **Step 6: 提交领域能力**

```bash
git add domains/bundle/eval-manifest-runtime.ts test/domains/bundle/eval-manifest-runtime.test.ts
git commit -m "fix(eval): resolve generated draft hashes"
```

### Task 2: 接入 comet eval 生命周期

**Files:**
- Modify: `app/commands/eval.ts`
- Modify: `test/app/eval-command.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 1 的 `prepareEvalManifest()`。
- Produces: run/collect 在调用 pytest 前使用准备后的清单，并在所有退出路径清理。

- [ ] **Step 1: 写入失败的 CLI 生命周期测试**

在 `test/app/eval-command.test.ts` mock `prepareEvalManifest` 返回 `runtimeManifest` 和 `cleanup`。调用 `evalCollectCommand({ project, manifest })`，断言传给 `uv` 的参数包含：

```ts
`--eval-manifest=${path.resolve(runtimeManifest)}`
```

同时断言 `prepareEvalManifest` 收到原始 `manifest`，并且 `cleanup` 在命令结束后执行一次。当前实现会传原始清单，因此测试应失败。

- [ ] **Step 2: 写入失败路径清理测试**

让第二次 `execFileSync`（实际 `uv run pytest`）抛出 `new Error('pytest failed')`，断言 `evalRunCommand()` 保留该错误，同时 `cleanup` 仍执行一次。

- [ ] **Step 3: 运行 CLI 测试确认 RED**

运行：`npx vitest run test/app/eval-command.test.ts`

预期：新增测试因未调用 `prepareEvalManifest`、pytest 仍收到原路径或 cleanup 未执行而失败。

- [ ] **Step 4: 最小接入 run/collect**

在 `app/commands/eval.ts` 引入 `prepareEvalManifest`。对包含 `options.manifest` 的 run/collect：先准备运行清单；用 `{ ...options, manifest: prepared.path }` 构建 pytest 参数；启动详情仍使用原始 options；在包含参数构建和 `runEval` 的 `try/finally` 中调用 `await prepared.cleanup()`。Skill path 模式继续使用原逻辑，不创建临时清单。

- [ ] **Step 5: 更新 Changelog**

在现有 `0.4.0-beta.4` 的 `### Fixed` 下追加：

```markdown
- **Generated Eval manifests**: `comet eval` now resolves Factory `draftHash` placeholders into temporary version-bound manifests before collection, so `/comet-any` output can be evaluated immediately without modifying generated Bundle files ([#183](https://github.com/rpamis/comet/issues/183)).
```

- [ ] **Step 6: 运行聚焦验证确认 GREEN**

运行：

```bash
npx vitest run test/app/eval-command.test.ts test/app/cli-eval-options.test.ts test/domains/bundle/eval-manifest-runtime.test.ts test/domains/bundle/bundle-hash.test.ts
npx prettier --check app/commands/eval.ts domains/bundle/eval-manifest-runtime.ts test/app/eval-command.test.ts test/domains/bundle/eval-manifest-runtime.test.ts
npx eslint app/commands/eval.ts domains/bundle/eval-manifest-runtime.ts
node scripts/lint/architecture.mjs
pnpm build
```

预期：全部退出码为 0。

- [ ] **Step 7: 运行全量测试并提交**

先运行 `npx vitest run --no-file-parallelism`，预期 0 失败；本仓库普通并行模式存在共享 `dist/` 重建竞争，因此使用已验证的串行文件模式。然后提交：

```bash
git add app/commands/eval.ts test/app/eval-command.test.ts CHANGELOG.md
git commit -m "fix(eval): prepare generated manifests at runtime"
```
