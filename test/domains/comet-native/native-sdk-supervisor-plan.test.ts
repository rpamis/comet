import { describe, expect, it } from 'vitest';

import type { NativeChildrenContract } from '../../../domains/comet-native/native-children-contract.js';
import { selectNativeSdkReadyChildren } from '../../../domains/comet-native/native-sdk-supervisor-plan.js';

const contract: NativeChildrenContract = {
  schema: 'comet.native.children.v2',
  children: [
    { name: 'api', summary: 'Build the API', depends_on: [], covers: [] },
    { name: 'ui', summary: 'Build the UI', depends_on: [], covers: [] },
    { name: 'integration', summary: 'Integrate both', depends_on: ['api', 'ui'], covers: [] },
  ],
};

function selectReady(options: { integrated: string[]; active: string[]; maxParallel: number }) {
  return selectNativeSdkReadyChildren({ contract, ...options });
}

describe('Native SDK Supervisor scheduling', () => {
  it('dispatches independent children first and waits for both integrations before their dependent child', () => {
    expect(selectReady({ integrated: [], active: [], maxParallel: 2 })).toEqual(['api', 'ui']);
    expect(selectReady({ integrated: ['api'], active: ['ui'], maxParallel: 2 })).toEqual([]);
    expect(selectReady({ integrated: ['api', 'ui'], active: [], maxParallel: 2 })).toEqual([
      'integration',
    ]);
  });

  it('rejects child facts that do not match the confirmed plan', () => {
    expect(() => selectReady({ integrated: ['missing'], active: [], maxParallel: 2 })).toThrow(
      /unknown/i,
    );
    expect(() => selectReady({ integrated: ['api'], active: ['api'], maxParallel: 2 })).toThrow(
      /both/i,
    );
    expect(() => selectReady({ integrated: [], active: ['api', 'api'], maxParallel: 2 })).toThrow(
      /duplicate/i,
    );
  });

  it('rejects an invalid parallelism limit', () => {
    expect(() => selectReady({ integrated: [], active: [], maxParallel: 0 })).toThrow(
      /positive integer/i,
    );
  });
});
