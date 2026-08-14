import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface TextFileStore {
  read(): Promise<string | null>;
  write(content: string): Promise<void>;
}

export class JsonFileTextStore implements TextFileStore {
  private readonly filePath: string;

  public constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  public async read(): Promise<string | null> {
    try {
      return await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  public async write(content: string): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, content, 'utf8');
    await fs.rename(temporary, this.filePath);
  }
}

export class JsonFilePluginStorageStore {
  private readonly root: string;

  public constructor(root: string) {
    this.root = path.resolve(root);
  }

  public async open(pluginId: string, scope: string, projectId?: string): Promise<TextFileStore> {
    const fileName = `${safeSegment(pluginId)}-${safeSegment(scope)}-${safeSegment(projectId ?? 'global')}.json`;
    return new JsonFileTextStore(path.join(this.root, fileName));
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 120) || 'plugin';
}
