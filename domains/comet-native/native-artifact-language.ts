export type NativeArtifactLanguage = 'en' | 'zh-CN';

export type NativeBriefSection =
  | 'outcome'
  | 'scope'
  | 'nonGoals'
  | 'acceptanceExamples'
  | 'constraints'
  | 'decisions'
  | 'openQuestions'
  | 'verificationExpectations';

export type NativeVerificationSection =
  | 'verification'
  | 'currentResult'
  | 'acceptance'
  | 'checks'
  | 'blockers'
  | 'risks'
  | 'previousIterations'
  | 'conclusion'
  | 'acceptanceEvidence'
  | 'commandsAndResults'
  | 'skippedChecks'
  | 'specConsistency'
  | 'knownLimitationsAndRisks';

const BRIEF_HEADINGS: Record<NativeArtifactLanguage, Record<NativeBriefSection, string>> = {
  en: {
    outcome: 'Outcome',
    scope: 'Scope',
    nonGoals: 'Non-goals',
    acceptanceExamples: 'Acceptance examples',
    constraints: 'Constraints and invariants',
    decisions: 'Decisions',
    openQuestions: 'Open questions',
    verificationExpectations: 'Verification expectations',
  },
  'zh-CN': {
    outcome: '目标',
    scope: '范围',
    nonGoals: '非目标',
    acceptanceExamples: '验收示例',
    constraints: '约束与不变量',
    decisions: '决策',
    openQuestions: '待解决问题',
    verificationExpectations: '验证预期',
  },
};

const VERIFICATION_HEADINGS: Record<
  NativeArtifactLanguage,
  Record<
    | 'verification'
    | 'currentResult'
    | 'acceptance'
    | 'checks'
    | 'blockers'
    | 'risks'
    | 'previousIterations'
    | 'conclusion',
    string
  >
> = {
  en: {
    verification: 'Verification',
    currentResult: 'Current result',
    acceptance: 'Acceptance',
    checks: 'Checks',
    blockers: 'Blockers',
    risks: 'Risks and skipped work',
    previousIterations: 'Previous iterations',
    conclusion: 'Conclusion',
  },
  'zh-CN': {
    verification: '验证',
    currentResult: '当前结果',
    acceptance: '验收',
    checks: '检查',
    blockers: '阻塞项',
    risks: '风险与跳过的工作',
    previousIterations: '之前的迭代',
    conclusion: '结论',
  },
};

const LEGACY_VERIFICATION_HEADINGS: Record<
  NativeArtifactLanguage,
  Record<
    | 'acceptanceEvidence'
    | 'commandsAndResults'
    | 'skippedChecks'
    | 'specConsistency'
    | 'knownLimitationsAndRisks'
    | 'conclusion',
    string
  >
> = {
  en: {
    acceptanceEvidence: 'Acceptance evidence',
    commandsAndResults: 'Commands and results',
    skippedChecks: 'Skipped checks',
    specConsistency: 'Spec consistency',
    knownLimitationsAndRisks: 'Known limitations and risks',
    conclusion: 'Conclusion',
  },
  'zh-CN': {
    acceptanceEvidence: '验收证据',
    commandsAndResults: '命令与结果',
    skippedChecks: '跳过的检查',
    specConsistency: '规格一致性',
    knownLimitationsAndRisks: '已知限制与风险',
    conclusion: '结论',
  },
};

const HEADING_KEYS = new Map<string, NativeBriefSection>();
const VERIFICATION_HEADING_KEYS = new Map<string, NativeVerificationSection>();
for (const language of Object.keys(BRIEF_HEADINGS) as NativeArtifactLanguage[]) {
  for (const [key, heading] of Object.entries(BRIEF_HEADINGS[language])) {
    HEADING_KEYS.set(heading.toLocaleLowerCase('en-US'), key as NativeBriefSection);
  }
  for (const [key, heading] of Object.entries(VERIFICATION_HEADINGS[language])) {
    VERIFICATION_HEADING_KEYS.set(
      heading.toLocaleLowerCase('en-US'),
      key as NativeVerificationSection,
    );
  }
  for (const [key, heading] of Object.entries(LEGACY_VERIFICATION_HEADINGS[language])) {
    VERIFICATION_HEADING_KEYS.set(
      heading.toLocaleLowerCase('en-US'),
      key as NativeVerificationSection,
    );
  }
}

export function nativeBriefHeading(
  language: NativeArtifactLanguage,
  section: NativeBriefSection,
): string {
  return BRIEF_HEADINGS[language][section];
}

export function nativeVerificationHeading(
  language: NativeArtifactLanguage,
  section: NativeVerificationSection,
): string {
  return (
    (VERIFICATION_HEADINGS[language] as Record<string, string>)[section] ??
    (LEGACY_VERIFICATION_HEADINGS[language] as Record<string, string>)[section]
  );
}

export function nativeHeadingKey(heading: string): NativeBriefSection | null {
  return HEADING_KEYS.get(heading.trim().toLocaleLowerCase('en-US')) ?? null;
}

export function nativeVerificationHeadingKey(heading: string): NativeVerificationSection | null {
  return VERIFICATION_HEADING_KEYS.get(heading.trim().toLocaleLowerCase('en-US')) ?? null;
}

export function nativeBriefTemplate(language: NativeArtifactLanguage): string {
  const sections: NativeBriefSection[] = [
    'outcome',
    'scope',
    'nonGoals',
    'acceptanceExamples',
    'constraints',
    'decisions',
    'openQuestions',
    'verificationExpectations',
  ];
  return sections.map((section) => `# ${nativeBriefHeading(language, section)}\n`).join('\n');
}

export function nativeLocalizedText(
  language: NativeArtifactLanguage,
  english: string,
  chinese: string,
): string {
  return language === 'zh-CN' ? chinese : english;
}
