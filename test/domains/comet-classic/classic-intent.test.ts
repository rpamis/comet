import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { classicIntentCommand } from '../../../domains/comet-classic/classic-intent-command.js';
import {
  CometIntentValidationError,
  resolveCometIntentRoute,
  type CometIntentFrame,
} from '../../../domains/comet-classic/classic-intent.js';

type FrameOverrides = Partial<
  Omit<CometIntentFrame, 'intent' | 'slots' | 'context' | 'proposed_route'>
> & {
  intent?: Partial<CometIntentFrame['intent']>;
  slots?: Partial<CometIntentFrame['slots']>;
  context?: Partial<CometIntentFrame['context']>;
  proposed_route?: Partial<CometIntentFrame['proposed_route']>;
};

function frame(overrides: FrameOverrides = {}): CometIntentFrame {
  const base: CometIntentFrame = {
    schema_version: 'comet.intent.v1',
    utterance: 'fix the failing comet guard regression',
    locale: 'en',
    intent: { name: 'fix_bug', confidence: 0.91 },
    entities: [{ type: 'bug_signal', value: 'regression', text: 'regression' }],
    slots: {
      requested_action: 'fix',
      workflow_candidate: 'hotfix',
      user_explicit_workflow: null,
      change_id: null,
      target_area: 'comet guard',
      scope: 'small',
      existing_behavior: true,
      new_capability: false,
      public_api_change: false,
      schema_change: false,
      cross_module_change: false,
    },
    context: {
      active_changes_count: 0,
      active_change_names: [],
      dirty_worktree: false,
    },
    evidence: [
      { field: 'intent.name', quote: 'fix', source: 'user' },
      { field: 'slots.workflow_candidate', quote: 'regression', source: 'user' },
    ],
    proposed_route: {
      name: 'hotfix',
      next_skill: 'comet-hotfix',
      confidence: 0.9,
      requires_confirmation: false,
      fallback_reason: null,
      recommendation: null,
    },
  };
  return {
    ...base,
    ...overrides,
    intent: { ...base.intent, ...overrides.intent },
    slots: { ...base.slots, ...overrides.slots },
    context: { ...base.context, ...overrides.context },
    proposed_route: { ...base.proposed_route, ...overrides.proposed_route },
  };
}

