// Ranking. Nothing is ever hidden by rank — only ordered. The front page shows a
// capped list and links to "everything", which is the full pre-rendered diff.

import { canonicalValue } from './json.js';

const KIND_SCORE = {
  removed: 3,
  changed: 2.4,
  added: 1,
};

/**
 * Turn a raw diff into an ordered list of display items.
 *
 * @param {object} adapter
 * @param {object} diff
 * @param {{previousTakenAt?:string, currentTakenAt?:string, windowFrom?:string}} context
 */
export function rankDiff(adapter, diff, context = {}) {
  const items = [];

  for (const record of diff.added) {
    const item = {
      kind: 'added',
      key: record.key,
      fields: record.fields,
      changes: [],
      late: isLateArrival(adapter, record, context),
    };
    items.push(withNarrative(adapter, item, context));
  }

  for (const record of diff.removed) {
    const item = { kind: 'removed', key: record.key, fields: record.fields, changes: [], late: false };
    items.push(withNarrative(adapter, item, context));
  }

  for (const record of diff.changed) {
    const item = {
      kind: 'changed',
      key: record.key,
      fields: record.fields,
      changes: record.changes,
      late: false,
    };
    items.push(withNarrative(adapter, item, context));
  }

  return items.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

function withNarrative(adapter, item, context) {
  const verdict = adapter.significance ? adapter.significance(item, context) || {} : {};
  const score = Number.isFinite(verdict.score) ? verdict.score : KIND_SCORE[item.kind] || 1;
  const label = verdict.label || defaultLabel(item);
  const description = adapter.describe ? adapter.describe(item, context) : defaultDescribe(adapter, item);
  return {
    ...item,
    score: round(score),
    label,
    description,
    link: adapter.linkFor ? adapter.linkFor(item) : null,
    recordLabel: adapter.labelFor ? adapter.labelFor(item) : item.key,
  };
}

function defaultLabel(item) {
  if (item.kind === 'added') return 'new';
  if (item.kind === 'removed') return 'gone';
  return item.changes.length === 1 ? 'field changed' : `${item.changes.length} fields changed`;
}

function defaultDescribe(adapter, item) {
  if (item.kind === 'added') {
    return `Appeared in today's snapshot of ${adapter.title}.`;
  }
  if (item.kind === 'removed') {
    return `Was in the previous snapshot and is no longer in today's.`;
  }
  const names = item.changes.map((change) => humanField(adapter, change.name)).join(', ');
  return `Changed ${names}.`;
}

export function humanField(adapter, name) {
  return adapter.fieldLabels?.[name] || name;
}

/**
 * A record that shows up for the first time but carries an event date older than
 * the previous snapshot was taken. Publishers backfill; saying "new today" would
 * be wrong, so these are labelled separately.
 */
export function isLateArrival(adapter, record, context = {}) {
  const field = adapter.eventDateField;
  if (!field) return false;
  const value = record.fields?.[field];
  if (!value) return false;
  const eventDate = canonicalValue(value).slice(0, 10);
  const cutoff = context.previousTakenAt ? canonicalValue(context.previousTakenAt).slice(0, 10) : null;
  if (!cutoff) return false;
  return eventDate < cutoff;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

/** Group items by kind for the summary strip. */
export function summarize(items) {
  const counts = { added: 0, removed: 0, changed: 0, late: 0 };
  for (const item of items) {
    counts[item.kind] += 1;
    if (item.late) counts.late += 1;
  }
  return counts;
}
