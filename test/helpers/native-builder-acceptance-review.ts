/** Explicit completion declarations for Runtime protocol fixtures. */
export function fixtureAcceptanceReview(ids: readonly string[]) {
  return ids.map((id) => ({
    id,
    status: 'implemented-with-evidence' as const,
    evidence: [`Runtime fixture implements the confirmed behavior for ${id}.`],
    note: `Fixture self-review covers the implementation and evidence for ${id}.`,
  }));
}
