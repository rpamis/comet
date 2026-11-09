import { expect, it } from 'vitest';
import { stringify } from 'yaml';
import {
  nativeChildrenAcceptanceValidation,
  nativeChildrenIndexDrift,
  parseNativeChildrenContract,
} from '../../../domains/comet-native/native-children-contract.js';
import {
  confirmNativePortableAcceptance,
  prepareNativePortableShapeConfirmation,
} from '../../../domains/comet-native/native-loop-runtime.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';

const acceptance = [
  { id: 'A1', source: 'brief.md', text: 'The existing interface remains available.' },
  {
    id: 'A2',
    source: 'specs/worker/spec.md',
    text: 'Worker output satisfies the requested behavior.',
  },
];
function validation() {
  const state = confirmNativePortableAcceptance({
    state: prepareNativePortableShapeConfirmation({
      state: createNativePortableState({ name: 'agent-decomposition', language: 'en' }),
      acceptance,
    }),
    acceptance,
  });
  return nativeChildrenAcceptanceValidation(state);
}
it('lets the Agent delegate specification acceptance before any failure while retaining parent-only criteria', () => {
  const options = validation();
  const source = stringify({
    schema: 'comet.native.children.v2',
    children: [{ name: 'worker', depends_on: [], covers: ['A2'] }],
  });
  const contract = parseNativeChildrenContract(source, ['A1', 'A2'], options);
  expect(contract.children[0].covers).toEqual(['A2']);
  expect(contract.acceptance_index).toEqual({
    A2: { source: acceptance[1].source, text: acceptance[1].text },
  });
  expect(nativeChildrenIndexDrift(contract, ['A1', 'A2'], options)).toBeNull();
});
it('reads delegated acceptance from the original parent catalog instead of requiring copied prose', () => {
  const source = stringify({
    schema: 'comet.native.children.v2',
    acceptance_index: {
      A1: { source: 'brief.md', text: 'A historical handoff summary.' },
      A2: { source: 'specs/worker/spec.md', text: 'Historical description.' },
    },
    children: [{ name: 'worker', depends_on: [], covers: ['A2'] }],
  });
  const contract = parseNativeChildrenContract(source, ['A1', 'A2'], validation());
  expect(contract.acceptance_index?.A1.text).toBe(acceptance[0].text);
  expect(contract.acceptance_index?.A2.text).toBe(acceptance[1].text);
  expect(nativeChildrenIndexDrift(contract, ['A1', 'A2'], validation())).toBeNull();
});
it('retains unknown-ID and dependency-cycle checks for Agent-selected task decomposition', () => {
  expect(() =>
    parseNativeChildrenContract(
      stringify({
        schema: 'comet.native.children.v2',
        children: [{ name: 'worker', depends_on: [], covers: ['A9'] }],
      }),
      ['A1', 'A2'],
      validation(),
    ),
  ).toThrow(/missing|unknown|acceptance/u);
  expect(() =>
    parseNativeChildrenContract(
      stringify({
        schema: 'comet.native.children.v2',
        children: [{ name: 'worker', depends_on: ['worker'], covers: ['A2'] }],
      }),
      ['A1', 'A2'],
      validation(),
    ),
  ).toThrow(/cycle/u);
});
