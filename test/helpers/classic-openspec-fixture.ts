import { promises as fs } from 'node:fs';
import path from 'node:path';

/** 为领域生命周期测试提供无网络的 OpenSpec Archive 进程边界。 */
export async function createOpenSpecArchiveFixture(root: string, change = 'example') {
  const command = path.join(root, 'openspec-archive-fixture.mjs');
  const log = path.join(root, 'openspec-archive-invocations.jsonl');
  await fs.writeFile(
    command,
    [
      `#!${process.execPath}`,
      "import { promises as fs } from 'node:fs';",
      "import path from 'node:path';",
      'const args = process.argv.slice(2);',
      `if (args.length !== 3 || args[0] !== 'archive' || args[1] !== ${JSON.stringify(change)} || args[2] !== '--yes') throw new Error('Unexpected OpenSpec fixture command');`,
      `await fs.appendFile(${JSON.stringify(log)}, JSON.stringify({ args, cwd: process.cwd() }) + '\\n');`,
      "const source = path.join(process.cwd(), 'openspec', 'changes', args[1]);",
      "const target = path.join(process.cwd(), 'openspec', 'changes', 'archive', new Date().toISOString().slice(0, 10) + '-' + args[1]);",
      'await fs.mkdir(path.dirname(target), { recursive: true });',
      'await fs.rename(source, target);',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  return {
    command,
    async invocations(): Promise<Array<{ args: string[]; cwd: string }>> {
      return (await fs.readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    },
  };
}
