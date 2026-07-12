# CLI Banner Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为交互式 `comet init` 增加品牌蓝彗星扫光与粒子拖尾，并将 CLI 标语统一为 `Agent Skill Harness For Turning Ideas Into Evaluated Workflows`。

**Architecture:** 在 `app/cli/comet-banner.ts` 中隔离纯渲染、环境判定和帧播放；`init` 只等待一个 Banner 输出入口。播放器通过可注入的输出、环境和 sleep 依赖实现确定性测试，在非 TTY、CI、`NO_COLOR`、`TERM=dumb` 或异常时输出无 ANSI 静态 Banner。

**Tech Stack:** TypeScript ES modules、Node.js 20 标准终端 API、Vitest、Commander、Prettier、ESLint。

## Global Constraints

- 品牌标语必须逐字为 `Agent Skill Harness For Turning Ideas Into Evaluated Workflows`。
- 动画总时长控制在 600–800ms，只播放一次且不循环。
- 色板固定为深蓝 `#164E9A`、品牌蓝 `#0B6FFB`、亮青蓝 `#58B8FF`。
- `--json` 不输出 Banner；非 TTY、CI、`NO_COLOR`、`TERM=dumb` 输出无 ANSI 静态 Banner。
- 动画异常不得改变 `comet init` 的退出码或安装流程。
- 不引入新的运行时依赖，不修改 favicon、README、website 或安装语义。
- 现有 `website` 子模块工作区变化不纳入任何提交。
- 当前 `master` 为 `0.4.0-beta.4`；本分支将 `package.json`、锁文件与 Changelog 升级为只高一个预发布版本的 `0.4.0-beta.5`。
- 动画不发送光标 hide/show 控制序列，避免终止信号绕过 JavaScript 清理时遗留隐藏光标。

---

## File Map

- Create: `app/cli/comet-banner.ts` — Logo、标语、色板、纯帧渲染、能力判定和动画播放器。
- Create: `test/app/comet-banner.test.ts` — 静态渲染、彩色帧、环境降级、播放完成与异常恢复测试。
- Modify: `app/commands/init.ts` — 删除内联 Banner，调用异步 Banner 输出入口。
- Modify: `test/app/init-e2e.test.ts` — mock Banner 边界并验证普通模式与 JSON 模式接入。
- Modify: `app/cli/index.ts` — 更新 Commander 根命令描述。
- Modify: `test/app/cli-help.test.ts` — 验证根帮助中的新标语。
- Modify: `package.json` / `package-lock.json` — 更新包描述，并将版本同步升级为 `0.4.0-beta.5`。
- Modify: `CHANGELOG.md` — 在顶部新增 `0.4.0-beta.5` 的 `Changed`，记录最终用户可见的 Banner 与标语升级。

### Task 1: 纯 Banner 渲染与品牌色

**Files:**

- Create: `app/cli/comet-banner.ts`
- Create: `test/app/comet-banner.test.ts`

**Interfaces:**

- Produces: `COMET_TAGLINE: string`
- Produces: `COMET_LOGO: readonly string[]`
- Produces: `renderCometBanner(options?: { color?: boolean }): string`
- Produces: `renderCometBannerFrame(litColumns: number, particleFrame?: number): string`
- Produces: `COMET_BANNER_LINE_COUNT: number`

- [ ] **Step 1: 写静态 Banner 与彩色帧的失败测试**

