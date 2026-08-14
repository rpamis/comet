import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type {
  ProjectRuleSection,
  ProjectRuleSource,
  ProjectRuleSourceKind,
  ProjectRulesFileSystem,
  ProjectRulesSelectionRequest,
  ProjectRulesServiceOptions,
  ProjectRulesState,
  ProjectRulesStatus,
  RuleCandidate,
  RuleObservation,
  SelectedProjectRule,
  VerificationEntrypoint,
} from './types.js';

const DEFAULT_MAX_SECTIONS = 5;
const DEFAULT_MAX_BYTES = 8 * 1024;
const STATE_FILE = 'state.json';
const KNOWN_INSTRUCTION_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.github/copilot-instructions.md',
] as const;

function createDefaultFileSystem(): ProjectRulesFileSystem {
  return {
    readText: async (filePath) => {
      try {
        return await fs.readFile(filePath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
        throw error;
      }
    },
    writeText: async (filePath, content) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf8');
    },
    listFiles: async (directoryPath) => {
      try {
        const entries = await fs.readdir(directoryPath, { withFileTypes: true });
        return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
        throw error;
      }
    },
  };
}

function cloneState(state: ProjectRulesState): ProjectRulesState {
  return JSON.parse(JSON.stringify(state)) as ProjectRulesState;
}

function emptyState(): ProjectRulesState {
  return { version: 1, initialized: false, lastScanAt: null, observations: [], candidates: [] };
}

function normalizeState(value: unknown): ProjectRulesState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyState();
  const input = value as Record<string, unknown>;
  const observations = Array.isArray(input.observations) ? input.observations : [];
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  return {
    version: 1,
    initialized: input.initialized === true,
    lastScanAt: typeof input.lastScanAt === 'string' ? input.lastScanAt : null,
    observations: observations.filter(isObservation),
    candidates: candidates.filter(isCandidate),
  };
}

function isObservation(value: unknown): value is RuleObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.candidateKey === 'string' &&
    typeof input.text === 'string' &&
    typeof input.workflow === 'string' &&
    typeof input.changeId === 'string' &&
    typeof input.success === 'boolean' &&
    (input.source === undefined || typeof input.source === 'string') &&
    typeof input.observedAt === 'string'
  );
}

function isCandidate(value: unknown): value is RuleCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.id === 'string' &&
    typeof input.key === 'string' &&
    typeof input.text === 'string' &&
    (input.status === 'pending' ||
      input.status === 'ignored' ||
      input.status === 'snoozed' ||
      input.status === 'adopted') &&
    Number.isSafeInteger(input.observations) &&
    typeof input.createdAt === 'string' &&
    typeof input.updatedAt === 'string'
  );
}

function markdownSections(
  sourcePath: string,
  sourceKind: ProjectRuleSourceKind,
  content: string,
): ProjectRuleSection[] {
  const lines = content.replaceAll('\r\n', '\n').split('\n');
  const sections: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
    if (heading) {
      if (current && current.lines.join('\n').trim()) sections.push(current);
      current = { title: heading[2], lines: [] };
      continue;
    }
    if (current === null) current = { title: path.basename(sourcePath), lines: [] };
    current.lines.push(line);
  }
  if (current && current.lines.join('\n').trim()) sections.push(current);

  return sections.map(({ title, lines }) => {
    const scopeIndex = lines.findIndex((line) => /^\s*适用范围\s*[:：]/u.test(line));
    const scope =
      scopeIndex >= 0 ? lines[scopeIndex].replace(/^\s*适用范围\s*[:：]\s*/u, '') : undefined;
    const text = lines
      .filter((_line, index) => index !== scopeIndex)
      .join('\n')
      .trim();
    return {
      sourcePath,
      sourceKind,
      title,
      text,
      ...(scope ? { scope: scope.trim() } : {}),
    };
  });
}

function globRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replaceAll('**', '.*')
    .replaceAll('*', '[^/]*')
    .replaceAll('?', '[^/]');
  return new RegExp(`^${escaped}$`, 'u');
}

