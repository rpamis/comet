import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

it.each(['skills-zh', 'skills'])(
  'keeps Agent edit judgment and actual workflow authorization in %s',
  async (language) => {
    const root = path.join('assets', language);
    const native = await fs.readFile(
      path.join(root, 'comet-native/reference/edit-review.md'),
      'utf8',
    );
    const classic = await fs.readFile(path.join(root, 'comet/reference/edit-review.md'), 'utf8');
    expect(classic).toBe(native);
    expect(native).not.toMatch(
      /comet edit-review|recordTemplate|refreshInputTemplate|previousReceiptHash|--hash-only/u,
    );
    if (language === 'skills-zh') {
      expect(native).toContain('由当前 Agent 判断实际影响');
      expect(native).toContain('不自动撤回批准');
      expect(native).toContain('不能用旧成功覆盖最新失败');
      expect(native).toContain('已经完成的单次操作不自动重放');
      expect(native).toContain('用户确认、明确要求的独立验收');
      expect(native).toContain('共享 SDK 的 Action 请求标识');
    } else {
      expect(native).toContain('current Agent judges their effect');
      expect(native).toContain('do not automatically revoke approval');
      expect(native).toContain('Do not hide a newer failure behind an older success');
      expect(native).toContain('Do not automatically replay completed one-time operations');
      expect(native).toContain('User confirmation, explicitly requested independent acceptance');
      expect(native).toContain('Shared SDK Action request identifiers');
    }
    const build = await fs.readFile(path.join(root, 'comet-build/reference/compat.md'), 'utf8');
    const verify = await fs.readFile(path.join(root, 'comet-verify/reference/compat.md'), 'utf8');
    expect(build + verify).not.toContain('--hash-only');
    expect(build + verify).not.toContain('updates `handoff_hash`');
  },
);
