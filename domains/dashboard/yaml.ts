/** Parse the flat legacy Classic metadata used by Dashboard. */
export type CometYaml = Record<string, string>;

export function parseCometYaml(raw: string): CometYaml {
  const out: CometYaml = {};
  for (const line of raw.split(/\r?\n/u)) {
    const stripped = stripInlineComment(line);
    const match = stripped.match(/^(\w[\w_]*):\s*(.*)$/u);
    if (!match) continue;
    const value = match[2].trim();
    out[match[1]] = stripWrappingQuotes(value);
  }
  return out;
}

function stripInlineComment(line: string): string {
  // Walk char-by-char so that `#` inside quoted strings is preserved.
  let out = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (!quote) {
      if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '#' && (i === 0 || /\s/u.test(line[i - 1]))) {
        return out.replace(/\s+$/u, '');
      }
    } else if (ch === quote) {
      quote = null;
    }
    out += ch;
  }
  return out;
}

function stripWrappingQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' || first === "'") && first === last) {
    return value.slice(1, -1);
  }
  return value;
}
