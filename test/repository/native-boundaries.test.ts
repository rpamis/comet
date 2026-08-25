import { promises as fs } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

async function filesUnder(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) result.push(target);
    }
  };
  await visit(root);
  return result.sort();
}

async function combined(files: string[]): Promise<string> {
  return (await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))).join('\n');
}

async function nativeSpec(name: string): Promise<string> {
  return fs.readFile(path.resolve('docs', 'comet', 'specs', name, 'spec.md'), 'utf8');
}

describe('Comet Native isolation boundaries', () => {
  it('keeps the Native domain independent from Classic and OpenSpec execution', async () => {
    const files = (await filesUnder(path.resolve('domains', 'comet-native'))).filter((file) =>
      file.endsWith('.ts'),
    );
    const source = await combined(files);

    expect(source).not.toMatch(/\bfrom\s+['"][^'"]*comet-classic[^'"]*['"]/u);
    expect(source).not.toMatch(/spawn(?:Sync)?\([^)]*openspec|execFile(?:Sync)?\([^)]*openspec/iu);
    expect(source).not.toMatch(/openspec[\\/]changes/iu);
    expect(source).toContain("'.comet/config.yaml'");
    expect(new Set(source.match(/\.comet\/[A-Za-z0-9._/-]+/gu) ?? [])).toEqual(
      new Set(['.comet/config.yaml', '.comet/current-change.json', '.comet/runtime/native']),
    );
  });

  it('ships a self-contained Skill and runtime with no external workflow invocation', async () => {
    const skillFiles = [
      ...(await filesUnder(path.resolve('assets', 'skills', 'comet-native'))),
      ...(await filesUnder(path.resolve('assets', 'skills-zh', 'comet-native'))),
    ].filter((file) => /\.(?:md|mjs)$/u.test(file));
    const source = await combined(skillFiles);

    expect(source).not.toMatch(
      /requiredSkillCalls|openspec|superpowers|grill-me|brainstorming|test-driven-development|subagent-driven-development/iu,
    );
    expect(source).not.toMatch(/comet\s+(?:state|guard|handoff)\b/iu);
  });

  it('keeps both workflow domains independent below the entry seam', async () => {
    const [nativeSource, classicSource] = await Promise.all([
      combined(
        (await filesUnder(path.resolve('domains', 'comet-native'))).filter((file) =>
          file.endsWith('.ts'),
        ),
      ),
      combined(
        (await filesUnder(path.resolve('domains', 'comet-classic'))).filter((file) =>
          file.endsWith('.ts'),
        ),
      ),
    ]);

    expect(nativeSource).not.toMatch(/\bfrom\s+['"][^'"]*comet-classic[^'"]*['"]/u);
    expect(classicSource).not.toMatch(/\bfrom\s+['"][^'"]*comet-native[^'"]*['"]/u);
    for (const source of [nativeSource, classicSource]) {
      const entryImports = source.match(/\bfrom\s+['"][^'"]*comet-entry[^'"]*['"]/gu) ?? [];
      expect(entryImports.length).toBeGreaterThan(0);
      expect(
        entryImports.every((entry) => /(?:current-selection|hook-adapter|hook-types)/u.test(entry)),
      ).toBe(true);
    }
  });

  it('keeps canonical Native specs on the portable verification architecture', async () => {
    const [verification, loop, storage, resume, scope, workspace, init, parallel] =
      await Promise.all([
        nativeSpec('native-verification-evidence'),
        nativeSpec('native-completion-loop'),
        nativeSpec('native-runtime-storage'),
        nativeSpec('native-ambient-resume'),
        nativeSpec('native-scope-reopen'),
        nativeSpec('native-shape-workspace-isolation'),
        nativeSpec('native-init-workspace-defaults'),
        nativeSpec('native-parallel-worktree-tests'),
      ]);
    const canonical = [verification, loop, storage, resume, scope, workspace, init, parallel].join(
      '\n',
    );

    expect(verification).toContain('reviewer execution ref 必须与 Builder execution ref 不同');
    expect(verification).toContain('Runtime 拒绝 scope 内缺失、重复或未知 ID');
    expect(verification).toContain('Archive 不重新运行检查或 Verifier');
    expect(loop).toContain('Native 的 Build 与 Verify 循环');
    expect(loop).toContain('连续无进展和总失败轮次继续使用现有停止上限');
    expect(loop).toContain('修复范围通过后自动进入最终全量 Verify');
    expect(storage).toContain('一个 active change 只有一份可携带权威：`comet-state.yaml`');
    expect(storage).toContain('│   ├── state.json');
    expect(storage).toContain('Archive 不重新运行必要检查或 Verifier');
    expect(resume).toContain('本机 Runtime 缺失不能使可同步的 active change 消失');
    expect(scope).toContain('实现继续使当前候选失效并返回 Build');
    expect(scope).toContain('正式需求修改返回 Shape');
    expect(workspace).toContain('portable workspace binding');
    expect(init).toContain('!.comet/config.yaml');
    expect(parallel).toContain('Builder/Verifier separation');

    expect(canonical).not.toMatch(
      /contractHash|approved_contract_hash|implementation_scope|verification_evidence|partial_allowance|base_hash|baseline-manifest\.json|trajectory\.jsonl|checkpoint-journal\.json|typed receipts|Archive freshness/iu,
    );
  });
});
