import { getDashboardLanguage, t } from './dashboard-i18n.js';
import interfaceMessages from './messages.en.json' with { type: 'json' };
import demoMessages from './demo-messages.en.json' with { type: 'json' };

const translations = Object.entries({ ...interfaceMessages, ...demoMessages })
  .filter(([source]) => /\p{Script=Han}/u.test(source))
  .sort(([a], [b]) => b.length - a.length);
const textCache = new Map();
const resourceCache = new WeakMap();

/** Translate preset examples only; real project content never passes through this helper. */
export function demoText(source) {
  if (getDashboardLanguage() !== 'en' || !/\p{Script=Han}/u.test(source)) return source;
  if (textCache.has(source)) return textCache.get(source);
  let text = demoMessages[source] ?? t(source);
  if (/\p{Script=Han}/u.test(text)) {
    for (const [original, english] of translations) text = text.replaceAll(original, english);
  }
  text = text
    .replaceAll('，', ', ')
    .replaceAll('。', '.')
    .replaceAll('：', ': ')
    .replaceAll('；', '; ')
    .replaceAll('「', '“')
    .replaceAll('」', '”');
  textCache.set(source, text);
  return text;
}

/** Keep identities and the original fixtures intact while examples follow language changes. */
export function localizedDemo(resource) {
  if (!resource || typeof resource !== 'object') return resource;
  if (resourceCache.has(resource)) return resourceCache.get(resource);
  const result = Array.isArray(resource) ? [] : {};
  resourceCache.set(resource, result);
  for (const [key, value] of Object.entries(resource)) {
    let nested = value && typeof value === 'object' ? localizedDemo(value) : value;
    Object.defineProperty(result, key, {
      enumerable: true,
      configurable: true,
      get: () => (typeof nested === 'string' ? demoText(nested) : nested),
      set: (next) => {
        nested = next && typeof next === 'object' ? localizedDemo(next) : next;
      },
    });
  }
  return result;
}
