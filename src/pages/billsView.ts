/**
 * Bills page header (phase 1). Counts come from the saved items. The summary
 * figures stay on the list response; this file does not recompute them.
 */

export type HeaderCounts = { active: number; paused: number; cancelled: number };

/** Active, paused, and cancelled counted apart. Any other status is ignored. */
export function headerCounts(items: ReadonlyArray<{ status: string }>): HeaderCounts {
  const counts: HeaderCounts = { active: 0, paused: 0, cancelled: 0 };
  for (const item of items) {
    if (item.status === 'active') counts.active += 1;
    else if (item.status === 'paused') counts.paused += 1;
    else if (item.status === 'cancelled') counts.cancelled += 1;
  }
  return counts;
}

/** "[N] active · [M] paused · found in your transactions or added by you". */
export function billsSubtitle(counts: Pick<HeaderCounts, 'active' | 'paused'>): string {
  return `${counts.active} active · ${counts.paused} paused · found in your transactions or added by you`;
}
