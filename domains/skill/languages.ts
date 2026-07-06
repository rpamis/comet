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

export { ARTIFACT_LANGUAGES, LANGUAGES, resolveArtifactLanguage, formatSupportedArtifactLanguages };
export type { ArtifactLanguageId, ArtifactLanguageConfig, LanguageConfig, SkillLanguageId };