```ts
import { describe, expect, it } from 'vitest';
import {
  COMET_BANNER_LINE_COUNT,
  COMET_LOGO,
  COMET_TAGLINE,
  renderCometBanner,
  renderCometBannerFrame,
} from '../../app/cli/comet-banner.js';

describe('Comet CLI banner rendering', () => {
  it('centers the logo and tagline on one shared canvas without ANSI by default', () => {
    const banner = renderCometBanner();
    const lines = banner.split('\n');
    const canvasWidth = COMET_TAGLINE.length;

    expect(COMET_TAGLINE).toBe('Agent Skill Harness For Turning Ideas Into Evaluated Workflows');
    expect(lines).toHaveLength(COMET_BANNER_LINE_COUNT);
    for (const [index, logoLine] of COMET_LOGO.entries()) {
      const visibleLogo = logoLine.trimEnd();
      expect(lines[index]).toHaveLength(canvasWidth);
      expect(lines[index]?.indexOf(visibleLogo)).toBe(
        Math.floor((canvasWidth - visibleLogo.length) / 2),
      );
    }
    expect(lines.at(-1)?.trim()).toBe(COMET_TAGLINE);
    expect(lines.at(-1)?.length).toBe(canvasWidth);
    expect(banner).not.toContain('\u001b[');
  });

  it('uses deep blue, bright cyan-blue, and brand blue across a sweep frame', () => {
    const frame = renderCometBannerFrame(24, 1);

    expect(frame).toContain('\u001b[38;2;22;78;154m');
    expect(frame).toContain('\u001b[38;2;88;184;255m');
    expect(frame).toContain('\u001b[38;2;11;111;251m');
    expect(frame).toContain('·');
    expect(frame).toContain('\u001b[0m');
    const visibleLines = frame.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').split('\n');
    expect(visibleLines.every((line) => line.length === COMET_TAGLINE.length)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `npx vitest run test/app/comet-banner.test.ts`

Expected: FAIL，错误包含 `Failed to load url ../../app/cli/comet-banner.js`。

- [ ] **Step 3: 实现 Logo、居中规则和纯帧渲染**

在 `app/cli/comet-banner.ts` 中定义固定数据和无副作用渲染函数：

```ts
export const COMET_TAGLINE = 'Agent Skill Harness For Turning Ideas Into Evaluated Workflows';

export const COMET_LOGO = [
  '   ██████╗ ██████╗ ███╗   ███╗███████╗████████╗',
  '  ██╔════╝██╔═══██╗████╗ ████║██╔════╝╚══██╔══╝',
  '  ██║     ██║   ██║██╔████╔██║█████╗     ██║   ',
  '  ██║     ██║   ██║██║╚██╔╝██║██╔══╝     ██║   ',
  '  ╚██████╗╚██████╔╝██║ ╚═╝ ██║███████╗   ██║   ',
  '   ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝   ╚═╝   ',
] as const;

const RESET = '\u001b[0m';
const DEEP_BLUE = '\u001b[38;2;22;78;154m';
const BRAND_BLUE = '\u001b[38;2;11;111;251m';
const BRIGHT_BLUE = '\u001b[38;2;88;184;255m';
const BANNER_WIDTH = Math.max(...COMET_LOGO.map((line) => line.length), COMET_TAGLINE.length);
const PARTICLES = [
  [],
  [
    [1, '·'],
    [5, '•'],
  ],
  [[4, '·']],
] as const;

export const COMET_BANNER_LINE_COUNT = COMET_LOGO.length + 1;

function center(text: string): string {
  const visibleText = text.trimEnd();
  const left = Math.max(0, Math.floor((BANNER_WIDTH - visibleText.length) / 2));
  return `${' '.repeat(left)}${visibleText}`.padEnd(BANNER_WIDTH);
}

export function renderCometBanner(options: { color?: boolean } = {}): string {
  const logo = options.color
    ? COMET_LOGO.map((line) => `${BRAND_BLUE}${center(line)}${RESET}`)
    : COMET_LOGO.map(center);
  const tagline = options.color
    ? `${BRIGHT_BLUE}${center(COMET_TAGLINE)}${RESET}`
    : center(COMET_TAGLINE);
  return [...logo, tagline].join('\n');
}

