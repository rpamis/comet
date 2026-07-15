import { promises as fs } from 'fs';
import path from 'path';
import { parseDocument } from 'yaml';
import {
  COMET_RESUME_PROBE_SCHEMA_VERSION,
  resolveCometEntryResumeProbe,
  type CometEntryResumeProbeInput,
  type CometEntryResumeProbeResult,
} from '../../domains/comet-entry/resume-probe.js';

interface ResumeProbeOptions {
  utterance?: string;
  stdin?: boolean;
  json?: boolean;
  nonTrivialWork?: boolean;
  workflowWork?: boolean;
  alreadyInCometFlow?: boolean;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function formatText(result: CometEntryResumeProbeResult): string {
  const lines = [
    `action: ${result.action}`,
    `confidence: ${result.confidence}`,
    `reason: ${result.reason}`,
  ];
  if (result.workflow) lines.push(`workflow: ${result.workflow}`);
  if (result.skill) lines.push(`skill: ${result.skill}`);
  if (result.entrySource) lines.push(`entry_source: ${result.entrySource}`);
  if (result.changeName) lines.push(`change: ${result.changeName}`);
  if (result.phase) lines.push(`phase: ${result.phase}`);
  if (result.nextCommand) lines.push(`next: ${result.nextCommand}`);
  return `${lines.join('\n')}\n`;
}

async function resolveUtterance(options: ResumeProbeOptions): Promise<string> {
  if (options.stdin) return readStdin();
  return options.utterance ?? '';
}

async function resolveProjectLanguage(projectPath: string): Promise<string> {
  const config = path.join(projectPath, '.comet', 'config.yaml');
  try {
    const document = parseDocument(await fs.readFile(config, 'utf8'));
    if (document.errors.length > 0) return 'unknown';
    const value = document.toJS();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown';
    const language = (value as Record<string, unknown>).language;
    return typeof language === 'string' && language.trim() ? language.trim() : 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function resumeProbeCommand(
  targetPath: string,
  options: ResumeProbeOptions = {},
): Promise<void> {
  const projectPath = path.resolve(targetPath);
  const utterance = await resolveUtterance(options);
  const workflowWork = options.workflowWork !== false && options.nonTrivialWork !== false;
  const input: CometEntryResumeProbeInput = {
    schema_version: COMET_RESUME_PROBE_SCHEMA_VERSION,
    utterance,
    locale: await resolveProjectLanguage(projectPath),
    agent_context: {
      non_trivial_work: workflowWork,
      already_in_comet_flow: options.alreadyInCometFlow === true,
    },
  };
  const result = await resolveCometEntryResumeProbe(projectPath, input);
  process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatText(result));
}
