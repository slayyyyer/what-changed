import { suite, test, assert, assertEqual } from './harness.js';
import { rankDiff, summarize, isLateArrival } from '../lib/rank.js';

suite('rank');

const adapter = {
  title: 'Test source',
  fieldLabels: { status: 'Status' },
  eventDateField: 'received',
  linkFor: (item) => (item.fields.url ? item.fields.url : null),
  labelFor: (item) => item.fields.name || item.key,
  describe: (item) => `${item.kind}:${item.key}`,
  significance: (item) => {
    if (item.kind === 'added') return { score: item.fields.hot ? 9 : 1, label: 'new' };
    if (item.kind === 'removed') return { score: 4, label: 'gone' };
    return { score: 5, label: 'moved' };
  },
};

const diff = {
  added: [
    { key: 'k-1', fields: { name: 'cold', received: '2026-11-04' } },
    { key: 'k-2', fields: { name: 'hot', hot: '1', received: '2026-11-04' } },
  ],
  removed: [{ key: 'k-0', fields: { name: 'old', received: '2026-11-04' } }],
  changed: [{ key: 'k-3', fields: { name: 'Edit', url: 'https://x' }, changes: [{ name: 'status', from: 'a', to: 'b' }] }],
};

test('items are ordered by score, then key', () => {
  const items = rankDiff(adapter, diff, {});
  assertEqual(items.map((item) => item.key), ['k-2', 'k-3', 'k-0', 'k-1']);
  assertEqual(items.map((item) => item.label), ['new', 'moved', 'gone', 'new']);
});

test('ranking is stable across runs', () => {
  const first = JSON.stringify(rankDiff(adapter, diff, {}));
  const second = JSON.stringify(rankDiff(adapter, diff, {}));
  assertEqual(first, second);
});

test('every item gets a description, a link and a record label', () => {
  const items = rankDiff(adapter, diff, {});
  for (const item of items) {
    assert(item.description.length > 0, `${item.key} has no description`);
    assert(item.recordLabel, `${item.key} has no label`);
  }
  assertEqual(items.find((item) => item.key === 'k-3').link, 'https://x');
});

test('changed items keep their field-level before/after', () => {
  const items = rankDiff(adapter, diff, {});
  assertEqual(items.find((item) => item.key === 'k-3').changes, [{ name: 'status', from: 'a', to: 'b' }]);
});

test('summarize counts kinds and backfills', () => {
  const items = rankDiff(adapter, diff, { previousTakenAt: '2026-11-04T12:00:00Z' });
  const counts = summarize(items);
  assertEqual(counts.added, 2);
  assertEqual(counts.removed, 1);
  assertEqual(counts.changed, 1);
  assertEqual(counts.late, 0);
});

test('a record dated before the previous snapshot is a late arrival', () => {
  const record = { key: 'k-1', fields: { received: '2026-10-30T00:00:00Z' } };
  assert(isLateArrival(adapter, record, { previousTakenAt: '2026-11-02T12:00:00Z' }), 'should be late');
  assert(!isLateArrival(adapter, record, { previousTakenAt: '2026-10-29T12:00:00Z' }), 'should not be late');
  assert(!isLateArrival(adapter, record, {}), 'no previous snapshot means no claim');
  assert(!isLateArrival({ eventDateField: null }, record, { previousTakenAt: '2026-11-02T12:00:00Z' }));
});
