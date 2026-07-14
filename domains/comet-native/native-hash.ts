import { createHash } from 'crypto';
import { createReadStream } from 'fs';

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export function sha256Text(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
