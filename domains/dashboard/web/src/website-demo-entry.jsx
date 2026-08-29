import React from 'react';
import { createRoot } from 'react-dom/client';
import { StyleProvider } from '@ant-design/cssinjs';
import 'antd/dist/reset.css';
import { DEMO_PLUGIN_PAGES } from '../demo.js';
import './styles.css';
import { App } from './main.jsx';

const mountedRoots = new WeakMap();

function createShadowSurface(container, stylesheetUrl) {
  const shadow = container.shadowRoot ?? container.attachShadow({ mode: 'open' });
  shadow.replaceChildren();

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = stylesheetUrl;

  const appRoot = document.createElement('div');
  appRoot.id = 'app-root';

  const portalRoot = document.createElement('div');
  portalRoot.id = 'portal-root';

  shadow.append(stylesheet, appRoot, portalRoot);
  return { appRoot, portalRoot, shadow };
}

function mount(container, { stylesheetUrl } = {}) {
  if (!(container instanceof HTMLElement)) {
    throw new TypeError('Dashboard website demo requires an HTMLElement mount point.');
  }
  if (!stylesheetUrl) {
    throw new TypeError('Dashboard website demo requires a stylesheet URL.');
  }

  mountedRoots.get(container)?.unmount();
  const { appRoot, portalRoot } = createShadowSurface(container, stylesheetUrl);
  const root = createRoot(appRoot);
  root.render(
    <StyleProvider container={appRoot.getRootNode()}>
      <App
        forceDemo
        demoPluginPages={DEMO_PLUGIN_PAGES}
        embedded
        themeRoot={container}
        portalContainer={portalRoot}
      />
    </StyleProvider>,
  );
  mountedRoots.set(container, root);

  return () => {
    if (mountedRoots.get(container) !== root) return;
    root.unmount();
    mountedRoots.delete(container);
    container.shadowRoot?.replaceChildren();
  };
}

globalThis.CometDashboardWebsiteDemo = Object.freeze({ mount });
