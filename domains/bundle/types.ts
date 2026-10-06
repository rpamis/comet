import type { BundleCandidateSource } from './candidates.js';

export type BundleSkillVisibility = 'entry' | 'internal';
export type BundleCapability =
  'skills' | 'rules' | 'hooks' | 'scripts' | 'references' | 'assets' | 'agents';
export type BundleSideEffect = 'none' | 'read' | 'write' | 'external';

export interface BundleSkillDefinition {
  id: string;
  path: string;
  visibility: BundleSkillVisibility;
}

export interface BundleRuleDefinition {
  id: string;
  path: string;
  mode: 'always' | 'matched';
  match?: string[];
  priority?: number;
  required: boolean;
}

export interface BundleHookDefinition {
  id: string;
  path: string;
}

export interface BundleScriptDefinition {
  id: string;
  path: string;
  sideEffect: BundleSideEffect;
  runtime: 'node' | 'bash' | 'python';
  requiresConfirmation?: boolean;
}

export interface BundleAgentDefinition {
  id: string;
  path: string;
  platform: 'claude';
  required: boolean;
}

export interface BundlePlatformOverride {
  platform: string;
  replaces: string;
  path: string;
}

export interface NormalizedHook {
  event: 'session_start' | 'before_tool' | 'after_tool' | 'before_write' | 'after_write';
  matcher?: string;
  script: string;
  failure: 'block' | 'warn';
  requiresConfirmation: boolean;
}

export interface BundleManifest {
  apiVersion: 'comet/v1alpha1';
  kind: 'SkillBundle';
  metadata: {
    name: string;
    version: string;
    description: string;
    defaultLocale: string;
    locales: string[];
  };
  skills: BundleSkillDefinition[];
  resources: {
    rules: BundleRuleDefinition[];
    hooks: BundleHookDefinition[];
    references: string[];
    scripts: BundleScriptDefinition[];
    assets: string[];
    agents: BundleAgentDefinition[];
  };
  platforms: {
    requires: BundleCapability[];
    optional: BundleCapability[];
    overrides: BundlePlatformOverride[];
  };
  engine: { enabled: boolean; path?: string };
}

export interface SkillBundle {
  root: string;
  manifest: BundleManifest;
}

export interface ResolvedBundleLocale {
  bundle: SkillBundle;
  locale: string;
  files: Map<string, string>;
}

export interface BundleCompilerIr {
  bundle: { name: string; version: string; locale: string; hash: string };
  capabilities: {
    requires: BundleCapability[];
    optional: BundleCapability[];
  };
  skills: Array<{
    id: string;
    logicalRoot: string;
    visibility: BundleSkillVisibility;
    sourceRoot: string;
    files: Array<{ relativePath: string; source: string }>;
  }>;
  rules: Array<BundleRuleDefinition & { source: string }>;
  hooks: Array<NormalizedHook & { id: string; source: string }>;
  scripts: Array<BundleScriptDefinition & { source: string }>;
  references: Array<{ logicalPath: string; source: string }>;
  assets: Array<{ logicalPath: string; source: string }>;
  agents: Array<BundleAgentDefinition & { source: string }>;
  overrides: Array<BundlePlatformOverride & { source: string }>;
  engine: { sourceRoot: string } | null;
}

export interface ExecutableDisclosure {
  id: string;
  command: string;
  sideEffect: BundleSideEffect;
  destination: string;
}

export interface PlatformInstallFile {
  source: string;
  destination: string;
  kind: 'skill' | 'rule' | 'hook' | 'script' | 'reference' | 'asset' | 'agent' | 'engine';
  operation?:
    | {
        type: 'rule';
        format: 'md' | 'mdc' | 'copilot' | 'dsh';
        mode: 'always' | 'matched';
        match?: string[];
      }
    | {
        type: 'hook';
        format:
          | 'claude-code'
          | 'gemini'
          | 'windsurf'
          | 'copilot'
          | 'qwen'
          | 'kiro'
          | 'qoder'
          | 'codebuddy'
          | 'dsh'
          | 'trae';
        event: NormalizedHook['event'];
        matcher?: string;
        command: string;
        failure: NormalizedHook['failure'];
        requiresConfirmation: boolean;
      };
}

export type BundleAuthoringStatus =
  'draft' | 'eval-passed' | 'review-approved' | 'ready' | 'drift-conflict';

export interface BundleAuthoringState {
  schemaVersion: 1;
  name: string;
  mode: 'create' | 'optimize';
  status: BundleAuthoringStatus;
  draftPath: string;
  currentHash: string | null;
  base?: { root: string; version: string; hash: string };
  candidates: BundleCandidateSource[];
  defaultLocale: string;
  locales: string[];
  engineEnabled: boolean;
  eval?: { level: 'quick' | 'full'; hash: string; resultPath: string; passed: boolean };
  review?: {
    hash: string;
    decision: 'approved' | 'rejected';
    reviewer: string;
    at: string;
  };
  ready?: { hash: string; path: string; publishedAt: string };
  conflict?: { draftHash: string; readyHash: string };
}
