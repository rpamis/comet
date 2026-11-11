import { promises as fs } from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import {
  nativeChangeDocument,
  parseNativeChangeValue,
} from '../../domains/comet-native/native-change.js';
import type { NativeProjectPaths } from '../../domains/comet-native/native-types.js';

/** 仅初始化 parser/存储测试的历史业务文档，不执行旧创建或转换流程。 */
export async function storedNativeChangeFixture(options: {
  paths: NativeProjectPaths;
  name: string;
  language: string;
  verificationProtocol?: string;
}) {
  const state = parseNativeChangeValue({
    schema: 'comet.native.v3',
    minimum_runtime_version: 3,
    revision: 1,
    verification_protocol: 'legacy-v1',
    name: options.name,
    language: options.language,
    phase: 'shape',
    brief: 'brief.md',
    approval: null,
    spec_changes: [],
    verification_result: 'pending',
    verification_report: null,
    implementation_scope: null,
    verification_evidence: null,
    partial_allowance: null,
    archived: false,
    created_at: '2026-08-12',
    run_id: null,
    approved_contract_hash: null,
  });
  const changeDir = path.join(options.paths.changesDir, state.name);
  await fs.mkdir(path.join(changeDir, 'specs'), { recursive: true });
  await fs.writeFile(
    path.join(changeDir, 'comet-state.yaml'),
    stringify(nativeChangeDocument(state)),
  );
  return state;
}

/** 物化真实发布版在 afterPrepared 中断时留下的字节，不生成旧证据或执行计划。 */
export async function loadPreparedNativeTransition(paths: NativeProjectPaths) {
  const frozen = JSON.parse(
    await fs.readFile(
      'test/fixtures/native-052-transition-journal/remove-after-recovery.json',
      'utf8',
    ),
  ) as {
    name: string;
    materials: { directories: string[]; files: Array<{ ref: string; bytesBase64: string }> };
    changeRuntime: { files: Array<{ ref: string; bytesBase64: string }> };
  };
  for (const ref of frozen.materials.directories)
    await fs.mkdir(path.join(paths.nativeRoot, ref), { recursive: true });
  for (const file of frozen.materials.files) {
    const target = path.join(paths.nativeRoot, file.ref);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(file.bytesBase64, 'base64'));
  }
  const runtime = path.join(paths.changesRuntimeDir, frozen.name);
  for (const file of frozen.changeRuntime.files.filter(
    (file) =>
      file.ref === 'transition.json' ||
      file.ref === 'run-state.json' ||
      file.ref === 'trajectory.jsonl' ||
      file.ref.startsWith('checkpoints/'),
  )) {
    const target = path.join(runtime, file.ref);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(file.bytesBase64, 'base64'));
  }
  return frozen;
}
