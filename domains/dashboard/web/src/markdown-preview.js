/** Dashboard Markdown / YAML / JSON → HTML preview. */

/** Safe URI schemes only; blocks javascript:/data:/vbscript: etc. */
const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['style'],
  ALLOWED_URI_REGEXP,
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Document-scoped heading id generator (GitHub-style uniqueness). */
function createHeadingSlugger() {
  const counts = new Map();
  return {
    slug(raw) {
      let base = String(raw ?? '')
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      if (!base) base = 'heading';
      const seen = counts.get(base) ?? 0;
      counts.set(base, seen + 1);
      return seen === 0 ? base : `${base}-${seen}`;
    },
  };
}

async function sanitizePreviewHtml(dirty) {
  const createDOMPurify = (await import('dompurify')).default;
  let purify = createDOMPurify;
  if (typeof window === 'undefined' || !window.document) {
    const { JSDOM } = await import('jsdom');
    purify = createDOMPurify(new JSDOM('').window);
  }
  return purify.sanitize(String(dirty ?? ''), PURIFY_CONFIG);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isScalar(value) {
  return (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function formatScalar(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function formatPrettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function renderKvTable(entries, { className = 'yaml-kv-table' } = {}) {
  const rows = entries
    .map(([key, value]) => {
      const display = isScalar(value) ? formatScalar(value) : formatPrettyJson(value);
      return `<tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(display)}</td></tr>`;
    })
    .join('');

  return [
    `<table class="${escapeHtml(className)}">`,
    '<thead><tr><th scope="col">字段</th><th scope="col">值</th></tr></thead>',
    `<tbody>${rows}</tbody>`,
    '</table>',
  ].join('');
}

/** True when every item is a plain object sharing the same key set. */
function isUniformObjectArray(items) {
  if (!Array.isArray(items) || items.length === 0) return false;
  if (!items.every(isPlainObject)) return false;
  const firstKeys = Object.keys(items[0]).sort().join('\0');
  return items.every((item) => Object.keys(item).sort().join('\0') === firstKeys);
}

function renderObjectArrayTable(items, { className = 'json-array-table' } = {}) {
  const columns = Object.keys(items[0]);
  const head = columns.map((col) => `<th scope="col">${escapeHtml(col)}</th>`).join('');
  const body = items
    .map((item) => {
      const cells = columns
        .map((col) => {
          const value = item[col];
          const display = isScalar(value) ? formatScalar(value) : formatPrettyJson(value);
          return `<td>${escapeHtml(display)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return [
    `<table class="${escapeHtml(className)}">`,
    `<thead><tr>${head}</tr></thead>`,
    `<tbody>${body}</tbody>`,
    '</table>',
  ].join('');
}

function renderStructuredObject(data) {
  const scalarEntries = [];
  const nestedSections = [];

  for (const [key, value] of Object.entries(data)) {
    if (isScalar(value)) {
      scalarEntries.push([key, value]);
      continue;
    }
    if (isUniformObjectArray(value)) {
      nestedSections.push(
        `<h3 id="${escapeHtml(key)}">${escapeHtml(key)}</h3>${renderObjectArrayTable(value)}`,
      );
      continue;
    }
    scalarEntries.push([key, value]);
  }

  const parts = [];
  if (scalarEntries.length > 0) {
    parts.push(renderKvTable(scalarEntries));
  }
  parts.push(...nestedSections);
  return parts.join('\n') || '<p>这个产物是空文件。</p>';
}

/**
 * Render flat / map-like YAML as a key-value HTML table.
 * Non-object documents and parse failures fall back to fenced Markdown YAML.
 */
export async function renderYamlTable(content) {
  const raw = String(content ?? '');
  if (!raw.trim()) {
    return sanitizePreviewHtml('<p>这个产物是空文件。</p>');
  }

  try {
    const { parse } = await import('yaml');
    const data = parse(raw);
    if (data === null || data === undefined) {
      return sanitizePreviewHtml('<p>这个产物是空文件。</p>');
    }
    if (typeof data !== 'object' || Array.isArray(data)) {
      return renderMarkdown(['```yaml', raw.replace(/\n$/, ''), '```'].join('\n'));
    }
    return sanitizePreviewHtml(renderStructuredObject(data));
  } catch {
    return renderMarkdown(['```yaml', raw.replace(/\n$/, ''), '```'].join('\n'));
  }
}

/**
 * Render JSON as structured HTML:
 * - top-level scalars → key-value table
 * - uniform object arrays (e.g. files[{path,sha256}]) → data table under a heading
 * - other shapes fall back to pretty fenced JSON
 */
export async function renderJsonPreview(content) {
  const raw = String(content ?? '');
  if (!raw.trim()) {
    return sanitizePreviewHtml('<p>这个产物是空文件。</p>');
  }

  try {
    const data = JSON.parse(raw);
    if (data === null) {
      return sanitizePreviewHtml('<p>这个产物是空文件。</p>');
    }
    if (isUniformObjectArray(data)) {
      return sanitizePreviewHtml(renderObjectArrayTable(data));
    }
    if (isPlainObject(data)) {
      return sanitizePreviewHtml(renderStructuredObject(data));
    }
    return renderMarkdown(['```json', JSON.stringify(data, null, 2), '```'].join('\n'));
  } catch {
    return renderMarkdown(['```json', raw.replace(/\n$/, ''), '```'].join('\n'));
  }
}

/**
 * Render Markdown to an HTML string.
 * - Headings get unique Chinese-safe id anchors (duplicate titles suffix -1, -2, …)
 * - Heading inline Markdown (bold/code/links) is rendered, not shown as raw markers
 * - ```mermaid → <div class="mermaid">
 * - Other fences use highlight.js when available
 * - Whole-stack failure falls back to escaped plaintext <pre>
 */
export async function renderMarkdown(content) {
  try {
    const { Marked } = await import('marked');

    let hljs = null;
    try {
      hljs = (await import('highlight.js')).default;
    } catch {
      // highlight.js unavailable — skip syntax highlighting
    }

    // Fresh Marked + slugger per call: avoid mutating the shared marked singleton.
    const slugger = createHeadingSlugger();
    const marked = new Marked();
    marked.use({
      renderer: {
        heading({ text, depth, tokens }) {
          const id = slugger.slug(text);
          const inline =
            tokens && this.parser?.parseInline ? this.parser.parseInline(tokens) : escapeHtml(text);
          return `<h${depth} id="${escapeHtml(id)}">${inline}</h${depth}>`;
        },
        code({ text, lang }) {
          if (lang === 'mermaid') {
            return `<div class="mermaid">${escapeHtml(text)}</div>`;
          }
          if (hljs) {
            const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
            const highlighted = hljs.highlight(text, { language }).value;
            return `<pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre>`;
          }
          return `<pre><code>${escapeHtml(text)}</code></pre>`;
        },
      },
    });

    const result = marked.parse(content);
    const html = typeof result === 'string' ? result : String(result);
    return sanitizePreviewHtml(html);
  } catch {
    return sanitizePreviewHtml(`<pre>${escapeHtml(content)}</pre>`);
  }
}

/** Extract h1–h3 TOC items from a rendered container. */
export function extractToc(container) {
  const headings = container.querySelectorAll('h1, h2, h3');
  const items = [];
  headings.forEach((el) => {
    const id = el.id;
    const text = el.textContent ?? '';
    const depth = parseInt(el.tagName[1], 10);
    if (id && text) items.push({ id, text, depth });
  });
  return items;
}

/** Lazily run mermaid on `.mermaid` nodes inside the container. */
export async function runMermaid(container) {
  const diagrams = container.querySelectorAll('div.mermaid');
  if (diagrams.length === 0) return;
  try {
    const mermaid = (await import('mermaid')).default;
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'strict',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif',
    });
    await mermaid.run({ nodes: Array.from(diagrams) });
  } catch {
    // mermaid unavailable or parse error — leave raw text
  }
}
