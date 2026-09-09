import { createHash, randomUUID } from 'node:crypto';

export interface ClassicTask {
  id: string | null;
  text: string;
  completed: boolean;
  line: number;
}

const TASK = /^(\s*[-*]\s+\[)([ xX])(\]\s+)(.*)$/u;
const ID = /\s*<!-- comet-task:([a-zA-Z0-9][a-zA-Z0-9_-]{0,79}) -->\s*$/u;

/** One parser for completion, recovery and handoff; fenced examples are not work. */
export function parseClassicTasks(source: string): ClassicTask[] {
  const tasks: ClassicTask[] = [];
  const ids = new Set<string>();
  let fence: { marker: string; length: number } | null = null;
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (marker) {
      if (!fence) fence = { marker: marker[1][0], length: marker[1].length };
      else if (
        marker[1][0] === fence.marker &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = null;
      continue;
    }
    if (fence) continue;
    const match = TASK.exec(line);
    if (!match) continue;
    const idMatch = ID.exec(match[4]);
    const id = idMatch?.[1] ?? null;
    if (
      match[4].includes('<!-- comet-task:') &&
      (!idMatch || match[4].slice(0, idMatch.index).includes('<!-- comet-task:'))
    ) {
      throw new Error(`Malformed Classic task ID at line ${index + 1}`);
    }
    if (id && ids.has(id)) throw new Error(`Duplicate Classic task ID: ${id}`);
    if (id) ids.add(id);
    const text = match[4].slice(0, idMatch?.index).trim();
    if (!text) throw new Error(`Empty Classic task at line ${index + 1}`);
    tasks.push({ id, text, completed: match[2].toLowerCase() === 'x', line: index + 1 });
  }
  return tasks;
}

export function classicTaskRequirements(source: string): string {
  const lines = source.split(/(?<=\n)/u);
  for (const task of parseClassicTasks(source)) {
    lines[task.line - 1] = lines[task.line - 1].replace(/^(\s*[-*]\s+\[)[ xX](\])/u, '$1 $2');
  }
  return lines.join('');
}

export function classicTaskRevision(source: string): string {
  return createHash('sha256').update(classicTaskRequirements(source)).digest('hex');
}

export function assignClassicTaskIds(source: string): string {
  const lines = source.split(/(?<=\n)/u);
  for (const task of parseClassicTasks(source)) {
    if (task.id) continue;
    const index = task.line - 1;
    lines[index] = lines[index].replace(/(\r?\n)?$/u, ` <!-- comet-task:${randomUUID()} -->$1`);
  }
  return lines.join('');
}

export function completeClassicTask(source: string, id: string, expectedRevision: string): string {
  if (classicTaskRevision(source) !== expectedRevision) {
    throw new Error('Task requirements changed; reload the task list before recording completion');
  }
  const tasks = parseClassicTasks(source);
  if (tasks.some((task) => !task.id))
    throw new Error('Legacy tasks need stable IDs; run state tasks <change> --assign-ids first');
  const task = tasks.find((task) => task.id === id);
  if (!task) throw new Error(`Unknown Classic task ID: ${id}`);
  const lines = source.split(/(?<=\n)/u);
  lines[task.line - 1] = lines[task.line - 1].replace(/^(\s*[-*]\s+\[)[ xX](\])/u, '$1x$2');
  return lines.join('');
}

export function validateClassicTaskPlan(
  plan: string,
  authority: string,
  tasks: ClassicTask[],
): 'canonical' | 'legacy' {
  const markers = [...plan.matchAll(/^<!-- comet-task-authority: (.+) -->$/gmu)];
  if (!markers.length) return 'legacy';
  if (markers.length !== 1 || markers[0][1] !== authority)
    throw new Error('Plan task authority must point to this change tasks.md');
  if (parseClassicTasks(plan).length)
    throw new Error('Canonical plan must reference tasks, not maintain a second checkbox ledger');
  if (!tasks.length || tasks.some((task) => !task.id))
    throw new Error('Canonical plan requires stable task IDs');
  const references = new Set(
    [...plan.matchAll(/<!-- comet-task-ref:([a-zA-Z0-9][a-zA-Z0-9_-]{0,79}) -->/gu)].map(
      (match) => match[1],
    ),
  );
  const ids = new Set(tasks.map((task) => task.id!));
  if ([...references].some((id) => !ids.has(id)))
    throw new Error('Plan references a missing task ID; update the plan mapping');
  if (tasks.some((task) => !references.has(task.id!)))
    throw new Error('Plan must reference each task ID; update the plan mapping');
  return 'canonical';
}
