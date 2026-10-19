import englishMessages from './messages.en.json' with { type: 'json' };

const STORAGE_KEY = 'comet-dashboard-language';
const listeners = new Set();
const resourceCache = new WeakMap();
const presentationFields = new Set([
  'label',
  'title',
  'description',
  'example',
  'hint',
  'ariaLabel',
]);
const sourceMessages = new Map(
  Object.entries(englishMessages).map(([source, value]) => [value, source]),
);

export function readDashboardLanguage(storage) {
  try {
    return (storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

let language = readDashboardLanguage();

export function getDashboardLanguage() {
  return language;
}

export function getDashboardLocale() {
  return language === 'en' ? 'en-US' : 'zh-CN';
}

export function subscribeDashboardLanguage(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setDashboardLanguage(value, { persist = true, storage } = {}) {
  if (value !== 'zh' && value !== 'en') return;
  if (persist) {
    try {
      (storage ?? globalThis.localStorage)?.setItem(STORAGE_KEY, value);
    } catch {
      // Language switching still works when browser storage is unavailable.
    }
  }
  if (language === value) return;
  language = value;
  for (const listener of listeners) listener();
}

const templatePatterns = Object.entries(englishMessages)
  .filter(([source]) => /\{\d+\}/u.test(source))
  .flatMap(([source, english]) =>
    [source, english].map((template) => {
      const slots = [];
      const pattern = template
        .split(/(\{\d+\})/u)
        .map((part) => {
          if (/^\{\d+\}$/u.test(part)) {
            slots.push(Number(part.slice(1, -1)));
            return '([\\s\\S]*?)';
          }
          return part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        })
        .join('');
      return { source, slots, expression: new RegExp(`^${pattern}$`, 'u') };
    }),
  );

function interpolate(template, values) {
  return template.replace(/\{(\d+)\}/gu, (token, index) =>
    Object.hasOwn(values, index) ? String(values[index]) : token,
  );
}

/** Translate interface copy only. Keep document content, logs, and user input unchanged. */
export function t(source, values = []) {
  if (typeof source !== 'string') return source;
  const key = source.trim();
  const canonical = Object.hasOwn(englishMessages, source)
    ? source
    : Object.hasOwn(englishMessages, key)
      ? key
      : sourceMessages.get(source);
  if (canonical !== undefined) {
    const translated = interpolate(
      language === 'en' ? englishMessages[canonical] : canonical,
      values,
    );
    if (key === source || canonical !== key) return translated;
    return `${source.slice(0, source.indexOf(key))}${translated}${source.slice(source.indexOf(key) + key.length)}`;
  }
  if (!/[\u4e00-\u9fff\s:：]/u.test(source)) return interpolate(source, values);
  // API diagnostics and previously displayed messages may contain interpolated details.
  for (const entry of templatePatterns) {
    const match = source.match(entry.expression);
    if (!match) continue;
    const parameters = [];
    entry.slots.forEach((slot, index) => {
      parameters[slot] = match[index + 1];
    });
    return interpolate(
      language === 'en' ? englishMessages[entry.source] : entry.source,
      parameters,
    );
  }
  return interpolate(source, values);
}

/** Static presentation tables resolve their copy when read, including after a language change. */
export function localized(resource) {
  if (!resource || typeof resource !== 'object') return resource;
  if (resourceCache.has(resource)) return resourceCache.get(resource);
  const result = Array.isArray(resource) ? [] : {};
  resourceCache.set(resource, result);
  for (const [key, value] of Object.entries(resource)) {
    const nested = value && typeof value === 'object' ? localized(value) : value;
    Object.defineProperty(result, key, {
      enumerable: true,
      configurable: true,
      get: () =>
        typeof nested === 'string' &&
        (presentationFields.has(key) || /[\u4e00-\u9fff]/u.test(nested))
          ? t(nested)
          : nested,
    });
  }
  return result;
}

/** System explanations may have been stored as multiple reasons in an older language. */
export function systemText(value) {
  if (typeof value !== 'string') return value;
  return value
    .split(/\r?\n/u)
    .map((line) => {
      const parts = line.split(/；|;\s*/u);
      const translated = parts.map((part) => t(part));
      if (translated.every((part, index) => part === parts[index])) return line;
      return translated.join(language === 'en' ? '; ' : '；');
    })
    .join('\n');
}

/** Translate deterministic repository descriptions for display without changing authored content. */
export function knowledgeText(record, value) {
  if (
    typeof value !== 'string' ||
    record?.authority !== 'repository' ||
    !String(record?.id ?? '').startsWith('generated-')
  )
    return value;
  const parts = value.split(/(?<=。)\s*|(?<=\.)\s+(?=[A-Z])/u).filter(Boolean);
  const translated = parts.map((sentence) => t(sentence));
  return translated.every((part, index) => part === parts[index]) ? value : translated.join(' ');
}
