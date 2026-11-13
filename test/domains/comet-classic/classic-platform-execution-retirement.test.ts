import { expect, it } from 'vitest';
import { defineClassicWorkflowApplication } from '../../../domains/comet-classic/classic-sdk-application.js';

it.each(['full', 'hotfix', 'tweak'] as const)(
  'constructs only the Agent platform Classic %s workflow',
  (profile) => {
    const application = defineClassicWorkflowApplication(profile);
    expect(application.workflow.version).toBe('2');
    expect(
      Object.keys(application.workflow.steps).some((id) =>
        /\.(?:build|verify)\.check(?:\.evidence)?$/u.test(id),
      ),
    ).toBe(false);
    expect(
      Object.values(application.workflow.steps).some((step) => step.ref === 'classic-check'),
    ).toBe(false);
    expect(
      application.evidenceValidators.some((validator) =>
        /^comet-classic-(?:build|verify)-check$/u.test(validator.id),
      ),
    ).toBe(false);
    expect(application.workflow.steps[`${profile}.build.execute`].outputSchema).toHaveProperty(
      'properties.checks',
    );
    expect(application.workflow.steps[`${profile}.verify.run`].outputSchema).toHaveProperty(
      'properties.checks',
    );
  },
);
