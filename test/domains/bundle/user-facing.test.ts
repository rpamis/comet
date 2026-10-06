import { describe, expect, it } from 'vitest';
import {
  buildSkillCreatorInstallText,
  buildSkillCreatorResumeText,
} from '../../../domains/bundle/user-facing.js';

describe('Skill Creator user-facing summaries', () => {
  it('formats resume text around user progress and next action', () => {
    const text = buildSkillCreatorResumeText({
      title: 'Found an unfinished Skill creation',
      completed: ['Plan confirmed', 'Skill files generated'],
      missing: ['Validate this Skill'],
      nextAction: 'Continue validation',
      choices: ['Continue', 'View details', 'Abandon this creation'],
    });

    expect(text).toContain('Found an unfinished Skill creation');
    expect(text).toContain('Completed:');
    expect(text).toContain('Still needed:');
    expect(text).toContain('Next step: Continue validation');
    expect(text).not.toContain('Skill Creator state is draft');
  });

  it('formats install preview without forcing publish/distribute vocabulary', () => {
    const text = buildSkillCreatorInstallText({
      preview: true,
      skillName: 'team-comet',
      platforms: ['claude'],
      plannedFiles: ['skill: .claude/skills/team-comet/SKILL.md', 'hook: before-tool'],
      disclosures: ['hook guard reads state before writes'],
    });

    expect(text).toContain('Install preview');
    expect(text).toContain('No files were written');
    expect(text).toContain('Planned files:');
    expect(text).toContain('Executable disclosures:');
    expect(text).not.toContain('Distribution preview');
  });
});
