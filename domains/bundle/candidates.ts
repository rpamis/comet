import os from 'os';
import path from 'path';
import { findPreferredSkills, type FoundSkillSource } from '../skill/find.js';

export interface BundleCandidateSource {
  name: string;
  preferenceIndex: number | null;
  platform: string;
  scope: FoundSkillSource['origin'];
  origin: FoundSkillSource['origin'];
  root: string;
  description: string;
  skillMd: string;
  references?: FoundSkillSource['references'];
  scripts?: FoundSkillSource['scripts'];
  hash: string;
}

export interface BundleCandidate {
  name: string;
  preferenceIndex: number | null;
  status: 'available' | 'missing' | 'ambiguous';
  sources: BundleCandidateSource[];
}

export async function discoverBundleCandidates(options: {
  projectRoot: string;
  homeDir?: string;
  preferences?: string[] | null;
}): Promise<BundleCandidate[]> {
  const preferences =
    options.preferences === undefined
      ? undefined
      : (options.preferences?.map((query, preferenceIndex) => ({ query, preferenceIndex })) ??
        null);
  const found = await findPreferredSkills({
    projectRoot: options.projectRoot,
    homeDir: options.homeDir ?? os.homedir(),
    builtinRoot: path.join(options.projectRoot, '.comet', '__bundle_builtin_disabled__'),
    preferences,
  });

  return found.map((candidate) => ({
    name: candidate.query,
    preferenceIndex: candidate.preferenceIndex,
    status: candidate.status,
    sources: candidate.sources.map((source) => ({
      name: source.name,
      preferenceIndex: candidate.preferenceIndex,
      platform: source.platform ?? source.origin,
      scope: source.origin,
      origin: source.origin,
      root: source.root,
      description: source.description,
      skillMd: source.skillMd,
      references: source.references,
      scripts: source.scripts,
      hash: source.hash,
    })),
  }));
}
