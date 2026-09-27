function exactlyOneFinalNewline(markdown: string): string {
  return `${markdown.replace(/\n+$/u, '')}\n`;
}

/** Preserve document frontmatter while marking a Classic archive reference. */
export function annotatedMarkdown(
  original: string,
  archiveName: string,
  extraFields: string,
): string {
  const normalized = original.replace(/\r\n/gu, '\n');
  const lines = normalized.split('\n');
  const closingDelimiter = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  const extraFieldName = extraFields.match(/^([^:\n]+):/u)?.[1]?.trim();

  if (closingDelimiter !== -1) {
    const frontmatter = lines.slice(1, closingDelimiter).filter((line) => {
      const fieldName = line.match(/^([^:\n]+):/u)?.[1]?.trim();
      if (fieldName === undefined) return true;
      return fieldName !== 'archived-with' && fieldName !== extraFieldName;
    });
    frontmatter.push(`archived-with: ${archiveName}`);
    if (extraFields) frontmatter.push(extraFields);
    return exactlyOneFinalNewline(
      ['---', ...frontmatter, '---', ...lines.slice(closingDelimiter + 1)].join('\n'),
    );
  }

  const header = ['---', `archived-with: ${archiveName}`];
  if (extraFields) header.push(extraFields);
  if (extraFieldName !== 'status') header.push('status: final');
  header.push('---');
  return exactlyOneFinalNewline([...header, normalized].join('\n'));
}
