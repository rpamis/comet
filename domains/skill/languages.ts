import { parse } from 'yaml';

type SkillLanguageId = 'en' | 'zh';
type ArtifactLanguageId = 'en' | 'zh-CN';

type LanguageConfig = {
  id: SkillLanguageId;
  name: string;
  skillsDir: string;
  artifactLanguage: ArtifactLanguageId;
};

type ArtifactLanguageConfig = {
  id: ArtifactLanguageId;
  label: string;
};

const ARTIFACT_LANGUAGES: ArtifactLanguageConfig[] = [
  { id: 'en', label: 'English' },
  { id: 'zh-CN', label: 'Simplified Chinese' },
];

const LANGUAGES: LanguageConfig[] = [
  { id: 'en', name: 'English', skillsDir: 'skills', artifactLanguage: 'en' },
  { id: 'zh', name: '中文', skillsDir: 'skills-zh', artifactLanguage: 'zh-CN' },
];

/** Infer legacy installation language from its description, never from body examples. */
function detectSkillDescriptionLanguage(content: string): SkillLanguageId | null {
  const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
  if (frontmatter) {
    try {
      const metadata: unknown = parse(frontmatter[1]!);
      if (
        metadata &&
        typeof metadata === 'object' &&
        'description' in metadata &&
        typeof metadata.description === 'string' &&
        metadata.description.trim()
      ) {
        return /[㐀-鿿]/u.test(metadata.description) ? 'zh' : 'en';
      }
    } catch {
      // Older or locally edited entries may have no usable frontmatter.
    }
  }
  const body = frontmatter ? content.slice(frontmatter[0].length) : content;
  const introduction = body
    .split(/\r?\n\s*\r?\n/u)
    .find((paragraph) => paragraph.trim() && !paragraph.trim().startsWith('#'));
  return introduction === undefined ? null : /[㐀-鿿]/u.test(introduction) ? 'zh' : 'en';
}

function formatSupportedArtifactLanguages(): string {
  return ARTIFACT_LANGUAGES.map((entry) => entry.id).join(' | ');
}

function resolveArtifactLanguage(language: string | undefined): ArtifactLanguageConfig {
  const normalized = language ?? 'en';
  const match = ARTIFACT_LANGUAGES.find((entry) => entry.id === normalized);
  if (!match) {
    throw new Error(
      `Invalid artifact language: '${normalized}'. Valid values: ${formatSupportedArtifactLanguages()}`,
    );
  }
  return match;
}

function artifactLanguageToSkillLanguage(
  language: ArtifactLanguageId | undefined,
): SkillLanguageId {
  return language === 'zh-CN' ? 'zh' : 'en';
}

export {
  ARTIFACT_LANGUAGES,
  LANGUAGES,
  artifactLanguageToSkillLanguage,
  detectSkillDescriptionLanguage,
  resolveArtifactLanguage,
  formatSupportedArtifactLanguages,
};
export type { ArtifactLanguageId, ArtifactLanguageConfig, LanguageConfig, SkillLanguageId };
