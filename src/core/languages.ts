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
  aliases: string[];
};

const ARTIFACT_LANGUAGES: ArtifactLanguageConfig[] = [
  {
    id: 'en',
    label: 'English',
    aliases: ['en', 'en-US'],
  },
  {
    id: 'zh-CN',
    label: 'Simplified Chinese',
    aliases: ['zh', 'zh-CN'],
  },
];

const LANGUAGES: LanguageConfig[] = [
  { id: 'en', name: 'English', skillsDir: 'skills', artifactLanguage: 'en' },
  { id: 'zh', name: '中文', skillsDir: 'skills-zh', artifactLanguage: 'zh-CN' },
];

function resolveArtifactLanguage(language: string | undefined): ArtifactLanguageConfig {
  const normalized = language ?? 'en';
  return (
    ARTIFACT_LANGUAGES.find((entry) => entry.aliases.includes(normalized)) ?? ARTIFACT_LANGUAGES[0]
  );
}

function formatSupportedArtifactLanguages(): string {
  return 'en | zh-CN';
}

export { ARTIFACT_LANGUAGES, LANGUAGES, resolveArtifactLanguage, formatSupportedArtifactLanguages };
export type { ArtifactLanguageId, LanguageConfig, SkillLanguageId };
