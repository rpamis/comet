import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { runExternalCommand } from '../../platform/process/external-command.js';
import type {
  ProjectRuleSection,
  ProjectRuleSource,
  ProjectRuleSourceKind,
  ProjectRuleCandidateSummary,
  ProjectRuleCandidateEnvelope,
  ProjectRulesFileSystem,
  ProjectRulesSelectionRequest,
  ProjectRulesServiceOptions,
  ProjectRulesState,
  ProjectRulesStatus,
  ProjectRuleCarrierProposal,
  ProjectRuleSourceSnapshot,
  ProjectRuleVerificationSummary,
  ProjectRulesVerificationResult,
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
// Native uses `native`; Classic changes persist their profile as `full`,
// `hotfix`, or `tweak`. `classic` remains an input alias for callers that
// report the host workflow rather than the persisted Classic profile, but is
// normalized to `full` so it cannot create a second evidence family.
const COMET_WORKFLOW_FAMILIES = new Set(['native', 'full', 'hotfix', 'tweak']);

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
  return {
    version: 1,
    initialized: false,
    lastScanAt: null,
    sources: [],
    observations: [],
    candidates: [],
  };
}

function normalizeState(value: unknown, projectId: string): ProjectRulesState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyState();
  const input = value as Record<string, unknown>;
  const observations = Array.isArray(input.observations) ? input.observations : [];
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const sources = Array.isArray(input.sources) ? input.sources : [];
  return {
    version: 1,
    initialized: input.initialized === true,
    lastScanAt: typeof input.lastScanAt === 'string' ? input.lastScanAt : null,
    sources: sources.filter(isSourceSnapshot),
    observations: observations
      .filter(isObservation)
      .map((observation) => ({ ...observation, projectId })),
    candidates: candidates.filter(isCandidate),
  };
}

function isSourceSnapshot(value: unknown): value is ProjectRuleSourceSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.path === 'string' &&
    (input.kind === 'comet-rules' || input.kind === 'agent-instructions') &&
    Number.isSafeInteger(input.sectionCount) &&
    typeof input.contentHash === 'string'
  );
}

function isObservation(value: unknown): value is RuleObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.projectId === 'string' &&
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

function isVisibleCandidate(candidate: RuleCandidate): candidate is RuleCandidate & {
  status: 'pending' | 'snoozed';
} {
  return candidate.status === 'pending' || candidate.status === 'snoozed';
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
    const stageIndex = lines.findIndex((line) => /^\s*(?:适用阶段|阶段)\s*[:：]/u.test(line));
    const scope =
      scopeIndex >= 0 ? lines[scopeIndex].replace(/^\s*适用范围\s*[:：]\s*/u, '') : undefined;
    const stage =
      stageIndex >= 0
        ? lines[stageIndex].replace(/^\s*(?:适用阶段|阶段)\s*[:：]\s*/u, '')
        : undefined;
    const text = lines
      .filter((_line, index) => index !== scopeIndex && index !== stageIndex)
      .join('\n')
      .trim();
    return {
      sourcePath,
      sourceKind,
      title,
      text,
      ...(scope ? { scope: scope.trim() } : {}),
      ...(stage ? { stage: stage.trim() } : {}),
    };
  });
}

function globRegExp(pattern: string): RegExp {
  const normalized = pattern.trim().replaceAll('\\', '/');
  let expression = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '*' && normalized[index + 1] === '*') {
      if (normalized[index + 2] === '/') {
        expression += '(?:.*/)?';
        index += 2;
      } else {
        expression += '.*';
        index += 1;
      }
      continue;
    }
    if (character === '*') {
      expression += '[^/]*';
      continue;
    }
    if (character === '?') {
      expression += '[^/]';
      continue;
    }
    expression += /[.+^${}()|[\]\\]/u.test(character) ? `\\${character}` : character;
  }
  return new RegExp(`^${expression}$`, 'u');
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
  if (section.scope && (!targetPath || !globRegExp(section.scope).test(targetPath))) return 0;
  if (section.stage && !matchesStage(section.stage, request.stage)) return 0;
  const query = new Set(tokens(`${request.task} ${targetPath}`));
  const haystack = new Set(tokens(`${section.title} ${section.text}`));
  let score = section.scope ? 4 : 0;
  let relevant = Boolean(section.scope);
  for (const token of query) {
    if (haystack.has(token)) {
      score += 2;
      relevant = true;
    }
  }
  const task = request.task.trim().toLocaleLowerCase();
  if (task && section.title.toLocaleLowerCase().includes(task)) {
    score += 2;
    relevant = true;
  }
  if (!relevant) return 0;
  return score;
}

