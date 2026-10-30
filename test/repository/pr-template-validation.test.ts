import { promises as fs } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const template = await fs.readFile('.github/PULL_REQUEST_TEMPLATE.md', 'utf8');
const workflow = parse(await fs.readFile('.github/workflows/pr-template-check.yml', 'utf8'));
const script = workflow.jobs['check-template'].steps[0].with.script;
const assessed =
  'Documentation impact was assessed; applicable docs were updated or a concrete no-update reason is provided';
const reason =
  'This fix restores the documented Shape workflow; no commands, configuration, or user instructions change.';
function validBody(decision = 'not-needed', evidence = reason): string {
  return template
    .replace(/<!--[^]*?-->/g, '')
    .replace(/- \[ \]/g, '- [x]')
    .replace('Documentation decision: pending', `Documentation decision: ${decision}`)
    .replace(
      'Documentation evidence: TODO explain the affected documentation or why no update is needed.',
      `Documentation evidence: ${evidence}`,
    );
}
async function check(body: string, existing = false) {
  const failures: string[] = [];
  const comments: string[] = [];
  const refs: string[] = [];
  await runInNewContext(`(async () => {${script}\n})()`, {
    Buffer,
    context: {
      payload: {
        pull_request: { body, base: { sha: 'trusted-base' }, head: { sha: 'untrusted-head' } },
      },
      repo: { owner: 'owner', repo: 'repo' },
      issue: { number: 1 },
    },
    core: { setFailed: (message: string) => failures.push(message) },
    github: {
      rest: {
        repos: {
          getContent: async ({ ref }: { ref: string }) => {
            refs.push(ref);
            return { data: { content: Buffer.from(template).toString('base64') } };
          },
        },
        issues: {
          listComments: async () => ({
            data: existing
              ? [
                  {
                    id: 1,
                    user: { login: 'github-actions[bot]' },
                    body: '<!-- comet-pr-template-check -->',
                  },
                ]
              : [],
          }),
          createComment: async ({ body }: { body: string }) => comments.push(body),
          updateComment: async ({ body }: { body: string }) => comments.push(body),
        },
      },
    },
  });
  return { failures, comments, refs };
}

describe('PR template validation', () => {
  it('accepts a documented no-update decision without requiring README edits', async () => {
    expect((await check(validBody())).failures).toEqual([]);
  });
  it.each(['README.md', 'README-zh.md', 'CONTRIBUTING.md', 'docs/usage.md'])(
    'accepts applicable documentation in %s',
    async (file) => {
      expect(
        (
          await check(
            validBody(
              'updated',
              `${file}: document the new command and compatibility requirements.`,
            ),
          )
        ).failures,
      ).toEqual([]);
    },
  );
  it.each([
    '',
    'N/A',
    'TODO explain the affected documentation or why no update is needed.',
    'placeholder placeholder placeholder',
    '<explain why no documentation is needed>',
  ])('rejects incomplete evidence %j', async (reason) => {
    expect((await check(validBody('not-needed', reason))).failures).not.toEqual([]);
  });
  it.each(['pending', 'skip', 'not-needed\nDocumentation decision: updated'])(
    'rejects invalid or duplicate decisions %j',
    async (decision) => {
      expect((await check(validBody(decision))).failures).not.toEqual([]);
    },
  );
  it('rejects duplicate evidence and updated without a documentation path', async () => {
    expect(
      (await check(validBody('not-needed', `${reason}\nDocumentation evidence: ${reason}`)))
        .failures,
    ).not.toEqual([]);
    expect(
      (
        await check(
          validBody(
            'updated',
            'Only CHANGELOG.md records the bug fix; other pages were not changed.',
          ),
        )
      ).failures,
    ).not.toEqual([]);
  });
  it('requires the documentation assessment and every other checklist item', async () => {
    const checklist = validBody().split('## ✅ Checklist')[1].split('## 👀')[0];
    const labels = [...checklist.matchAll(/^- \[x\] (.+)$/gm)].map((match) => match[1]);
    expect(labels).toContain(assessed);
    for (const label of labels) {
      expect(
        (await check(validBody().replace(`- [x] ${label}`, `- [ ] ${label}`))).failures,
        label,
      ).not.toEqual([]);
    }
  });
  it('keeps testing and scope selections optional', async () => {
    const body = validBody().split('## ✅ Checklist');
    body[0] = body[0].replace(/- \[x\]/g, '- [ ]');
    expect((await check(body.join('## ✅ Checklist'))).failures).toEqual([]);
  });
  it.each(['<!--\n%s\n-->', '```markdown\n%s\n```', '~~~markdown\n%s\n~~~'])(
    'rejects hidden declarations in %s',
    async (wrapper) => {
      const declaration = `Documentation decision: not-needed\nDocumentation evidence: ${reason}`;
      expect(
        (await check(validBody().replace(declaration, wrapper.replace('%s', declaration))))
          .failures,
      ).not.toEqual([]);
      expect((await check(wrapper.replace('%s', validBody()))).failures).not.toEqual([]);
    },
  );
  it('rejects moved declarations, moved checklist items and duplicate sections or items', async () => {
    const declaration = `Documentation decision: not-needed\nDocumentation evidence: ${reason}`;
    const item = `- [x] ${assessed}`;
    for (const body of [
      validBody().replace(declaration, '') + `\n${declaration}`,
      validBody().replace(item, '') + `\n${item}`,
      validBody() + '\n## ✅ Checklist\n',
      validBody().replace(item, `${item}\n${item}`),
    ])
      expect((await check(body)).failures).not.toEqual([]);
  });
  it('reads only the base template and clears an existing failure comment', async () => {
    const result = await check(validBody(), true);
    expect(result.refs).toEqual(['trusted-base']);
    expect(result.comments).toEqual([
      '<!-- comet-pr-template-check -->\n✅ PR template check passed.\n',
    ]);
    expect(workflow.jobs['check-template'].steps).toHaveLength(1);
    expect(workflow.on).toHaveProperty('pull_request_target');
  });
});
