// View helpers shared by the page renderer, the feeds and the JSON payloads.

import { rankDiff, summarize } from './rank.js';

/** Ranked items for one archived diff. Pure: same diff in, same list out. */
export function dayView(adapter, diffDoc) {
  if (!diffDoc) return { items: [], counts: { added: 0, removed: 0, changed: 0, late: 0 }, diff: null };
  const items = rankDiff(adapter, diffDoc, {
    previousTakenAt: diffDoc.from?.takenAt || null,
    currentTakenAt: diffDoc.to?.takenAt || null,
    windowFrom: diffDoc.window?.from || null,
  });
  return { items, counts: summarize(items), diff: diffDoc };
}

/** Newest-first trend rows for the little bar chart. */
export function trendRows(diffDocs, limit = 14) {
  return diffDocs.slice(0, limit).map((doc) => ({
    date: doc.date,
    added: doc.stats?.added ?? 0,
    removed: doc.stats?.removed ?? 0,
    changed: doc.stats?.changed ?? 0,
    expired: doc.stats?.expired ?? 0,
    total: (doc.stats?.added ?? 0) + (doc.stats?.removed ?? 0) + (doc.stats?.changed ?? 0),
  }));
}

export function maxTotal(rows) {
  return rows.reduce((max, row) => Math.max(max, row.total), 0);
}

/**
 * The one-line state of the whole site.
 *  - none: nothing has ever been snapshotted
 *  - quiet: every source answered and nothing changed
 *  - partial: at least one source has no usable snapshot today
 *  - changes: something changed
 */
export function siteState(sources) {
  const hasDiff = sources.some((source) => (source.today?.items?.length || 0) > 0);
  const unavailable = sources.filter((source) => !isFresh(source.status));
  const everOk = sources.some((source) => source.status?.lastSuccessAt);
  // A baseline run has a snapshot but nothing to compare it to yet. A quiet day
  // is a claim about a comparison, so it requires at least one.
  const compared = sources.some(
    (source) => source.status?.result === 'ok' || source.status?.result === 'unchanged',
  );
  if (!hasDiff && (!compared || !everOk)) return 'none';
  if (hasDiff) return unavailable.length > 0 ? 'partial' : 'changes';
  if (unavailable.length > 0) return 'partial';
  return 'quiet';
}

/** True when today's run produced a usable snapshot (or proved there was nothing new). */
export function isFresh(status) {
  if (!status) return false;
  if (status.stale) return false;
  return status.result === 'ok' || status.result === 'unchanged' || status.result === 'baseline';
}

export function statusLabel(status) {
  if (!status) return { text: 'never run', tone: 'warn' };
  if (status.stale) return { text: 'no snapshot today', tone: 'fail' };
  switch (status.result) {
    case 'ok':
      return { text: 'snapshot taken today', tone: 'ok' };
    case 'unchanged':
      return { text: 'snapshot unchanged today', tone: 'ok' };
    case 'baseline':
      return { text: 'first snapshot — nothing to compare yet', tone: 'ok' };
    case 'quarantined':
      return { text: 'snapshot quarantined — no diff published', tone: 'fail' };
    case 'error':
      return { text: 'no snapshot today', tone: 'fail' };
    case 'never':
      return { text: 'never run', tone: 'warn' };
    default:
      return { text: status.result || 'unknown', tone: 'warn' };
  }
}

export function sourceSummary(source) {
  const { status, today } = source;
  if (!today || today.items.length === 0) {
    if (!isFresh(status)) return null;
    return { added: 0, removed: 0, changed: 0, late: 0 };
  }
  return today.counts;
}

export function totalSummary(sources) {
  const total = { added: 0, removed: 0, changed: 0, late: 0 };
  for (const source of sources) {
    const counts = sourceSummary(source);
    if (!counts) continue;
    total.added += counts.added;
    total.removed += counts.removed;
    total.changed += counts.changed;
    total.late += counts.late;
  }
  return total;
}
