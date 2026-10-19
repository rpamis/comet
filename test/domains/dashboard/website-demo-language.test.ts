// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDashboardLanguage,
  setDashboardLanguage,
  t,
} from '../../../domains/dashboard/web/src/dashboard-i18n.js';

vi.mock('../../../domains/dashboard/web/src/main.jsx', () => ({
  App: () => React.createElement('h1', null, t('项目概览')),
}));

import '../../../domains/dashboard/web/src/website-demo-entry.jsx';

const demo = (
  globalThis as typeof globalThis & {
    CometDashboardWebsiteDemo: {
      mount: (
        container: HTMLElement,
        options: { stylesheetUrl: string; language: 'zh' | 'en' },
      ) => () => void;
    };
  }
).CometDashboardWebsiteDemo;

let unmount: (() => void) | undefined;

afterEach(() => {
  act(() => unmount?.());
  unmount = undefined;
  document.body.replaceChildren();
  localStorage.clear();
  setDashboardLanguage('zh', { persist: false });
  vi.unstubAllGlobals();
});

describe('website Dashboard language', () => {
  it.each(['en', 'zh'] as const)(
    'opens the %s page in its language without replacing the saved Dashboard choice',
    (language) => {
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      const saved = language === 'en' ? 'zh' : 'en';
      setDashboardLanguage(saved);
      const container = document.createElement('div');
      document.body.append(container);

      act(() => {
        unmount = demo.mount(container, { stylesheetUrl: '/demo.css', language });
      });

      expect(container.shadowRoot?.querySelector('h1')?.textContent).toBe(
        language === 'en' ? 'Project overview' : '项目概览',
      );
      expect(getDashboardLanguage()).toBe(language);
      expect(localStorage.getItem('comet-dashboard-language')).toBe(saved);

      const nextLanguage = saved;
      act(() => {
        unmount = demo.mount(container, {
          stylesheetUrl: '/demo.css',
          language: nextLanguage,
        });
      });
      expect(container.shadowRoot?.querySelector('h1')?.textContent).toBe(
        nextLanguage === 'en' ? 'Project overview' : '项目概览',
      );
      expect(container.shadowRoot?.querySelectorAll('h1')).toHaveLength(1);
      expect(localStorage.getItem('comet-dashboard-language')).toBe(saved);
    },
  );
});
