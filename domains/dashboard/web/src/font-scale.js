export const FONT_SCALE_STORAGE_KEY = 'comet-dashboard-font-scale';

export function normalizeFontScale(value) {
  if (value === null || value === undefined || value === '') return 100;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(150, Math.max(90, Math.round(number / 5) * 5)) : 100;
}

export function readFontScale(storage) {
  try {
    return normalizeFontScale(
      (storage ?? globalThis.localStorage)?.getItem(FONT_SCALE_STORAGE_KEY),
    );
  } catch {
    return 100;
  }
}

export function writeFontScale(value, storage) {
  try {
    (storage ?? globalThis.localStorage)?.setItem(
      FONT_SCALE_STORAGE_KEY,
      String(normalizeFontScale(value)),
    );
  } catch {
    // 字体调整在浏览器禁止保存偏好时仍然生效。
  }
}

/** Scale authored and generated Tailwind fonts without changing rem's root baseline. */
export function dashboardFontScaleCss() {
  return {
    postcssPlugin: 'comet-dashboard-font-scale',
    Declaration(declaration) {
      if (declaration.value.includes('--dashboard-font-scale')) return;
      const selector = declaration.parent?.selector ?? '';
      if (selector.split(',').some((part) => /^(?:html|:root|:host)$/u.test(part.trim()))) return;
      if (declaration.prop === 'font') {
        declaration.value = declaration.value.replace(
          /(^|\s)([\d.]+(?:px|rem))(?=\s|\/)/u,
          '$1calc($2 * var(--dashboard-font-scale, 1))',
        );
        return;
      }
      if (declaration.prop !== 'font-size') return;
      if (
        /^(?:inherit|initial|unset|revert(?:-layer)?|(?:xx?-)?(?:small|large)|medium|smaller|larger|0|[\d.]+(?:em|%))$/u.test(
          declaration.value.trim(),
        )
      )
        return;
      declaration.value = `calc(${declaration.value} * var(--dashboard-font-scale, 1))`;
    },
  };
}
