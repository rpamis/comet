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

export type NativeBriefStructureSubsection = 'created' | 'modified' | 'deleted' | 'notCreated';

export const NATIVE_BRIEF_STRUCTURE_SUBSECTIONS: readonly NativeBriefStructureSubsection[] = [
  'created',
  'modified',
  'deleted',
  'notCreated',
];

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
const BRIEF_STRUCTURE_SECTION_HEADINGS = new Set<string>();
const BRIEF_STRUCTURE_SUBSECTION_KEYS = new Map<string, NativeBriefStructureSubsection>();

const BRIEF_STRUCTURE_HEADINGS: Record<
  NativeArtifactLanguage,
  { section: string; subsections: Record<NativeBriefStructureSubsection, string> }
> = {
  en: {
    section: 'Directory structure',
    subsections: {
      created: 'Created',
      modified: 'Modified',
      deleted: 'Deleted',
      notCreated: 'Not created',
    },
  },
  'zh-CN': {
    section: '目录结构',
    subsections: {
      created: '新建',
      modified: '修改',
      deleted: '删除',
      notCreated: '明确不建',
    },
  },
};

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

for (const language of Object.keys(BRIEF_STRUCTURE_HEADINGS) as NativeArtifactLanguage[]) {
  BRIEF_STRUCTURE_SECTION_HEADINGS.add(
    BRIEF_STRUCTURE_HEADINGS[language].section.toLocaleLowerCase('en-US'),
  );
  for (const [key, heading] of Object.entries(BRIEF_STRUCTURE_HEADINGS[language].subsections)) {
    BRIEF_STRUCTURE_SUBSECTION_KEYS.set(
      heading.toLocaleLowerCase('en-US'),
      key as NativeBriefStructureSubsection,
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

export function nativeBriefStructureHeading(language: NativeArtifactLanguage): string {
  return BRIEF_STRUCTURE_HEADINGS[language].section;
}

export function nativeBriefStructureSubsectionHeading(
  language: NativeArtifactLanguage,
  subsection: NativeBriefStructureSubsection,
): string {
  return BRIEF_STRUCTURE_HEADINGS[language].subsections[subsection];
}

export function nativeBriefStructureSubsectionLabel(
  subsection: NativeBriefStructureSubsection,
): string {
  return `${BRIEF_STRUCTURE_HEADINGS.en.subsections[subsection]}/${
    BRIEF_STRUCTURE_HEADINGS['zh-CN'].subsections[subsection]
  }`;
}

export function isNativeBriefStructureHeading(heading: string): boolean {
  return BRIEF_STRUCTURE_SECTION_HEADINGS.has(heading.trim().toLocaleLowerCase('en-US'));
}

export function nativeBriefStructureSubsectionKey(
  heading: string,
): NativeBriefStructureSubsection | null {
  return BRIEF_STRUCTURE_SUBSECTION_KEYS.get(heading.trim().toLocaleLowerCase('en-US')) ?? null;
}

export function nativeBriefTemplate(
  language: NativeArtifactLanguage,
  options: { compact?: boolean } = {},
): string {
  const sections: NativeBriefSection[] = ['outcome', 'scope', 'nonGoals', 'acceptanceExamples'];
  if (!options.compact)
    sections.push('constraints', 'decisions', 'openQuestions', 'verificationExpectations');
  return sections
    .map((section) => {
      if (section !== 'scope') return `# ${nativeBriefHeading(language, section)}\n`;
      const lines = [`# ${nativeBriefHeading(language, section)}\n`];
      lines.push(`## ${nativeBriefStructureHeading(language)}\n`);
      for (const subsection of NATIVE_BRIEF_STRUCTURE_SUBSECTIONS) {
        lines.push(`### ${nativeBriefStructureSubsectionHeading(language, subsection)}\n`);
      }
      return lines.join('\n');
    })
    .join('\n');
}

export function nativeLocalizedText(
  language: NativeArtifactLanguage,
  english: string,
  chinese: string,
): string {
  return language === 'zh-CN' ? chinese : english;
}
