import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dashboardRoot = path.join(root, 'domains/dashboard/web');
const outputRoot = path.join(root, 'website/assets/dashboard-website-demo');
const cssPath = path.join(outputRoot, 'dashboard-website-demo.css');

await build({ configFile: path.join(dashboardRoot, 'website.vite.config.mjs') });

const css = await fs.readFile(cssPath, 'utf8');
const stylesheet = postcss.parse(css);

stylesheet.walkAtRules('media', (rule) => {
  const params = rule.params.toLowerCase();
  const isMaximumWidthQuery =
    params.includes('max-width') ||
    params.includes('width <') ||
    params.includes('width<') ||
    (params.includes('not all') &&
      (params.includes('min-width') || params.includes('width >=') || params.includes('width>=')));
  if (isMaximumWidthQuery) {
    rule.remove();
    return;
  }
  if (params.includes('min-width') || params.includes('width >=') || params.includes('width>=')) {
    rule.replaceWith(...rule.nodes);
  }
});

stylesheet.append(`
:host {
  position: relative;
  display: block;
  width: 1444px;
  height: 901px;
  overflow: hidden;
  color-scheme: light;
  contain: layout paint style;
}

#app-root,
.dashboard-workbench {
  width: 1444px;
  height: 901px;
}

.dashboard-workbench {
  position: relative;
  margin: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  min-height: 901px !important;
  max-height: 901px;
  overflow: hidden;
}

.dashboard-sidebar {
  height: 901px !important;
  min-height: 901px !important;
  max-height: 901px;
}

.dashboard-content-shell {
  height: 833px;
  min-height: 833px !important;
  max-height: 833px;
  overflow: auto;
}

#portal-root {
  position: absolute;
  inset: 0;
  z-index: 120;
  width: 1444px;
  height: 901px;
  pointer-events: none;
}

#portal-root > * {
  pointer-events: auto;
}
`);

stylesheet.walkRules((rule) => {
  if (rule.parent?.type === 'atrule' && /keyframes$/u.test(rule.parent.name)) return;
  rule.selectors = rule.selectors.map((selector) => {
    const normalizedSelector = selector
      .replaceAll(':root', ':host')
      .replace(/^html(?=$|\W)/u, ':host')
      .replace(/^body(?=$|\W)/u, '#app-root');
    return /^:host(?=$|\W)/u.test(normalizedSelector)
      ? normalizedSelector
      : `:host ${normalizedSelector}`;
  });
});

await fs.writeFile(cssPath, stylesheet.toString());
await fs.copyFile(
  path.join(dashboardRoot, 'public/favicon.png'),
  path.join(outputRoot, 'favicon.png'),
);
