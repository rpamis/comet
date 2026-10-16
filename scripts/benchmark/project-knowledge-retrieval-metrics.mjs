function normalized(value) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
}

export function retrievalEvidence(entry, results, topK = 4) {
  const selected = results.slice(0, topK);
  const gold = new Set(entry.goldSources);
  const relevant = new Set(
    selected.filter((result) => gold.has(result.source)).map((result) => result.source),
  );
  const passages = entry.goldPassages ?? [];
  for (const passage of passages) {
    if (!gold.has(passage.source) || (!passage.allOf?.length && !passage.anyOf?.length))
      throw new Error('Passage labels require a gold source and content assertions');
  }
  return {
    hitRateAt4: entry.expectedAbstain ? selected.length === 0 : relevant.size > 0,
    sourceRecallAt4: gold.size ? relevant.size / gold.size : 0,
    sourcePrecisionAt4: relevant.size / topK,
    ...(passages.length
      ? {
          passageHitAt4: passages.some((passage) =>
            selected.some((result) => {
              if (result.source !== passage.source) return false;
              const content = normalized(result.content ?? '');
              return (
                (passage.allOf ?? []).every((text) => content.includes(normalized(text))) &&
                (!passage.anyOf?.length ||
                  passage.anyOf.some((text) => content.includes(normalized(text))))
              );
            }),
          ),
        }
      : {}),
  };
}
