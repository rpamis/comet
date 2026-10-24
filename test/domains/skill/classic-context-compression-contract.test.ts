import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';

it.each([
  {
    language: 'Chinese',
    root: 'skills-zh',
    saved: 'Design Doc 和状态记录已保存后',
    callable: '存在可调用的原生压缩机制',
    fallback: '给出一次非阻塞建议并继续',
    noBlock: '**不得阻塞**、不得额外制造确认点',
    noFake: '不得用 shell 命令或摘要伪造上下文压缩',
  },
  {
    language: 'English',
    root: 'skills',
    saved: 'after the Design Doc and state records are saved',
    callable: 'a native compression mechanism is callable',
    fallback: 'offer one nonblocking suggestion and continue',
    noBlock: '**Do not block** or create another confirmation step',
    noFake: 'Do not fake context compression with shell commands or summaries',
  },
])(
  'keeps optional $language compat compression nonblocking when no native mechanism is callable',
  async (markers) => {
    const source = await readFile(
      path.resolve('assets', markers.root, 'comet-design/reference/compat.md'),
      'utf8',
    );
    for (const marker of [
      markers.saved,
      markers.callable,
      markers.fallback,
      markers.noBlock,
      markers.noFake,
    ]) {
      expect(source).toContain(marker);
    }
  },
);
