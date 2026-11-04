import { suite, test, assert, assertEqual, assertNotEqual } from './harness.js';
import { diffRecords, applyDiff, isEmptyDiff, changeCount } from '../lib/diff.js';

suite('diff');

const rec = (key, fields) => ({ key, fields });
const adapter = { ignoreFields: ['url'], caseInsensitiveFields: ['type'] };

test('same snapshot produces an empty diff', () => {
  const a = [rec('k-1', { name: 'a', type: 'Rule' }), rec('k-2', { name: 'b', type: 'Notice' })];
  const result = diffRecords(a, a, adapter);
  assert(isEmptyDiff(result), 'expected no changes');
  assertEqual(result.stats.unchanged, 2);
  assertEqual(result.added, []);
  assertEqual(result.removed, []);
  assertEqual(result.changed, []);
});

test('added and removed records are listed by key', () => {
  const before = [rec('k-1', { name: 'a' }), rec('k-2', { name: 'b' })];
  const after = [rec('k-2', { name: 'b' }), rec('k-3', { name: 'c' })];
  const result = diffRecords(before, after, adapter);
  assertEqual(result.added.map((r) => r.key), ['k-3']);
  assertEqual(result.removed.map((r) => r.key), ['k-1']);
  assertEqual(result.removed[0].fields, { name: 'a' }, 'removed records keep their last known fields');
  assertEqual(result.stats, {
    added: 1,
    removed: 1,
    changed: 0,
    unchanged: 1,
    fieldChanges: 0,
    recordsBefore: 2,
    recordsAfter: 2,
  });
});

test('field changes carry before and after values', () => {
  const before = [rec('k-1', { status: 'Open', department: 'Solid Waste' })];
  const after = [rec('k-1', { status: 'Closed', department: 'Solid Waste' })];
  const result = diffRecords(before, after, adapter);
  assertEqual(result.changed.length, 1);
  assertEqual(result.changed[0].changes, [{ name: 'status', from: 'Open', to: 'Closed' }]);
  assertEqual(result.stats.fieldChanges, 1);
});

test('whitespace and non-breaking spaces are not changes', () => {
  const before = [rec('k-1', { name: 'North   Main' })];
  const after = [rec('k-1', { name: ' North\u00a0Main ' })];
  assert(isEmptyDiff(diffRecords(before, after, adapter)), 'formatting churn must be ignored');
});

test('declared ignored fields never register as changes', () => {
  const before = [rec('k-1', { name: 'a', url: 'https://example.com/1' })];
  const after = [rec('k-1', { name: 'a', url: 'https://example.com/2' })];
  assert(isEmptyDiff(diffRecords(before, after, adapter)));
});

test('case-insensitive fields compare case-insensitively', () => {
  const before = [rec('k-1', { type: 'Rule' })];
  const after = [rec('k-1', { type: 'RULE' })];
  assert(isEmptyDiff(diffRecords(before, after, adapter)), 'type was declared case-insensitive');

  const strict = diffRecords(before, after, {});
  assertEqual(strict.changed.length, 1, 'without the declaration the case change is reported');
});

test('a missing field reads as empty and back again', () => {
  const before = [rec('k-1', { a: 'x' })];
  const after = [rec('k-1', { a: 'x', b: 'new' })];
  assertEqual(diffRecords(before, after, adapter).changed[0].changes, [{ name: 'b', from: null, to: 'new' }]);
  assertEqual(diffRecords(after, before, adapter).changed[0].changes, [{ name: 'b', from: 'new', to: null }]);
});

test('output is deterministic regardless of input order', () => {
  const before = [rec('k-3', { a: '3' }), rec('k-1', { a: '1' }), rec('k-2', { a: '2' })];
  const after = [rec('k-2', { a: '2b' }), rec('k-1', { a: '1' }), rec('k-4', { a: '4' })];
  const first = JSON.stringify(diffRecords(before, after, adapter));
  const second = JSON.stringify(diffRecords([...before].reverse(), [...after].reverse(), adapter));
  assertEqual(first, second, 'shuffling the inputs must not change the bytes');
  assertEqual(diffRecords(before, after, adapter).added.map((r) => r.key), ['k-4']);
});

test('applying a diff reproduces the current snapshot', () => {
  const before = [rec('k-1', { a: '1', b: 'x' }), rec('k-2', { a: '2' }), rec('k-3', { a: '3' })];
  const after = [rec('k-1', { a: '1b' }), rec('k-3', { a: '3' }), rec('k-4', { a: '4' })];
  const diff = diffRecords(before, after, adapter);
  assertEqual(applyDiff(before, diff), after);
});

test('changeCount counts records, not fields', () => {
  const before = [rec('k-1', { a: '1', b: '1' })];
  const after = [rec('k-1', { a: '2', b: '2' })];
  const diff = diffRecords(before, after, adapter);
  assertEqual(changeCount(diff), 1);
  assertNotEqual(changeCount(diff), 2);
});
