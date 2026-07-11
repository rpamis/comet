# npm 安装版 Eval Harness 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让通过 npm 安装的 `comet eval` 默认定位并运行版本匹配的包内 Eval Harness，同时保留 `--project` 覆盖能力并提供明确的环境缺失错误。

**Architecture:** 将仓库 `eval/` 纳入 npm 发布文件。Eval 命令从自身模块路径解析包根目录；未传 `--project` 时使用包内 `eval/`，传入时使用 `<project>/eval`。在调用 `uv` 前同步检查 Harness 的两个必要入口，避免将无效工作目录报成 `uv` 缺失。

**Tech Stack:** TypeScript、Node.js `fs/path/url`、Vitest、npm pack 文件白名单。

## Global Constraints

- npm 包必须包含版本匹配的 `eval/` Harness，且不包含 `.venv`、缓存、日志或报告产物。
- 未传 `--project` 时使用包内 Harness；显式 `--project` 保持外部 Harness 覆盖语义。
- Harness 缺失必须在调用 `uv` 前报出包含路径与恢复建议的错误。
- 版本保持 `0.4.0-beta.4`，在现有 beta.4 Changelog 条目追加用户可见修复说明。

---

### Task 1: 发布并定位 npm Eval Harness

**Files:**
- Modify: `app/commands/eval.ts`
- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `test/app/eval-command.test.ts`
- Modify: `test/scripts/prepublish-check.test.ts`

**Interfaces:**
- Consumes: `EvalCommandOptions.project?: string`、`evalRunCommand`、`evalCollectCommand`。
- Produces: `evalRoot(options): string` 和 `assertEvalHarness(root): void`，供启动详情和 `uv` 执行共用。

- [ ] **Step 1: 写入默认包内 Harness 的失败测试**

在 `test/app/eval-command.test.ts` mock `fs.existsSync`，并在 `beforeEach` 令它默认返回 `true`。新增未传 `project` 的调用测试：

```ts
it('uses the bundled Eval Harness when --project is omitted', async () => {
  const { evalRunCommand } = await import('../../app/commands/eval.js');
  await evalRunCommand({ manifest, quick: true });

  expect(execFileSync).toHaveBeenLastCalledWith(
    'uv',
    expect.any(Array),
    expect.objectContaining({
      cwd: path.resolve(path.dirname(fileURLToPath(new URL('../../app/commands/eval.ts', import.meta.url))), '..', '..', 'eval'),
    }),
  );
});
```

运行：`npx vitest run test/app/eval-command.test.ts`

预期：新增测试失败，实际 cwd 为当前目录下的 `eval/`。

- [ ] **Step 2: 写入缺失 Harness 的失败测试**

在同一测试文件新增：

```ts
it('reports a missing Harness before invoking uv', async () => {
  existsSync.mockReturnValue(false);
  const { evalRunCommand } = await import('../../app/commands/eval.js');

  await expect(evalRunCommand({ project, manifest })).rejects.toThrow(
    `Eval harness is missing at ${evalCwd}.`,
  );
  expect(execFileSync).not.toHaveBeenCalled();
});
```

断言错误还包含 `Reinstall @rpamis/comet or pass --project <repository-root>.`。运行相同命令，预期该测试因当前先调用 `uv --version` 而失败。

- [ ] **Step 3: 写入 npm 发布 Harness 的失败测试**

在 `test/scripts/prepublish-check.test.ts` 新增仓库级测试：使用 `spawnSync('npm', ['pack', '--dry-run', '--json'])` 读取 JSON，断言文件清单包含 `package/eval/pyproject.toml` 和 `package/eval/local/tests/tasks/test_tasks.py`，且不包含 `eval/.venv/`、`eval/.uv-cache/` 或 `eval/local/logs/`。运行：`npx vitest run test/scripts/prepublish-check.test.ts`。预期：当前白名单未含 `eval`，测试失败。

- [ ] **Step 4: 最小实现包内 Harness 解析与预检**

在 `app/commands/eval.ts` 引入 `existsSync` 和 `fileURLToPath`，删除只为旧解析服务的 `projectRoot()`，并实现：

```ts
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

function evalRoot(options: EvalCommandOptions): string {
  if (options.project) return path.join(path.resolve(options.project), 'eval');
  return path.resolve(moduleDirectory, '..', '..', 'eval');
}

function assertEvalHarness(root: string): void {
  const required = ['pyproject.toml', path.join('local', 'tests', 'tasks', 'test_tasks.py')];
  if (required.every((relativePath) => existsSync(path.join(root, relativePath)))) return;
  throw new Error(
    `Eval harness is missing at ${root}.\n` +
      'Reinstall @rpamis/comet or pass --project <repository-root>.',
  );
}
```

在 `runEval()` 中先解析一次 `root`，先调用 `assertEvalHarness(root)`，随后调用 `assertUvAvailable()`，并以 `root` 作为 `cwd`。

- [ ] **Step 5: 将 Harness 纳入发布并更新 Changelog**

在 `package.json` 的 `files` 数组中加入 `"eval"`；保留 `.gitignore` 的现有缓存、虚拟环境和日志排除规则。在 `CHANGELOG.md` 的现有 `0.4.0-beta.4`、`### Fixed` 下新增：

```markdown
- **Eval Harness**: npm-installed `comet eval` now locates the version-matched bundled harness by default and reports a missing harness separately from a missing `uv` executable.
```

- [ ] **Step 6: 确认 GREEN 并验证发布边界**

运行：

```bash
npx vitest run test/app/eval-command.test.ts test/scripts/prepublish-check.test.ts
pnpm build
npm pack --dry-run --json
npx prettier --check app/commands/eval.ts test/app/eval-command.test.ts test/scripts/prepublish-check.test.ts
npx eslint app/commands/eval.ts
node scripts/lint/architecture.mjs
npx vitest run test/domains/comet-classic/comet-scripts.test.ts
npx vitest run
```

预期：全部退出码为 0；npm pack 文件清单包含 Harness 入口、不含运行产物；现有显式 `project` 测试仍使用 `<project>/eval`。

- [ ] **Step 7: 提交修复**

```bash
git add app/commands/eval.ts package.json CHANGELOG.md test/app/eval-command.test.ts test/scripts/prepublish-check.test.ts
git commit -m "fix(eval): bundle npm eval harness"
```