describe('resolveCometIntentRoute', () => {
  it('recommends hotfix confirmation for existing bug fixes', () => {
    const result = resolveCometIntentRoute(frame());

    expect(result.route).toMatchObject({
      name: 'full',
      next_skill: 'comet-open',
      requires_confirmation: true,
      recommendation: {
        workflow: 'hotfix',
        next_skill: 'comet-hotfix',
        intensity: 'standard',
      },
    });
    expect(result.route.recommendation?.reasons.join(' ')).toContain('existing behavior');
  });

  it('accepts compact frames and normalizes omitted optional fields', () => {
    const result = resolveCometIntentRoute({
      schema_version: 'comet.intent.v1',
      utterance: 'fix the failing comet guard regression',
      intent: { name: 'fix_bug', confidence: 0.91 },
      slots: {
        requested_action: 'fix',
        workflow_candidate: 'hotfix',
        user_explicit_workflow: null,
        change_id: null,
        existing_behavior: true,
        new_capability: false,
        public_api_change: false,
        schema_change: false,
        cross_module_change: false,
      },
      context: {
        active_changes_count: 0,
        active_change_names: [],
      },
      evidence: [
        { field: 'intent.name', quote: 'fix', source: 'user' },
        { field: 'slots.workflow_candidate', quote: 'regression', source: 'user' },
      ],
      proposed_route: { name: 'hotfix', confidence: 0.9 },
    });

    expect(result.route).toMatchObject({
      name: 'full',
      next_skill: 'comet-open',
      recommendation: null,
    });
    expect(result.normalizedFrame).toMatchObject({
      locale: 'unknown',
      entities: [],
      slots: { target_area: null, scope: 'unknown' },
      context: { dirty_worktree: null },
      proposed_route: {
        next_skill: null,
        requires_confirmation: true,
        fallback_reason: null,
      },
    });
  });

  it('recommends tweak confirmation for doc, config, and prompt changes', () => {
    const result = resolveCometIntentRoute(
      frame({
        utterance: 'tweak the comet prompt wording',
        intent: { name: 'make_tweak', confidence: 0.89 },
        entities: [{ type: 'file_path', value: 'assets/skills-zh/comet/SKILL.md', text: 'prompt' }],
        slots: {
          requested_action: 'modify',
          workflow_candidate: 'tweak',
          existing_behavior: null,
          target_area: 'prompt wording',
        },
        evidence: [
          { field: 'intent.name', quote: 'tweak', source: 'user' },
          { field: 'slots.workflow_candidate', quote: 'prompt wording', source: 'user' },
        ],
        proposed_route: { name: 'tweak', next_skill: 'comet-tweak', confidence: 0.88 },
      }),
    );

    expect(result.route).toMatchObject({
      name: 'full',
      next_skill: 'comet-open',
      requires_confirmation: true,
      recommendation: {
        workflow: 'tweak',
        next_skill: 'comet-tweak',
        intensity: 'standard',
      },
    });
    expect(result.route.recommendation?.reasons.join(' ')).toContain('small');
  });

  it('does not offer hotfix for ordinary tweak recommendations', () => {
    const result = resolveCometIntentRoute(
      frame({
        utterance: 'tweak the README wording',
        intent: { name: 'make_tweak', confidence: 0.89 },
        entities: [{ type: 'file_path', value: 'README.md', text: 'README' }],
        slots: {
          requested_action: 'modify',
          workflow_candidate: 'tweak',
          existing_behavior: null,
          target_area: 'README wording',
        },
        evidence: [
          { field: 'intent.name', quote: 'tweak', source: 'user' },
          { field: 'slots.workflow_candidate', quote: 'README wording', source: 'user' },
        ],
        proposed_route: { name: 'tweak', next_skill: 'comet-tweak', confidence: 0.88 },
      }),
    );

    expect(result.route.recommendation).toMatchObject({
      workflow: 'tweak',
      options: ['tweak', 'full'],
    });
  });

  it('routes explicit hotfix directly when no risk signals conflict', () => {
    const result = resolveCometIntentRoute(
      frame({
        slots: { user_explicit_workflow: 'hotfix' },
        evidence: [
          { field: 'slots.user_explicit_workflow', quote: 'hotfix', source: 'user' },
          { field: 'slots.workflow_candidate', quote: 'regression', source: 'user' },
        ],
      }),
    );

    expect(result.route).toMatchObject({
      name: 'hotfix',
      next_skill: 'comet-hotfix',
      requires_confirmation: false,
      recommendation: null,
    });
  });

  it('recommends tweak confirmation for small low-risk work under standard intensity', () => {
    const result = resolveCometIntentRoute(
      frame({
        utterance: 'add a small docs note',
        intent: { name: 'start_change', confidence: 0.92 },
        entities: [{ type: 'file_path', value: 'README.md', text: 'docs' }],
        slots: {
          requested_action: 'modify',
          workflow_candidate: 'full',
          scope: 'small',
          existing_behavior: false,
          new_capability: false,
          public_api_change: false,
          schema_change: false,
          cross_module_change: false,
        },
        evidence: [
          { field: 'intent.name', quote: 'add', source: 'user' },
          { field: 'slots.scope', quote: 'small docs note', source: 'user' },
        ],
        proposed_route: { name: 'full', next_skill: 'comet-open', confidence: 0.9 },
      }),
    );

    expect(result.route).toMatchObject({
      name: 'full',
      next_skill: 'comet-open',
      requires_confirmation: true,
      recommendation: {
        workflow: 'tweak',
        next_skill: 'comet-tweak',
        intensity: 'standard',
      },
    });
    expect(result.route.recommendation?.reasons.join(' ')).toContain('small');
  });

  it('does not treat medium or large scope evidence as low-risk evidence', () => {
    for (const scope of ['medium', 'large'] as const) {
      const result = resolveCometIntentRoute(
        frame({
          utterance: `${scope} workflow update`,
          intent: { name: 'start_change', confidence: 0.92 },
          slots: {
            requested_action: 'modify',
            workflow_candidate: 'full',
            scope,
            existing_behavior: false,
            new_capability: false,
            public_api_change: false,
            schema_change: false,
            cross_module_change: false,
          },
          evidence: [
            { field: 'intent.name', quote: 'update', source: 'user' },
            { field: 'slots.scope', quote: `${scope} workflow update`, source: 'user' },
          ],
          proposed_route: { name: 'full', next_skill: 'comet-open', confidence: 0.9 },
        }),
      );

      expect(result.route).toMatchObject({
        name: 'full',
        next_skill: 'comet-open',
        requires_confirmation: false,
        recommendation: null,
      });
    }
  });

  it('keeps thorough intensity conservative for unclear small work', () => {
    const result = resolveCometIntentRoute(
      frame({
        utterance: 'modify the workflow',
        intent: { name: 'start_change', confidence: 0.92 },
        slots: {
          requested_action: 'modify',
          workflow_candidate: 'full',
          scope: 'unknown',
          existing_behavior: false,
          new_capability: false,
          public_api_change: false,
          schema_change: false,
          cross_module_change: false,
        },
        context: { workflow_intensity: 'thorough' },
        evidence: [{ field: 'intent.name', quote: 'modify', source: 'user' }],
        proposed_route: { name: 'full', next_skill: 'comet-open', confidence: 0.9 },
      }),
    );

    expect(result.route.name).toBe('full');
    expect(result.route.requires_confirmation).toBe(false);
    expect(result.route.recommendation).toBeNull();
  });

  it('does not recommend lightweight paths when risk signals are present', () => {
    const result = resolveCometIntentRoute(
      frame({
        utterance: 'add a small public API',
        intent: { name: 'start_change', confidence: 0.92 },
        slots: {
          requested_action: 'create',
          workflow_candidate: 'full',
          scope: 'small',
          existing_behavior: false,
          new_capability: true,
          public_api_change: true,
        },
        context: { workflow_intensity: 'light' },
        evidence: [
          { field: 'slots.scope', quote: 'small', source: 'user' },
          { field: 'slots.public_api_change', quote: 'public API', source: 'user' },
        ],
        proposed_route: { name: 'full', next_skill: 'comet-open', confidence: 0.9 },
      }),
    );

    expect(result.route).toMatchObject({ name: 'full', next_skill: 'comet-open' });
    expect(result.route.recommendation).toBeNull();
  });

  it('keeps thorough intensity on full for non-small bug or tweak candidates', () => {
    for (const candidate of ['hotfix', 'tweak'] as const) {
      const result = resolveCometIntentRoute(
        frame({
          utterance:
            candidate === 'hotfix' ? 'fix the workflow regression' : 'tweak the workflow behavior',
          intent: { name: candidate === 'hotfix' ? 'fix_bug' : 'make_tweak', confidence: 0.92 },
          slots: {
            requested_action: candidate === 'hotfix' ? 'fix' : 'modify',
            workflow_candidate: candidate,
            scope: 'unknown',
            existing_behavior: candidate === 'hotfix' ? true : null,
            new_capability: false,
            public_api_change: false,
            schema_change: false,
            cross_module_change: false,
          },
          context: { workflow_intensity: 'thorough' },
          evidence: [
            {
              field: 'intent.name',
              quote: candidate === 'hotfix' ? 'fix' : 'tweak',
              source: 'user',
            },
            { field: 'slots.workflow_candidate', quote: candidate, source: 'user' },
          ],
          proposed_route: {
            name: candidate,
            next_skill: `comet-${candidate}`,
            confidence: 0.9,
          },
        }),
      );

      expect(result.route).toMatchObject({
        name: 'full',
        next_skill: 'comet-open',
        requires_confirmation: false,
        recommendation: null,
      });
    }
  });

  it('routes new capability and public API risk signals to full', () => {
    const result = resolveCometIntentRoute(
      frame({
        utterance: 'add a public API for intent routing',
        intent: { name: 'start_change', confidence: 0.93 },
        entities: [{ type: 'risk_signal', value: 'public_api_change', text: 'public API' }],
        slots: {
          requested_action: 'create',
          workflow_candidate: 'full',
          scope: 'large',
          existing_behavior: false,
          new_capability: true,
          public_api_change: true,
        },
        evidence: [
          { field: 'intent.name', quote: 'add', source: 'user' },
          { field: 'slots.public_api_change', quote: 'public API', source: 'user' },
        ],
        proposed_route: { name: 'full', next_skill: 'comet-open', confidence: 0.93 },
      }),
    );

    expect(result.route).toMatchObject({ name: 'full', next_skill: 'comet-open' });
  });

  it('does not ask user when route confidence is low but intent/slots/evidence is clear', () => {
    const result = resolveCometIntentRoute(
      frame({
        proposed_route: {
          name: 'ask_user',
          next_skill: null,
          confidence: 0.01,
          requires_confirmation: true,
          fallback_reason: 'low route confidence',
        },
      }),
    );

    expect(result.route.name).toBe('full');
    expect(result.route.fallback_reason).toBeNull();
    expect(result.route.next_skill).toBe('comet-open');
    expect(result.route.recommendation?.workflow).toBe('hotfix');
    expect(result.diagnostics.some((diagnostic) => diagnostic.includes('ask_user'))).toBe(true);
  });

  it('asks the user when explicit hotfix conflicts with risk signals', () => {
    const result = resolveCometIntentRoute(
      frame({
        utterance: 'use hotfix but add a public API',
        slots: {
          user_explicit_workflow: 'hotfix',
          workflow_candidate: 'hotfix',
          new_capability: true,
          public_api_change: true,
        },
        entities: [{ type: 'workflow', value: 'hotfix', text: 'hotfix' }],
        evidence: [
          { field: 'slots.user_explicit_workflow', quote: 'hotfix', source: 'user' },
          { field: 'slots.public_api_change', quote: 'public API', source: 'user' },
        ],
      }),
    );

    expect(result.route.name).toBe('ask_user');
    expect(result.route.fallback_reason).toContain('conflicts with risk signals');
  });

  it('asks the user when multiple active changes are possible and no change id is provided', () => {
    const result = resolveCometIntentRoute(
      frame({
        utterance: 'continue comet',
        intent: { name: 'resume_change', confidence: 0.9 },
        slots: { requested_action: 'continue', workflow_candidate: null },
        context: { active_changes_count: 2, active_change_names: ['a', 'b'] },
        evidence: [{ field: 'intent.name', quote: 'continue', source: 'user' }],
      }),
    );

    expect(result.route.name).toBe('ask_user');
    expect(result.route.fallback_reason).toContain('multiple active changes');
  });

  it('routes explicit resume with a matching change id to resume', () => {
    const result = resolveCometIntentRoute(
      frame({
        utterance: 'resume change intent-frame-routing',
        intent: { name: 'resume_change', confidence: 0.92 },
        slots: {
          requested_action: 'resume',
          workflow_candidate: null,
          change_id: 'intent-frame-routing',
        },
        context: {
          active_changes_count: 2,
          active_change_names: ['intent-frame-routing', 'other-change'],
        },
        evidence: [
          { field: 'intent.name', quote: 'resume', source: 'user' },
          { field: 'slots.change_id', quote: 'intent-frame-routing', source: 'user' },
        ],
      }),
    );

    expect(result.route).toMatchObject({ name: 'resume', next_skill: null });
  });

  it('asks the user when confidence is too low', () => {
    const result = resolveCometIntentRoute(
      frame({ intent: { name: 'fix_bug', confidence: 0.49 } }),
    );

    expect(result.route.name).toBe('ask_user');
    expect(result.route.fallback_reason).toContain('confidence');
  });

  it('throws a readable validation error for invalid schema', () => {
    const action = () => resolveCometIntentRoute({ schema_version: 'wrong' });

    expect(action).toThrow(CometIntentValidationError);
    expect(action).toThrow(/schema_version must be one of/);
  });

  it('throws when context.active_changes_count is not a valid integer', () => {
    const action = () =>
      resolveCometIntentRoute(
        frame({
          context: {
            active_changes_count: -1,
            active_change_names: ['a'],
          },
        }),
      );

    expect(action).toThrow(CometIntentValidationError);
    expect(action).toThrow(/context.active_changes_count/);
  });

  it('throws when context.active_change_names is not a string array', () => {
    const action = () =>
      resolveCometIntentRoute(
        frame({
          context: {
            active_changes_count: 1,
            active_change_names: ['ok', 1 as unknown as string],
          },
        }),
      );

    expect(action).toThrow(CometIntentValidationError);
    expect(action).toThrow(/active_change_names must only contain strings/);
  });

  it('records diagnostics when route metadata is normalized', () => {
    const result = resolveCometIntentRoute(
      frame({
        proposed_route: {
          name: 'hotfix',
          next_skill: 'comet-open',
          confidence: 0.92,
          requires_confirmation: true,
          fallback_reason: 'manual set',
        },
      }),
    );

    expect(result.route.name).toBe('full');
    expect(result.route.recommendation?.workflow).toBe('hotfix');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        "agent proposed_route 'hotfix' normalized to 'full'",
        "agent proposed_route fallback_reason 'manual set' normalized to 'null'",
        "agent proposed_route recommendation 'null' normalized to 'hotfix'",
      ]),
    );
  });

  it('intent command applies workflow_intensity from Classic project config', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-intent-command-'));
    try {
      await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
      await fs.writeFile(
        path.join(projectRoot, '.comet', 'config.yaml'),
        'classic:\n  workflow_intensity: thorough\n',
        'utf8',
      );

      const result = await classicIntentCommand(
        [
          'route',
          JSON.stringify(
            frame({
              utterance: 'modify the workflow',
              intent: { name: 'start_change', confidence: 0.92 },
              slots: {
                requested_action: 'modify',
                workflow_candidate: 'full',
                scope: 'unknown',
                existing_behavior: false,
                new_capability: false,
                public_api_change: false,
                schema_change: false,
                cross_module_change: false,
              },
              evidence: [{ field: 'intent.name', quote: 'modify', source: 'user' }],
              proposed_route: { name: 'full', next_skill: 'comet-open', confidence: 0.9 },
            }),
          ),
        ],
        { json: false, projectRoot },
      );

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout ?? '{}') as ReturnType<
        typeof resolveCometIntentRoute
      >;
      expect(payload.normalizedFrame.context.workflow_intensity).toBe('thorough');
      expect(payload.route).toMatchObject({
        name: 'full',
        requires_confirmation: false,
        recommendation: null,
      });
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  });
});
