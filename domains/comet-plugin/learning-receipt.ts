import os from 'node:os';
import path from 'node:path';
import { JsonFilePluginStorageStore } from '../../platform/fs/plugin-store.js';
import {
  areAgentExperienceEventsProcessed,
  StorageAgentExperienceJournalStore,
  type AgentExperienceEvent,
} from '../agent-learning/index.js';

/** 限量读取事件日志快照，不启动 Provider，也不创建持久状态。 */
export async function areDefaultWorkflowEventsProcessed(
  events: readonly AgentExperienceEvent[],
  homeDirectory = os.homedir(),
): Promise<boolean> {
  if (events.length === 0 || events.length > 3) return false;
  const projectId = events[0]?.projectId;
  if (
    !projectId ||
    events.some((event) => event.scope !== 'project' || event.projectId !== projectId)
  )
    return false;
  try {
    const storage = new JsonFilePluginStorageStore(
      path.join(path.resolve(homeDirectory), '.comet', 'plugins', 'storage'),
    );
    for (const scope of ['user', 'project'] as const) {
      const source = await storage.open(
        'comet.agent-learning',
        scope,
        scope === 'project' ? projectId : undefined,
      );
      const store = new StorageAgentExperienceJournalStore({
        read: () => source.read(256 * 1024),
        write: (state) => source.write(state),
      });
      if (!(await areAgentExperienceEventsProcessed(store, scope === 'project' ? events : [])))
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
