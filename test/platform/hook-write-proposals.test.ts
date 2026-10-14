import { describe, expect, it } from 'vitest';
import {
  parseCometHookRequest,
  proposedCometHookFileContent,
} from '../../platform/process/hook-adapter.js';

describe('Hook concrete write proposals', () => {
  it.each([
    {
      tool_name: 'Edit',
      tool_input: {
        file_path: 'main.ts',
        old_string: 'const a = 1;',
        new_string: '// detail\nconst a = 1;',
      },
    },
    {
      tool_name: 'Write',
      tool_input: { file_path: 'main.ts', content: '// detail\nconst a = 1;' },
    },
    {
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: 'main.ts',
        edits: [{ old_string: 'const a', new_string: '// detail\nconst a' }],
      },
    },
    {
      tool_name: 'apply_patch',
      tool_input: {
        patch:
          '*** Begin Patch\n*** Update File: main.ts\n@@\n+// detail\n const a = 1;\n*** End Patch',
      },
    },
  ])('reconstructs the exact content for $tool_name', (input) => {
    const request = parseCometHookRequest(JSON.stringify(input));
    expect(request.intent).toBe('write');
    expect(request.targets).toEqual(['main.ts']);
    expect(proposedCometHookFileContent(request.writes![0], 'const a = 1;')).toBe(
      '// detail\nconst a = 1;',
    );
  });
  it('rejects absent and ambiguous replacements and patch contexts', () => {
    for (const before of ['const b = 1;', 'const a = 1;\nconst a = 1;']) {
      expect(
        proposedCometHookFileContent(
          {
            path: 'main.ts',
            replacements: [
              { oldText: 'const a = 1;', newText: '// detail\nconst a = 1;', replaceAll: false },
            ],
          },
          before,
        ),
      ).toBeNull();
    }
    expect(
      proposedCometHookFileContent(
        {
          path: 'main.ts',
          patch: '*** Begin Patch\n*** Update File: main.ts\n@@\n+// detail\n*** End Patch',
        },
        'const a = 1;',
      ),
    ).toBeNull();
  });
  it('handles raw Codex patches and preserves dollar replacement text', () => {
    const patch =
      '*** Begin Patch\n*** Update File: main.ts\n@@\n const a = 1;\n+// $& is literal.\n*** End Patch';
    const request = parseCometHookRequest(patch);
    expect(proposedCometHookFileContent(request.writes![0], 'const a = 1;')).toBe(
      'const a = 1;\n// $& is literal.',
    );
  });
});