export function renderCometBannerFrame(litColumns: number, particleFrame = 0): string {
  const logo = COMET_LOGO.map((line, row) => {
    const canvas = [...center(line)];
    const logoEnd = Math.floor((BANNER_WIDTH - line.trimEnd().length) / 2) + line.trimEnd().length;
    const particles = row === 2 ? (PARTICLES[particleFrame] ?? []) : [];
    for (const [offset, particle] of particles) {
      const column = logoEnd + offset;
      if (column < BANNER_WIDTH) canvas[column] = particle;
    }

    let result = '';
    for (let column = 0; column < canvas.length; column += 1) {
      const color =
        column < litColumns - 2 ? BRAND_BLUE : column <= litColumns ? BRIGHT_BLUE : DEEP_BLUE;
      const isParticle = canvas[column] === '·' || canvas[column] === '•';
      result += `${isParticle ? BRIGHT_BLUE : color}${canvas[column]}`;
    }
    return `${result}${RESET}`;
  });
  return [...logo, `${BRIGHT_BLUE}${center(COMET_TAGLINE)}${RESET}`].join('\n');
}
```

- [ ] **Step 4: 运行渲染测试并确认通过**

Run: `npx vitest run test/app/comet-banner.test.ts`

Expected: PASS，2 tests passed。

- [ ] **Step 5: 提交纯渲染实现**

```bash
git add app/cli/comet-banner.ts test/app/comet-banner.test.ts
git commit -m "feat: add branded CLI banner renderer"
```

### Task 2: TTY 动画播放器与安全降级

**Files:**

- Modify: `app/cli/comet-banner.ts`
- Modify: `test/app/comet-banner.test.ts`

**Interfaces:**

- Consumes: `renderCometBanner()`、`renderCometBannerFrame()`、`COMET_BANNER_LINE_COUNT`
- Produces: `BannerRuntime` 类型
- Produces: `canAnimateCometBanner(runtime: Pick<BannerRuntime, 'isTTY' | 'env' | 'columns'>): boolean`
- Produces: `printCometBanner(options?: { enabled?: boolean; runtime?: Partial<BannerRuntime> }): Promise<void>`

- [ ] **Step 1: 写环境判定、完整播放和异常回退的失败测试**

把以下测试追加到 `test/app/comet-banner.test.ts`：

```ts
import { canAnimateCometBanner, printCometBanner } from '../../app/cli/comet-banner.js';

it.each([
  [{ isTTY: false, env: {}, columns: 80 }, false],
  [{ isTTY: true, env: { CI: '1' }, columns: 80 }, false],
  [{ isTTY: true, env: { NO_COLOR: '' }, columns: 80 }, false],
  [{ isTTY: true, env: { TERM: 'dumb' }, columns: 80 }, false],
  [{ isTTY: true, env: {}, columns: 61 }, false],
  [{ isTTY: true, env: {}, columns: undefined }, false],
  [{ isTTY: true, env: {}, columns: 80 }, true],
] as const)('decides whether animation is safe for %o', (runtime, expected) => {
  expect(canAnimateCometBanner(runtime)).toBe(expected);
});