function tokens(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}_/-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function scoreSection(section: ProjectRuleSection, request: ProjectRulesSelectionRequest): number {
  const targetPath = request.path?.replaceAll('\\', '/') ?? '';
  if (section.scope && !globRegExp(section.scope).test(targetPath)) return 0;
  const query = new Set(tokens(`${request.task} ${targetPath}`));
  const haystack = new Set(tokens(`${section.title} ${section.text}`));
  let score = section.scope ? 4 : 1;
  for (const token of query) if (haystack.has(token)) score += 2;
  if (section.title.toLocaleLowerCase().includes(request.task.toLocaleLowerCase())) score += 2;
  return score;
}

function candidateId(key: string): string {
  return `candidate-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

function commandForPackageManager(projectRoot: string, manager: string | undefined): string {
  if (manager?.startsWith('pnpm')) return 'pnpm';
  if (manager?.startsWith('yarn')) return 'yarn';
  if (manager?.startsWith('npm')) return 'npm';
  if (projectRoot.length > 0) return 'npm';
  return 'npm';
}

export class ProjectRulesService {
  private readonly projectRoot: string;
  private readonly runtimeDirectory: string;
  private readonly stateFile: string;
  private readonly fileSystem: ProjectRulesFileSystem;
  private readonly now: () => Date;
  private state: ProjectRulesState | null = null;

  public constructor(options: ProjectRulesServiceOptions) {
    this.projectRoot = path.resolve(options.projectRoot);
    this.runtimeDirectory = path.resolve(
      options.runtimeDirectory ?? path.join(this.projectRoot, '.comet', 'runtime', 'project-rules'),
    );
    this.stateFile = path.join(this.runtimeDirectory, STATE_FILE);
    this.fileSystem = options.fileSystem ?? createDefaultFileSystem();
    this.now = options.now ?? (() => new Date());
  }

  public async init(): Promise<ProjectRulesStatus> {
    return this.scan();
  }

  public async scan(): Promise<ProjectRulesStatus> {
    const state = await this.ensureState();
    const sources = await this.readSources();
    const next = { ...state, initialized: true, lastScanAt: this.now().toISOString() };
    await this.persist(next);
    return this.toStatus(next, sources);
  }

  public async status(): Promise<ProjectRulesStatus> {
    const state = await this.ensureState();
    const sources = await this.readSources();
    return this.toStatus(state, sources);
  }

  public async readSources(): Promise<readonly ProjectRuleSource[]> {
    const files: Array<{ path: string; kind: ProjectRuleSourceKind }> = [];
    const ruleFiles = (
      await this.fileSystem.listFiles(path.join(this.projectRoot, '.comet', 'rules'))
    )
      .filter((file) => file.toLocaleLowerCase().endsWith('.md'))
      .sort((left, right) => left.localeCompare(right));
    for (const file of ruleFiles) files.push({ path: `.comet/rules/${file}`, kind: 'comet-rules' });
    for (const known of KNOWN_INSTRUCTION_FILES) {
      if (await this.fileSystem.readText(path.join(this.projectRoot, known))) {
        files.push({ path: known, kind: 'agent-instructions' });
      }
    }
    const sources: ProjectRuleSource[] = [];
    for (const file of files) {
      const content = await this.fileSystem.readText(path.join(this.projectRoot, file.path));
      if (content === null) continue;
      sources.push({
        path: file.path,
        kind: file.kind,
        sections: markdownSections(file.path, file.kind, content),
      });
    }
    return sources;
  }

  public async select(
    request: ProjectRulesSelectionRequest,
  ): Promise<readonly SelectedProjectRule[]> {
    const sections = (await this.readSources()).flatMap((source) => source.sections);
    const ranked = sections
      .map((section) => ({ ...section, score: scoreSection(section, request) }))
      .filter((section) => section.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.sourcePath.localeCompare(right.sourcePath) ||
          left.title.localeCompare(right.title),
      );
    const maxSections = Math.max(1, request.maxSections ?? DEFAULT_MAX_SECTIONS);
    const maxBytes = Math.max(1, request.maxBytes ?? DEFAULT_MAX_BYTES);
    const selected: SelectedProjectRule[] = [];
    let bytes = 0;
    for (const section of ranked) {
      const sectionBytes = Buffer.byteLength(`${section.title}\n${section.text}`, 'utf8');
      if (selected.length >= maxSections || bytes + sectionBytes > maxBytes) continue;
      selected.push(section);
      bytes += sectionBytes;
    }
    return selected;
  }

  public async addRule(text: string, targetPath = '.comet/rules/project.md'): Promise<void> {
    if (text.trim().length === 0) throw new Error('Project rule text must not be empty');
    const normalized = this.projectRelative(targetPath);
    if (
      !normalized.startsWith('.comet/rules/') ||
      !normalized.toLocaleLowerCase().endsWith('.md')
    ) {
      throw new Error('Project rule target must be a Markdown file under .comet/rules/');
    }
    const absolute = path.join(this.projectRoot, normalized);
    const existing = (await this.fileSystem.readText(absolute)) ?? '# 项目规则\n';
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    await this.fileSystem.writeText(absolute, `${existing}${separator}- ${text.trim()}\n`);
  }

  public async recordObservation(
    observation: Omit<RuleObservation, 'observedAt'>,
  ): Promise<RuleCandidate | null> {
    const state = await this.ensureState();
    const observedAt = this.now().toISOString();
    const duplicate = state.observations.some(
      (entry) =>
        entry.candidateKey === observation.candidateKey &&
        entry.workflow === observation.workflow &&
        entry.changeId === observation.changeId,
    );
    if (duplicate)
      return (
        state.candidates.find((candidate) => candidate.key === observation.candidateKey) ?? null
      );
    const nextObservations = [...state.observations, { ...observation, observedAt }];
    const successful = nextObservations.filter(
      (entry) => entry.candidateKey === observation.candidateKey && entry.success,
    );
    let candidates = [...state.candidates];
    if (
      successful.length >= 2 &&
      !candidates.some((candidate) => candidate.key === observation.candidateKey)
    ) {
      candidates.push({
        id: candidateId(observation.candidateKey),
        key: observation.candidateKey,
        text: observation.text,
        status: 'pending',
        observations: successful.length,
        createdAt: observedAt,
        updatedAt: observedAt,
      });
    } else {
      candidates = candidates.map((candidate) =>
        candidate.key === observation.candidateKey
          ? { ...candidate, observations: successful.length, updatedAt: observedAt }
          : candidate,
      );
    }
    await this.persist({ ...state, observations: nextObservations, candidates });
    return candidates.find((candidate) => candidate.key === observation.candidateKey) ?? null;
  }

  public async candidates(): Promise<readonly RuleCandidate[]> {
    return (await this.ensureState()).candidates.filter(
      (candidate) => candidate.status === 'pending',
    );
  }

  public async adoptCandidate(id: string, targetPath = '.comet/rules/project.md'): Promise<void> {
    const state = await this.ensureState();
    const candidate = state.candidates.find((entry) => entry.id === id);
    if (!candidate) throw new Error(`Unknown project rule candidate: ${id}`);
    await this.addRule(candidate.text, targetPath);
    await this.persist({
      ...state,
      candidates: state.candidates.map((entry) =>
        entry.id === id
          ? { ...entry, status: 'adopted', updatedAt: this.now().toISOString() }
          : entry,
      ),
    });
  }

  public async ignoreCandidate(id: string): Promise<void> {
    await this.updateCandidateStatus(id, 'ignored');
  }

  public async snoozeCandidate(id: string): Promise<void> {
    await this.updateCandidateStatus(id, 'snoozed');
  }

  public async discoverVerificationEntrypoints(): Promise<readonly VerificationEntrypoint[]> {
    const entries: VerificationEntrypoint[] = [];
    const packageJson = await this.fileSystem.readText(path.join(this.projectRoot, 'package.json'));
    if (packageJson) {
      try {
        const parsed = JSON.parse(packageJson) as {
          packageManager?: string;
          scripts?: Record<string, string>;
        };
        const manager = commandForPackageManager(this.projectRoot, parsed.packageManager);
        for (const script of ['lint', 'test', 'check', 'verify', 'build']) {
          if (parsed.scripts?.[script]) {
            entries.push({
              id: `package-${script}`,
              label: `${manager} run ${script}`,
              executable: manager,
              args: ['run', script],
              cwd: '.',
              sourcePath: 'package.json',
            });
          }
        }
      } catch {
        // Ignore malformed package metadata; another project-native entry may still be usable.
      }
    }
    if (await this.fileSystem.readText(path.join(this.projectRoot, 'pom.xml'))) {
      entries.push({
        id: 'maven-verify',
        label: 'mvn verify',
        executable: 'mvn',
        args: ['verify'],
        cwd: '.',
        sourcePath: 'pom.xml',
      });
    }
    if (await this.fileSystem.readText(path.join(this.projectRoot, 'build.gradle'))) {
      entries.push({
        id: 'gradle-check',
        label: 'gradle check',
        executable: 'gradle',
        args: ['check'],
        cwd: '.',
        sourcePath: 'build.gradle',
      });
    }
    if (await this.fileSystem.readText(path.join(this.projectRoot, 'build.gradle.kts'))) {
      entries.push({
        id: 'gradle-check',
        label: 'gradle check',
        executable: 'gradle',
        args: ['check'],
        cwd: '.',
        sourcePath: 'build.gradle.kts',
      });
    }
    const makefile = await this.fileSystem.readText(path.join(this.projectRoot, 'Makefile'));
    if (makefile) {
      const target = /^(?:check|test|lint):/mu.exec(makefile)?.[0]?.split(':')[0] ?? null;
      if (target)
        entries.push({
          id: `make-${target}`,
          label: `make ${target}`,
          executable: 'make',
          args: [target],
          cwd: '.',
          sourcePath: 'Makefile',
        });
    }
    if (
      (await this.fileSystem.readText(path.join(this.projectRoot, 'pyproject.toml'))) ||
      (await this.fileSystem.readText(path.join(this.projectRoot, 'pytest.ini')))
    ) {
      entries.push({
        id: 'python-pytest',
        label: 'python -m pytest',
        executable: 'python',
        args: ['-m', 'pytest'],
        cwd: '.',
        sourcePath: 'pyproject.toml',
      });
    }
    return entries;
  }

  private async updateCandidateStatus(id: string, status: 'ignored' | 'snoozed'): Promise<void> {
    const state = await this.ensureState();
    if (!state.candidates.some((candidate) => candidate.id === id)) {
      throw new Error(`Unknown project rule candidate: ${id}`);
    }
    await this.persist({
      ...state,
      candidates: state.candidates.map((candidate) =>
        candidate.id === id
          ? { ...candidate, status, updatedAt: this.now().toISOString() }
          : candidate,
      ),
    });
  }

  private async ensureState(): Promise<ProjectRulesState> {
    if (this.state !== null) return this.state;
    const content = await this.fileSystem.readText(this.stateFile);
    this.state = content ? normalizeState(JSON.parse(content) as unknown) : emptyState();
    return this.state;
  }

  private async persist(state: ProjectRulesState): Promise<void> {
    this.state = cloneState(state);
    await this.fileSystem.writeText(this.stateFile, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  private projectRelative(candidate: string): string {
    const normalized = candidate.replaceAll('\\', '/').replace(/^\.\//u, '');
    if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized)) {
      throw new Error('Project rule path must be project-relative');
    }
    const resolved = path.resolve(this.projectRoot, ...normalized.split('/'));
    const relative = path.relative(this.projectRoot, resolved).replaceAll('\\', '/');
    if (!relative || relative === '..' || relative.startsWith('../')) {
      throw new Error('Project rule path escaped the project root');
    }
    return relative;
  }

  private async toStatus(
    state: ProjectRulesState,
    sources: readonly ProjectRuleSource[],
  ): Promise<ProjectRulesStatus> {
    return {
      initialized: state.initialized,
      lastScanAt: state.lastScanAt,
      sources: sources.map((source) => ({
        path: source.path,
        kind: source.kind,
        sectionCount: source.sections.length,
      })),
      verificationEntrypoints: await this.discoverVerificationEntrypoints(),
      candidates: state.candidates.filter((candidate) => candidate.status === 'pending'),
    };
  }
}

export type { ProjectRulesStatus } from './types.js';
