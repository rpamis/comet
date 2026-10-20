/** 统一旧文本 Rubric 适配器：所有维度参与聚合，不按界面页大小截断。 */
export function evalRubricScores(passed: string[], failed: string[]) {
  const scores: Record<string, number | null> = {};
  const scoreSources: Record<string, 'check' | 'judge'> = {};
  for (const check of [...passed, ...failed]) {
    const match = /^\[RUBRIC(-JUDGE)?\]\s+([\w-]+):\s+(N\/A|[\d.]+)/u.exec(check);
    if (!match) continue;
    const value = Number(match[3]);
    scores[match[2]] = match[3] === 'N/A' || !Number.isFinite(value) || value < 0 ? null : value;
    scoreSources[match[2]] = match[1] ? 'judge' : 'check';
  }
  return { scores, scoreSources };
}
