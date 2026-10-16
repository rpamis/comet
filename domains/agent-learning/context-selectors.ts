import { projectPathSelectorMatches } from '../../platform/paths/project-path-selector.js';
import type { AgentContextSelectors } from './types.js';

export interface ContextSelectorRequest {
  readonly projectId?: string;
  readonly task?: string;
  readonly path?: string;
  readonly operation?: string;
  readonly phase?: string;
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

export function contextTaskMatches(values: readonly string[] | undefined, task: string): boolean {
  const text = normalized(task);
  return (values ?? []).some((value) => {
    const selector = normalized(value);
    if (!selector.includes('*')) return text.includes(selector);
    const expression = selector
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
      .join('.*');
    return new RegExp(expression, 'u').test(text);
  });
}

export function contextValueMatches(values: readonly string[] | undefined, value: string): boolean {
  return (values ?? []).some((entry) => normalized(entry) === normalized(value));
}

export function contextPathMatches(values: readonly string[] | undefined, value: string): boolean {
  return (values ?? []).some((selector) => projectPathSelectorMatches(selector, value));
}

/** Apply the same eligibility rules before budgeting, delivery, and expansion. */
export function contextSelectorsMatch(
  selectors: AgentContextSelectors,
  request: ContextSelectorRequest,
  allowUnknown = false,
): boolean {
  if (selectors.projectId !== undefined && selectors.projectId !== request.projectId) return false;
  return (
    [
      [selectors.tasks, request.task, contextTaskMatches],
      [selectors.paths, request.path, contextPathMatches],
      [selectors.operations, request.operation, contextValueMatches],
      [selectors.phases, request.phase, contextValueMatches],
    ] as const
  ).every(
    ([values, value, matches]) =>
      !values?.length || (value === undefined ? allowUnknown : matches(values, value)),
  );
}
