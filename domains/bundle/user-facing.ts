export interface SkillCreatorResumeTextInput {
  title: string;
  completed: string[];
  missing: string[];
  nextAction: string;
  choices: string[];
}

export interface SkillCreatorInstallTextInput {
  preview: boolean;
  skillName: string;
  platforms: string[];
  plannedFiles: string[];
  disclosures: string[];
}

function section(title: string, values: string[]): string[] {
  if (values.length === 0) {
    return [`${title}: None`];
  }
  return [`${title}:`, ...values.map((value) => `- ${value}`)];
}

export function buildSkillCreatorResumeText(input: SkillCreatorResumeTextInput): string {
  return [
    input.title,
    ...section('Completed', input.completed),
    ...section('Still needed', input.missing),
    `Next step: ${input.nextAction}`,
    ...section('Choices', input.choices),
  ].join('\n');
}

export function buildSkillCreatorInstallText(input: SkillCreatorInstallTextInput): string {
  return [
    input.preview ? 'Install preview' : 'Install result',
    `Skill: ${input.skillName}`,
    ...section('Platforms', input.platforms),
    ...(input.preview ? ['No files were written'] : []),
    ...section('Planned files', input.plannedFiles),
    ...section('Executable disclosures', input.disclosures),
  ].join('\n');
}