function matchesStage(sectionStage: string, requestedStage: string | undefined): boolean {
  if (!requestedStage) return false;
  const requested = requestedStage.trim().toLocaleLowerCase();
  return sectionStage
    .split(/[;,|\s]+/u)
    .map((value) => value.trim().toLocaleLowerCase())
    .filter(Boolean)
    .some((value) => value === requested || value === '*');
}

function candidateId(key: string, text: string): string {
  return `candidate-${createHash('sha256')
    .update(`${key}\n${text.trim()}`)
    .digest('hex')
    .slice(0, 16)}`;
}

function commandForPackageManager(
  manager: string | undefined,
  lockFiles: readonly string[],
): string {
  if (manager?.startsWith('pnpm')) return 'pnpm';
  if (manager?.startsWith('yarn')) return 'yarn';
  if (manager?.startsWith('npm')) return 'npm';
  if (lockFiles.includes('pnpm-lock.yaml')) return 'pnpm';
  if (lockFiles.includes('yarn.lock')) return 'yarn';
  return 'npm';
}

function sourceSnapshot(source: ProjectRuleSource, content: string): ProjectRuleSourceSnapshot {
  return {
    path: source.path,
    kind: source.kind,
    sectionCount: source.sections.length,
    contentHash: createHash('sha256').update(content).digest('hex'),
  };
}

function hasMeaningfulBuildScript(content: string): boolean {
  return stripGradleComments(content).trim().length > 0;
}