it('plays one sweep without changing cursor visibility and leaves a stable final frame', async () => {
  const chunks: string[] = [];
  const sleeps: number[] = [];

  await printCometBanner({
    runtime: {
      isTTY: true,
      env: {},
      columns: 80,
      write: (chunk) => chunks.push(chunk),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    },
  });

  const output = chunks.join('');
  expect(output).not.toContain('\u001b[?25l');
  expect(output).not.toContain('\u001b[?25h');
  expect(output).toContain('·');
  expect(output).toContain('•');
  expect(output).toContain(COMET_TAGLINE);
  expect(sleeps.reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(600);
  expect(sleeps.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(800);
});

it('prints plain static output when animation is unavailable or fails', async () => {
  const plainChunks: string[] = [];
  await printCometBanner({
    runtime: { isTTY: false, env: {}, columns: 80, write: (chunk) => plainChunks.push(chunk) },
  });
  expect(plainChunks.join('')).toContain(COMET_TAGLINE);
  expect(plainChunks.join('')).not.toContain('\u001b[');

  const fallbackChunks: string[] = [];
  await expect(
    printCometBanner({
      runtime: {
        isTTY: true,
        env: {},
        columns: 80,
        write: (chunk) => fallbackChunks.push(chunk),
        sleep: async () => {
          throw new Error('timer failed');
        },
      },
    }),
  ).resolves.toBeUndefined();
  expect(fallbackChunks.join('')).not.toContain('\u001b[?25h');
  expect(fallbackChunks.join('')).toContain(COMET_TAGLINE);
});

it('writes nothing when disabled for JSON mode', async () => {
  const chunks: string[] = [];
  await printCometBanner({ enabled: false, runtime: { write: (chunk) => chunks.push(chunk) } });
  expect(chunks).toEqual([]);
});
```

- [ ] **Step 2: 运行测试并确认新导出不存在**

Run: `npx vitest run test/app/comet-banner.test.ts`

Expected: FAIL，错误指向缺少 `canAnimateCometBanner` 或 `printCometBanner`。

- [ ] **Step 3: 实现可注入播放器、异步写入保护和静态回退**

在 `app/cli/comet-banner.ts` 追加以下结构；帧序列使用 13 个 45ms 扫光等待和 2 个 55ms 粒子等待，总等待 695ms：
`createBannerStreamWriter()` 同时监听真实 Writable 的 write callback 与异步 `error` 事件，把失败转换为 Promise rejection，并在完成后移除监听器。

```ts
export type BannerRuntime = {
  isTTY: boolean;
  env: NodeJS.ProcessEnv;
  columns: number | undefined;
  write: (chunk: string) => void | Promise<void>;
  sleep: (milliseconds: number) => Promise<void>;
};

const ERASE_LINE = '\u001b[2K';

const defaultRuntime: BannerRuntime = {
  isTTY: Boolean(process.stdout.isTTY),
  env: process.env,
  columns: process.stdout.columns,
  write: createBannerStreamWriter(process.stdout),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

export function canAnimateCometBanner(
  runtime: Pick<BannerRuntime, 'isTTY' | 'env' | 'columns'>,
): boolean {
  const ciEnabled = Boolean(runtime.env.CI && runtime.env.CI !== 'false');
  const noColor = Object.prototype.hasOwnProperty.call(runtime.env, 'NO_COLOR');
  return (
    runtime.isTTY &&
    !ciEnabled &&
    !noColor &&
    runtime.env.TERM !== 'dumb' &&
    runtime.columns !== undefined &&
    runtime.columns >= BANNER_WIDTH
  );
}

function replaceFrame(frame: string, first: boolean): string {
  const moveUp = first ? '' : `\u001b[${COMET_BANNER_LINE_COUNT}A`;
  return `${moveUp}${frame
    .split('\n')
    .map((line) => `\r${ERASE_LINE}${line}`)
    .join('\n')}\n`;
}

function clearRenderedFrame(): string {
  const lines = Array.from({ length: COMET_BANNER_LINE_COUNT }, () => `\r${ERASE_LINE}`).join('\n');
  return `\u001b[${COMET_BANNER_LINE_COUNT}A${lines}\n`;
}

export async function printCometBanner(
  options: { enabled?: boolean; runtime?: Partial<BannerRuntime> } = {},
): Promise<void> {
  if (options.enabled === false) return;
  const runtime = { ...defaultRuntime, ...options.runtime };
  if (!canAnimateCometBanner(runtime)) {
    await writeSafely(runtime, `\n${renderCometBanner()}\n\n`);
    return;
  }

  let started = false;
  try {
    await runtime.write('\n');
    for (let step = 0; step <= 12; step += 1) {
      const column = Math.round((BANNER_WIDTH * step) / 12);
      await runtime.write(replaceFrame(renderCometBannerFrame(column), !started));
      started = true;
      await runtime.sleep(45);
    }
    for (const particleFrame of [1, 2]) {
      await runtime.write(replaceFrame(renderCometBannerFrame(BANNER_WIDTH, particleFrame), false));
      await runtime.sleep(55);
    }
    await runtime.write(replaceFrame(renderCometBanner({ color: true }), false));
    await runtime.write(`${RESET}\n`);
  } catch {
    const cleanup = started ? clearRenderedFrame() : '';
    await writeSafely(runtime, `${RESET}${cleanup}\n${renderCometBanner()}\n\n`);
  }
}
```

- [ ] **Step 4: 运行 Banner 测试并确认通过**

Run: `npx vitest run test/app/comet-banner.test.ts`

Expected: PASS，所有渲染、判定、播放和回退测试通过。

- [ ] **Step 5: 提交动画播放器**

```bash
git add app/cli/comet-banner.ts test/app/comet-banner.test.ts
git commit -m "feat: animate the Comet CLI banner"
```

### Task 3: 接入 `comet init` 并保持 JSON 协议

**Files:**

- Modify: `app/commands/init.ts`
- Modify: `test/app/init-e2e.test.ts`

**Interfaces:**

- Consumes: `printCometBanner({ enabled: boolean }): Promise<void>`
- Produces: `initCommand()` 在版本检查前等待 Banner 输出，JSON 模式传入 `enabled: false`

- [ ] **Step 1: mock Banner 边界并写失败的接入测试**

在 `test/app/init-e2e.test.ts` 顶层加入：

```ts
vi.mock('../../app/cli/comet-banner.js', () => ({
  printCometBanner: vi.fn(async () => undefined),
}));
```

在 describe 内加入测试：

```ts
it('enables the banner for text output and disables it for JSON output', async () => {
  mockExternalSuccess();
  await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });
  const { printCometBanner } = await import('../../app/cli/comet-banner.js');
  const { initCommand } = await import('../../app/commands/init.js');

  await captureTextOutput(() => initCommand(tmpDir, { yes: true, language: 'en' }));
  expect(printCometBanner).toHaveBeenLastCalledWith({ enabled: true });

  await captureJsonOutput(() => initCommand(tmpDir, { yes: true, json: true }));
  expect(printCometBanner).toHaveBeenLastCalledWith({ enabled: false });
});
```

- [ ] **Step 2: 运行接入测试并确认旧实现未调用模块**

Run: `npx vitest run test/app/init-e2e.test.ts -t "enables the banner"`

Expected: FAIL，`printCometBanner` 调用次数为 0。

- [ ] **Step 3: 删除内联 Banner 并等待新入口**

在 `app/commands/init.ts` 删除 `COMET_BANNER` 常量，添加：

```ts
import { printCometBanner } from '../cli/comet-banner.js';
```

把 `initCommand` 开头替换为：

```ts
export async function initCommand(targetPath: string, options: InitOptions = {}): Promise<void> {
  const projectPath = path.resolve(targetPath);
  const log = options.json ? () => undefined : console.log;

  await printCometBanner({ enabled: !options.json });
  if (!options.json) {
    await printVersionInfo(log);
  }
```

- [ ] **Step 4: 运行 Banner 与 init 接入测试**

Run: `npx vitest run test/app/comet-banner.test.ts test/app/init-e2e.test.ts`

Expected: PASS，Banner 单元测试和 init E2E 全部通过。

- [ ] **Step 5: 提交 init 接入**

```bash
git add app/commands/init.ts test/app/init-e2e.test.ts
git commit -m "feat: show animated banner during comet init"
```

### Task 4: 同步品牌文案与发布说明

**Files:**

- Modify: `app/cli/index.ts`
- Modify: `test/app/cli-help.test.ts`
- Modify: `package.json`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: `COMET_TAGLINE`
- Produces: CLI 根帮助和 npm 包元数据中的一致标语

- [ ] **Step 1: 写 CLI 帮助和包描述的失败断言**

在 `test/app/cli-help.test.ts` 中导入 `readFileSync` 并加入：

```ts
import { readFileSync } from 'fs';

it('uses the evaluated-workflows tagline in CLI and package metadata', () => {
  const help = runCli('--help');
  const packageJson = JSON.parse(
    readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
  ) as { description: string };
  const tagline = 'Agent Skill Harness For Turning Ideas Into Evaluated Workflows';

  expect(help.status, help.stderr).toBe(0);
  expect(help.stdout).toContain(tagline);
  expect(packageJson.description).toBe(tagline);
});
```

- [ ] **Step 2: 运行帮助测试并确认旧标语导致失败**

Run: `npx vitest run test/app/cli-help.test.ts -t "evaluated-workflows tagline"`

Expected: FAIL，输出或 `package.json.description` 仍包含旧标语。

- [ ] **Step 3: 更新 CLI 与包描述**

在 `app/cli/index.ts` 复用 Banner 常量：

```ts
import { COMET_TAGLINE } from './comet-banner.js';

program
  .name('comet')
  .description(COMET_TAGLINE)
  .version(getCurrentVersion(), '-v, --version', 'output the current version');
```

在 `package.json` 中更新：

```json
"description": "Agent Skill Harness For Turning Ideas Into Evaluated Workflows"
```

- [ ] **Step 4: 在当前版本 Changelog 中记录最终用户可见变化**

在 `CHANGELOG.md` 顶部新增 `0.4.0-beta.5` → `### Changed`：

```markdown
- **CLI brand experience**: `comet init` now introduces Comet with a brief blue comet sweep and particle trail in compatible interactive terminals, falls back to a stable centered static banner in automated or narrow output, and uses the clearer "Agent Skill Harness For Turning Ideas Into Evaluated Workflows" tagline across CLI and package metadata.
```

- [ ] **Step 5: 运行帮助测试并提交文案与 Changelog**

Run: `npx vitest run test/app/cli-help.test.ts`

Expected: PASS，CLI 帮助测试全部通过。

```bash
git add app/cli/index.ts test/app/cli-help.test.ts package.json CHANGELOG.md
git commit -m "feat: refresh Comet CLI branding"
```

### Task 5: 完整验证与真实 CLI 冒烟

**Files:**

- Verify only; no planned source changes

**Interfaces:**

- Consumes: Tasks 1–4 的最终实现
- Produces: 可审计的格式、lint、构建、测试和真实终端输出证据

- [ ] **Step 1: 检查相关文件格式和空白错误**

Run: `npx prettier --check app/cli/comet-banner.ts app/commands/init.ts app/cli/index.ts test/app/comet-banner.test.ts test/app/init-e2e.test.ts test/app/cli-help.test.ts package.json CHANGELOG.md`

Expected: `All matched files use Prettier code style!`

Run: `git diff --check`

Expected: 无输出，退出码 0。

- [ ] **Step 2: 运行 lint 与架构约束**

Run: `npx eslint app/ domains/ platform/`

Expected: 无错误，退出码 0。

Run: `node scripts/lint/architecture.mjs`

Expected: 架构检查通过，退出码 0。

- [ ] **Step 3: 构建并运行相关测试**

Run: `node build.js`

Expected: 输出 `Build completed successfully!`。

Run: `npx vitest run test/app/comet-banner.test.ts test/app/init-e2e.test.ts test/app/cli-help.test.ts`

Expected: 相关测试全部通过。

- [ ] **Step 4: 运行全量测试**

Run: `npx vitest run`

Expected: 全量测试通过；若默认并行模式触发已知共享 `dist` 竞争，必须另行串行验证并分别报告两组结果，不能把串行通过表述为默认并行通过。

- [ ] **Step 5: 检查真实静态输出和 CLI 文案**

Run: `node bin/comet.js --help`

Expected: 输出包含 `Agent Skill Harness For Turning Ideas Into Evaluated Workflows`。

Run: `$env:CI='1'; node bin/comet.js init --yes --skip-existing .; Remove-Item Env:CI`

Expected: Banner 只出现一次，不含可见 ANSI 转义碎片，安装流程继续执行；命令不得修改 `website` 子模块指针。

- [ ] **Step 6: 最终工作区审计**

Run: `git status --short; git log -5 --oneline`

Expected: 只保留用户原有的 `website` 子模块变化；实现提交符合 `<type>: <summary>` 规范，计划内文件无未提交修改。
