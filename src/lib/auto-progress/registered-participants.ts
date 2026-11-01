/** Loads a stable, keyset-paginated set of registered participant identifiers. */
export async function loadRegisteredParticipantIds(
  fetchPage: (afterId: string | null, limit: number) => Promise<{ ids: string[]; error: boolean }>,
  pageSize = 500,
): Promise<string[]> {
  const size = Math.max(1, Math.min(1_000, Math.trunc(pageSize)));
  const participantIds: string[] = [];
  let afterId: string | null = null;
  for (;;) {
    const page = await fetchPage(afterId, size);
    if (page.error) throw new Error("registered_participants_unavailable");
    participantIds.push(...page.ids);
    if (page.ids.length < size) return participantIds;
    const nextCursor = page.ids[page.ids.length - 1];
    if (!nextCursor || nextCursor === afterId) throw new Error("registered_participants_pagination_stalled");
    afterId = nextCursor;
  }
}
