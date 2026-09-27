function stripFencedCodeBlocks(source: string): string {
  const kept: string[] = [];
  let inFence = false;
  for (const line of source.split(/\r?\n/u)) {
    if (/^\s*```/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) kept.push(line);
  }
  return kept.join('\n');
}

/** Keep Classic document-language checks consistent across legacy and SDK Runs. */
export function classicDocumentLanguageMismatch(
  source: string,
  language: 'en' | 'zh-CN',
  file: string,
): string | null {
  const body = stripFencedCodeBlocks(source);
  const cjk = body.match(/[\u4e00-\u9fff]/gu)?.length ?? 0;
  const englishWords = body.match(/[A-Za-z][A-Za-z0-9_-]{2,}/gu)?.length ?? 0;
  if (language === 'zh-CN' && cjk < 20 && englishWords >= 20) {
    return `configured language is zh-CN, but ${file} appears to be English-dominant (cjk_chars=${cjk}, english_words=${englishWords}).\nNext: regenerate or rewrite this artifact in Chinese while preserving necessary technical terms.`;
  }
  if (language === 'en' && cjk > 20 && cjk > englishWords) {
    return `configured language is en, but ${file} appears to be Chinese-dominant (cjk_chars=${cjk}, english_words=${englishWords}).\nNext: regenerate or rewrite this artifact in English while preserving necessary technical terms.`;
  }
  return null;
}