function hasGradleCheckTask(content: string): boolean {
  const script = stripGradleComments(content);
  const knownCheckPlugins =
    /(?:id\s*\(?\s*['"](?:java|java-library|kotlin|groovy|scala|application|checkstyle|pmd|jacoco)['"]|apply\s+plugin\s*:\s*['"](?:java|java-library|kotlin|groovy|scala|application|checkstyle|pmd|jacoco)['"])/u;
  const explicitCheckTask =
    /(?:tasks?\s*\.\s*(?:register|named|create)\s*\(?\s*['"]check['"]|task\s*\(?\s*['"]check['"]|\bcheck\s*\{)/u;
  return knownCheckPlugins.test(script) || explicitCheckTask.test(script);
}

function stripGradleComments(content: string): string {
  return content.replace(/\/\/.*$/gmu, '').replace(/\/\*[\s\S]*?\*\//gu, '');
}

function hasUsableMavenProject(content: string): boolean {
  const project = directXmlElements(content, 'project');
  if (!project) return false;
  const parent = project.get('parent');
  const parentElements = parent ? directXmlElements(`<parent>${parent}</parent>`, 'parent') : null;
  const hasValue = (elements: ReadonlyMap<string, string> | null, name: string): boolean =>
    (elements?.get(name)?.trim().length ?? 0) > 0;
  return (
    hasValue(project, 'modelVersion') &&
    hasValue(project, 'artifactId') &&
    (hasValue(project, 'groupId') || hasValue(parentElements, 'groupId')) &&
    (hasValue(project, 'version') || hasValue(parentElements, 'version'))
  );
}

function directXmlElements(content: string, rootName: string): Map<string, string> | null {
  const project = content.replace(/<!--[\s\S]*?-->/gu, '').trim();
  const rootStart = new RegExp(`<${rootName}(?:\\s[^>]*)?>`, 'u').exec(project);
  const rootEnd = new RegExp(`</${rootName}>\\s*$`, 'u').exec(project);
  if (!rootStart || !rootEnd || rootStart.index >= rootEnd.index) return null;
  const body = project.slice(rootStart.index + rootStart[0].length, rootEnd.index);
  const elements = new Map<string, string>();
  const stack: string[] = [];
  let directName: string | null = null;
  let directValueStart = 0;
  const tags = /<\/?([A-Za-z_][\w:.-]*)(?:\s[^>]*)?\/?>/gu;
  for (const match of body.matchAll(tags)) {
    const token = match[0];
    const name = match[1];
    if (token.startsWith('</')) {
      if (stack.pop() !== name) return null;
      if (stack.length === 0 && directName === name) {
        elements.set(name, body.slice(directValueStart, match.index).trim());
        directName = null;
      }
    } else if (token.endsWith('/>')) {
      if (stack.length === 0) elements.set(name, '');
    } else {
      if (stack.length === 0) {
        directName = name;
        directValueStart = (match.index ?? 0) + token.length;
      }
      stack.push(name);
    }
  }
  return stack.length === 0 && directName === null ? elements : null;
}

function hasUsablePytestProject(pyproject: string | null, pytestIni: string | null): boolean {
  if (pytestIni !== null || pyproject === null) return pytestIni !== null;
  const lines = pyproject.replace(/^\s*#.*$/gmu, '').split(/\r?\n/u);
  let section = '';
  for (const line of lines) {
    const heading = /^\s*\[([^\]]+)\]\s*$/u.exec(line);
    if (heading) {
      section = heading[1].toLocaleLowerCase();
      if (section.startsWith('tool.pytest')) return true;
      continue;
    }
    if (section.includes('dependenc') && /^\s*pytest\s*(?:[=<>!~]|$)/u.test(line)) return true;
    if (
      section === 'project' &&
      /^\s*(?:dependencies|optional-dependencies)\s*=.*\bpytest(?:[<>=~!]|["'])/u.test(line)
    ) {
      return true;
    }
  }
  return false;
}

export class ProjectRulesService {
  private readonly projectRoot: string;
  private readonly projectId: string;
  private readonly runtimeDirectory: string;
  private readonly stateFile: string;
  private readonly fileSystem: ProjectRulesFileSystem;
  private readonly now: () => Date;
  private readonly runVerification: (
    executable: string,
    args: readonly string[],
    cwd: string,
  ) => string;
  private readonly repairVerification:
    | ((failure: ProjectRulesVerificationResult) => Promise<boolean>)
    | undefined;
  private state: ProjectRulesState | null = null;

  public constructor(options: ProjectRulesServiceOptions) {
    this.projectRoot = path.resolve(options.projectRoot);
    this.projectId =
      options.projectId?.trim() ||
      createHash('sha256').update(this.projectRoot).digest('hex').slice(0, 16);
    const expectedRuntimeDirectory = path.resolve(
      this.projectRoot,
      '.comet',
      'runtime',
      'project-rules',
    );
    const runtimeDirectory = path.resolve(options.runtimeDirectory ?? expectedRuntimeDirectory);
    if (path.relative(expectedRuntimeDirectory, runtimeDirectory) !== '') {
      throw new Error('Project rules runtime directory must be .comet/runtime/project-rules');
    }
    this.runtimeDirectory = runtimeDirectory;
    this.stateFile = path.join(this.runtimeDirectory, STATE_FILE);
    this.fileSystem = options.fileSystem ?? createDefaultFileSystem();
    this.now = options.now ?? (() => new Date());
    this.runVerification =
      options.runVerification ??
      ((executable, args, cwd) => runExternalCommand(executable, args, { cwd }));
    this.repairVerification = options.repairVerification;
  }

  public async init(): Promise<ProjectRulesStatus> {
    return this.scan();
  }

  public async scan(): Promise<ProjectRulesStatus> {
    const state = await this.ensureState();
    const sources = await this.readSources();
    const snapshots: ProjectRuleSourceSnapshot[] = [];
    for (const source of sources) {
      const content = await this.fileSystem.readText(path.join(this.projectRoot, source.path));
      if (content !== null) snapshots.push(sourceSnapshot(source, content));
    }
    const next = {
      ...state,
      initialized: true,
      lastScanAt: this.now().toISOString(),
      sources: snapshots,
    };
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
    const allowedSources = request.sourceKinds ? new Set(request.sourceKinds) : null;
    const sections = (await this.readSources())
      .filter((source) => allowedSources === null || allowedSources.has(source.kind))
      .flatMap((source) => source.sections);
    const ranked = sections
      .map((section) => ({ ...section, score: scoreSection(section, request) }))
      .filter((section) => section.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.sourcePath.localeCompare(right.sourcePath) ||
          left.title.localeCompare(right.title),
      );
    const maxSections = Math.min(
      DEFAULT_MAX_SECTIONS,
      Math.max(1, request.maxSections ?? DEFAULT_MAX_SECTIONS),
    );
    const maxBytes = Math.min(
      DEFAULT_MAX_BYTES,
      Math.max(1, request.maxBytes ?? DEFAULT_MAX_BYTES),
    );
    const selected: SelectedProjectRule[] = [];
    for (const section of ranked) {
      if (selected.length >= maxSections) continue;
      const candidate = [...selected, section];
      if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > maxBytes) continue;
      selected.push(section);
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
    observation: Omit<RuleObservation, 'observedAt' | 'projectId'>,
  ): Promise<RuleCandidate | null> {
    const candidateKey = observation.candidateKey.trim();
    const workflowInput = observation.workflow.trim().toLocaleLowerCase();
    const workflow = workflowInput === 'classic' ? 'full' : workflowInput;
    const changeId = observation.changeId.trim();
    const text = observation.text.trim();
    if (!candidateKey || !workflow || !changeId || !text) {
      throw new Error(
        'Project rule observations require candidate key, workflow, change ID, and text',
      );
    }
    if (!COMET_WORKFLOW_FAMILIES.has(workflow.toLocaleLowerCase())) {
      throw new Error(`Unsupported Comet workflow family: ${workflow}`);
    }
    const state = await this.ensureState();
    const observedAt = this.now().toISOString();
    const duplicateIndex = state.observations.findIndex(
      (entry) =>
        entry.projectId === this.projectId &&
        entry.candidateKey === candidateKey &&
        entry.workflow === workflow &&
        entry.changeId === changeId,
    );
    const observedEntry: RuleObservation = {
      ...observation,
      candidateKey,
      workflow,
      changeId,
      text,
      projectId: this.projectId,
      observedAt,
    };
    const nextObservations = [...state.observations];
    if (duplicateIndex >= 0) {
      const previous = nextObservations[duplicateIndex];
      if (previous.success || !observation.success || previous.text.trim() !== text) {
        return (
          state.candidates.find(
            (candidate) => candidate.key === candidateKey && candidate.text.trim() === text,
          ) ?? null
        );
      }
      nextObservations[duplicateIndex] = observedEntry;
    } else {
      nextObservations.push(observedEntry);
    }
    const successful = nextObservations.filter(
      (entry) =>
        entry.projectId === this.projectId &&
        entry.candidateKey === candidateKey &&
        entry.text.trim() === text &&
        entry.success,
    );
    let candidates = [...state.candidates];
    if (
      successful.length >= 2 &&
      !candidates.some(
        (candidate) => candidate.key === candidateKey && candidate.text.trim() === text,
      )
    ) {
      candidates.push({
        id: candidateId(candidateKey, text),
        key: candidateKey,
        text,
        status: 'pending',
        observations: successful.length,
        createdAt: observedAt,
        updatedAt: observedAt,
      });
    } else {
      candidates = candidates.map((candidate) =>
        candidate.key === candidateKey && candidate.text.trim() === text
          ? { ...candidate, observations: successful.length, updatedAt: observedAt }
          : candidate,
      );
    }
    await this.persist({ ...state, observations: nextObservations, candidates });
    return (
      candidates.find(
        (candidate) => candidate.key === candidateKey && candidate.text.trim() === text,
      ) ?? null
    );
  }

  public async candidates(): Promise<readonly ProjectRuleCandidateSummary[]> {
    return (await this.ensureState()).candidates.filter(isVisibleCandidate).map((candidate) => ({
      text: candidate.text,
      state: candidate.status,
    }));
  }

  public async candidateEnvelope(): Promise<ProjectRuleCandidateEnvelope> {
    const candidates = await this.candidates();
    return {
      candidates,
      summary:
        candidates.length === 0
          ? '当前没有待处理的项目规则候选。'
          : candidates.map((candidate, index) => `${index + 1}. ${candidate.text}`).join('\n'),
      operations: ['adopt', 'ignore', 'snooze', 'restore'],
    };
  }

  public async candidateDetails(): Promise<readonly RuleCandidate[]> {
    return (await this.ensureState()).candidates.filter(isVisibleCandidate);
  }

  public async adoptCandidate(id: string, targetPath?: string): Promise<void> {
    const state = await this.ensureState();
    const candidate = state.candidates.find((entry) => entry.id === id);
    if (!candidate) throw new Error(`Unknown project rule candidate: ${id}`);
    const proposal = targetPath === undefined ? await this.proposeCarrier() : null;
    if (proposal?.kind === 'agent-instructions' && proposal.sourcePath !== undefined) {
      await this.appendCarrierRule(proposal.sourcePath, candidate.text);
    } else if (proposal?.kind === 'verification') {
      await this.writeVerificationCarrierProposal(candidate, proposal);
    } else {
      await this.addRule(candidate.text, targetPath ?? '.comet/rules/project.md');
    }
    await this.persist({
      ...state,
      candidates: state.candidates.map((entry) =>
        entry.id === id
          ? { ...entry, status: 'adopted', updatedAt: this.now().toISOString() }
          : entry,
      ),
    });
  }

  private async appendCarrierRule(
    sourcePath: string,
    text: string,
    verificationNote?: string,
  ): Promise<void> {
    const normalized = this.projectRelative(sourcePath);
    if (!KNOWN_INSTRUCTION_FILES.includes(normalized as (typeof KNOWN_INSTRUCTION_FILES)[number])) {
      throw new Error(`Project rule carrier is not an allowed Agent instruction: ${sourcePath}`);
    }
    const absolute = path.join(this.projectRoot, normalized);
    const existing = (await this.fileSystem.readText(absolute)) ?? '';
    const separator = existing.length === 0 || existing.endsWith('\n') ? '\n' : '\n\n';
    const suffix = verificationNote ? `（${verificationNote}）` : '';
    await this.fileSystem.writeText(absolute, `${existing}${separator}- ${text.trim()}${suffix}\n`);
  }

  private async writeVerificationCarrierProposal(
    candidate: RuleCandidate,
    proposal: ProjectRuleCarrierProposal,
  ): Promise<void> {
    const targetPath = proposal.targetPath ?? `.comet/rules/proposals/${candidate.id}.md`;
    const normalized = this.projectRelative(targetPath);
    const absolute = path.join(this.projectRoot, normalized);
    const content = [
      '# 项目规则实施提案',
      '',
      `- 规则：${candidate.text.trim()}`,
      `- 验证入口：${proposal.label}`,
      `- 原生文件：${proposal.sourcePath ?? '未识别'}`,
      `- 建议改动：${proposal.change ?? '在该项目已有验证配置或测试中加入确定性检查。'}`,
      '',
      '该文件是可读的实施提案；采用后由 Agent 在项目原生配置或测试中完成对应改动，验证入口负责阻止不符合规则的结果。',
      '',
    ].join('\n');
    await this.fileSystem.writeText(absolute, content);
  }

  public async ignoreCandidate(id: string): Promise<void> {
    await this.updateCandidateStatus(id, 'ignored');
  }

  public async snoozeCandidate(id: string): Promise<void> {
    await this.updateCandidateStatus(id, 'snoozed');
  }

  public async restoreCandidate(id: string): Promise<void> {
    const state = await this.ensureState();
    if (!state.candidates.some((candidate) => candidate.id === id)) {
      throw new Error(`Unknown project rule candidate: ${id}`);
    }
    await this.persist({
      ...state,
      candidates: state.candidates.map((candidate) =>
        candidate.id === id
          ? { ...candidate, status: 'pending', updatedAt: this.now().toISOString() }
          : candidate,
      ),
    });
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
        const lockFiles = await Promise.all(
          ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'].map(async (file) =>
            (await this.fileSystem.readText(path.join(this.projectRoot, file))) !== null
              ? file
              : null,
          ),
        );
        const manager = commandForPackageManager(
          parsed.packageManager,
          lockFiles.filter((file): file is string => file !== null),
        );
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
    const pom = await this.fileSystem.readText(path.join(this.projectRoot, 'pom.xml'));
    if (pom && hasUsableMavenProject(pom)) {
      const mavenExecutable =
        (await this.fileSystem.readText(path.join(this.projectRoot, 'mvnw'))) !== null
          ? './mvnw'
          : (await this.fileSystem.readText(path.join(this.projectRoot, 'mvnw.cmd'))) !== null
            ? 'mvnw.cmd'
            : 'mvn';
      entries.push({
        id: 'maven-verify',
        label: 'mvn verify',
        executable: mavenExecutable,
        args: ['verify'],
        cwd: '.',
        sourcePath: 'pom.xml',
      });
    }
    const gradle = await this.fileSystem.readText(path.join(this.projectRoot, 'build.gradle'));
    const gradleKotlin = await this.fileSystem.readText(
      path.join(this.projectRoot, 'build.gradle.kts'),
    );
    const gradleScript = gradle ?? gradleKotlin;
    const gradleWrapper =
      (await this.fileSystem.readText(path.join(this.projectRoot, 'gradlew'))) !== null
        ? './gradlew'
        : (await this.fileSystem.readText(path.join(this.projectRoot, 'gradlew.bat'))) !== null
          ? 'gradlew.bat'
          : 'gradle';
    if (
      gradleScript &&
      hasMeaningfulBuildScript(gradleScript) &&
      hasGradleCheckTask(gradleScript)
    ) {
      entries.push({
        id: 'gradle-check',
        label: 'gradle check',
        executable: gradleWrapper,
        args: ['check'],
        cwd: '.',
        sourcePath: gradle ? 'build.gradle' : 'build.gradle.kts',
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
    const pyproject = await this.fileSystem.readText(path.join(this.projectRoot, 'pyproject.toml'));
    const pytestIni = await this.fileSystem.readText(path.join(this.projectRoot, 'pytest.ini'));
    if (hasUsablePytestProject(pyproject, pytestIni)) {
      entries.push({
        id: 'python-pytest',
        label: 'python -m pytest',
        executable: 'python',
        args: ['-m', 'pytest'],
        cwd: '.',
        sourcePath: pyproject ? 'pyproject.toml' : 'pytest.ini',
      });
    }
    return entries;
  }

  public async proposeCarrier(): Promise<ProjectRuleCarrierProposal> {
    const entrypoint = (await this.discoverVerificationEntrypoints())[0];
    if (entrypoint !== undefined) {
      return {
        kind: 'verification',
        label: entrypoint.label,
        sourcePath: entrypoint.sourcePath,
        targetPath: `.comet/rules/proposals/${entrypoint.id}.md`,
        change: `在 ${entrypoint.sourcePath} 对应的项目验证配置或测试中加入该规则，并继续使用 ${entrypoint.label} 校验。`,
        reason: '项目已有可执行的验证入口，规则应优先由该入口在编译或检查阶段校验。',
      };
    }
    const instruction = (await this.readSources()).find(
      (source) => source.kind === 'agent-instructions',
    );
    if (instruction !== undefined) {
      return {
        kind: 'agent-instructions',
        label: instruction.path,
        sourcePath: instruction.path,
        reason: '项目已有 Agent 指令文件，规则可按任务范围选择性注入。',
      };
    }
    return {
      kind: 'comet-rules',
      label: '.comet/rules/project.md',
      reason: '项目暂无可识别的验证入口或 Agent 指令文件，先保存在 Comet 项目规则中。',
    };
  }

  public async verify(
    options: { readonly maxAttempts?: number } = {},
  ): Promise<ProjectRulesVerificationResult> {
    const entrypoint = (await this.discoverVerificationEntrypoints())[0];
    if (entrypoint === undefined) {
      return {
        passed: false,
        label: null,
        sourcePath: null,
        output: '没有发现可执行的项目验证入口。',
        attempts: 0,
        nextAction: 'fix-and-rerun',
      };
    }
    const maxAttempts = Math.min(3, Math.max(1, options.maxAttempts ?? 1));
    let attempts = 0;
    let failure: ProjectRulesVerificationResult | null = null;
    while (attempts < maxAttempts) {
      attempts += 1;
      try {
        return {
          passed: true,
          label: entrypoint.label,
          sourcePath: entrypoint.sourcePath,
          output: this.runVerification(
            entrypoint.executable,
            entrypoint.args,
            path.resolve(this.projectRoot, entrypoint.cwd),
          ),
          attempts,
          nextAction: 'complete',
        };
      } catch (error) {
        failure = {
          passed: false,
          label: entrypoint.label,
          sourcePath: entrypoint.sourcePath,
          output: error instanceof Error ? error.message : String(error),
          attempts,
          nextAction: 'fix-and-rerun',
        };
        if (attempts >= maxAttempts || this.repairVerification === undefined) break;
        if (!(await this.repairVerification(failure))) break;
      }
    }
    return (
      failure ?? {
        passed: false,
        label: entrypoint.label,
        sourcePath: entrypoint.sourcePath,
        output: '项目验证未运行。',
        attempts,
        nextAction: 'fix-and-rerun',
      }
    );
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
    this.state = content
      ? normalizeState(JSON.parse(content) as unknown, this.projectId)
      : emptyState();
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
      verificationEntrypoints: (await this.discoverVerificationEntrypoints()).map(
        (entrypoint): ProjectRuleVerificationSummary => ({
          label: entrypoint.label,
          sourcePath: entrypoint.sourcePath,
        }),
      ),
      carrier: await this.proposeCarrier(),
      candidates: state.candidates.filter(isVisibleCandidate).map(
        (candidate): ProjectRuleCandidateSummary => ({
          text: candidate.text,
          state: candidate.status,
        }),
      ),
    };
  }
}

export type { ProjectRulesStatus } from './types.js';
