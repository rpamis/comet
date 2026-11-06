// @vitest-environment jsdom

import { act, createElement, type Ref, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationObservationDrawer } from '../../../domains/dashboard/web/src/application-record-inspector.jsx';

let drawerProps: {
  afterOpenChange: (visible: boolean) => void;
  focusable: { focusTriggerAfterClose: boolean };
};

vi.mock('antd', async (importOriginal) => ({
  ...(await importOriginal<typeof import('antd')>()),
  Drawer: (props: typeof drawerProps & { panelRef: Ref<HTMLElement>; children: ReactNode }) => {
    drawerProps = props;
    return createElement(
      'div',
      { className: 'ant-drawer' },
      createElement(
        'section',
        { ref: props.panelRef },
        createElement('button', { 'data-close': true }, 'Close'),
        props.children,
      ),
    );
  },
  Skeleton: () => createElement('span', null, 'Loading'),
}));

let container: HTMLDivElement;
let root: Root;
let trigger: HTMLButtonElement;
let nextControl: HTMLInputElement;
const pending = { title: 'Evidence', loading: true };

function render(data: typeof pending | null) {
  act(() => root.render(createElement(ApplicationObservationDrawer, { data, onClose: vi.fn() })));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  trigger = document.createElement('button');
  nextControl = document.createElement('input');
  document.body.append(trigger, nextControl, container);
  root = createRoot(container);
  render(null);
  trigger.focus();
  render(pending);
  container.querySelector<HTMLButtonElement>('[data-close]')!.focus();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  trigger.remove();
  nextControl.remove();
  vi.unstubAllGlobals();
});

describe('Application observation drawer focus', () => {
  it.each(['drawer', 'body'])(
    'restores the trigger when closing leaves focus on the %s',
    (target) => {
      render(null);
      if (target === 'body') (document.activeElement as HTMLElement).blur();
      expect(drawerProps.focusable.focusTriggerAfterClose).toBe(false);
      drawerProps.afterOpenChange(false);
      expect(document.activeElement).toBe(trigger);
    },
  );

  it('preserves the next control focused before the closing animation ends', () => {
    render(null);
    nextControl.focus();
    drawerProps.afterOpenChange(false);
    expect(document.activeElement).toBe(nextControl);
  });

  it('retains the original trigger when evidence updates while the drawer is open', () => {
    render({ ...pending, title: 'Updated evidence' });
    drawerProps.afterOpenChange(true);
    expect(document.activeElement).toBe(container.querySelector('[data-close]'));
    render(null);
    drawerProps.afterOpenChange(false);
    expect(document.activeElement).toBe(trigger);
  });
});
