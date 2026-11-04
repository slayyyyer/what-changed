import { suite, test, assert, assertEqual } from './harness.js';
import { evaluateSnapshot } from '../lib/gates.js';
import { diffRecords } from '../lib/diff.js';

suite('gates');

const adapter = {
  fieldOrder: ['a', 'b'],
  requiredFields: ['a'],
  keyPattern: /^k-\d+$/,
  limits: { minRecords: 3, minCountRatio: 0.6, maxCountRatio: 1.8, maxChangeRatio: 0.35, maxUnexpectedFields: 6 },
};

const make = (count, fields = {}) =>
  Array.from({ length: count }, (_, index) => ({ key: `k-${index}`, fields: { a: `v${index}`, b: 'x', ...fields } }));

test('a healthy snapshot is accepted with no notes', () => {
  const records = make(10);
  const previous = make(10);
  const verdict = evaluateSnapshot({ adapter, records, previousRecords: previous, diff: diffRecords(previous, records) });
  assert(verdict.ok, verdict.reason || '');
  assertEqual(verdict.notes, []);
});

test('an empty snapshot is quarantined', () => {
  const verdict = evaluateSnapshot({ adapter, records: [], previousRecords: make(10), diff: null });
  assert(!verdict.ok);
  assert(verdict.reason.includes('empty snapshot'), verdict.reason);
});

test('a snapshot below the record floor is quarantined', () => {
  const verdict = evaluateSnapshot({ adapter, records: make(2), previousRecords: make(10), diff: null });
  assert(!verdict.ok);
  assert(verdict.reason.includes('floor'), verdict.reason);
});

test('a missing required field is quarantined', () => {
  const records = [...make(5), { key: 'k-99', fields: { b: 'x' } }];
  const verdict = evaluateSnapshot({ adapter, records, previousRecords: make(5), diff: null });
  assert(!verdict.ok);
  assert(verdict.reason.includes('required field "a"'), verdict.reason);
});

test('malformed keys are quarantined', () => {
  const records = [...make(5), { key: 'bad-key', fields: { a: 'x' } }];
  const verdict = evaluateSnapshot({ adapter, records, previousRecords: make(5), diff: null });
  assert(!verdict.ok);
  assert(verdict.reason.includes('malformed key'), verdict.reason);
});

test('duplicate keys are quarantined', () => {
  const records = [...make(5), { key: 'k-0', fields: { a: 'x' } }];
  const verdict = evaluateSnapshot({ adapter, records, previousRecords: make(5), diff: null });
  assert(!verdict.ok);
  assert(verdict.reason.includes('duplicate key'), verdict.reason);
});

test('a collapse in record count is quarantined', () => {
  const previous = make(100);
  const verdict = evaluateSnapshot({ adapter, records: make(40), previousRecords: previous, diff: null });
  assert(!verdict.ok);
  assert(verdict.reason.includes('record count fell'), verdict.reason);
});

test('an implausible jump in record count is quarantined', () => {
  const previous = make(100);
  const verdict = evaluateSnapshot({ adapter, records: make(400), previousRecords: previous, diff: null });
  assert(!verdict.ok);
  assert(verdict.reason.includes('record count jumped'), verdict.reason);
});

test('a mass rewrite is quarantined as a likely schema change', () => {
  const previous = make(200);
  const records = make(200).map((record, index) => ({
    key: record.key,
    fields: { ...record.fields, b: index < 150 ? 'rewritten' : 'x' },
  }));
  const verdict = evaluateSnapshot({
    adapter,
    records,
    previousRecords: previous,
    diff: diffRecords(previous, records),
  });
  assert(!verdict.ok);
  assert(verdict.reason.includes('% of records changed'), verdict.reason);
});

test('unexpected fields are a visible note, not a failure', () => {
  const records = make(10).map((record) => ({ key: record.key, fields: { ...record.fields, c: 'new' } }));
  const verdict = evaluateSnapshot({ adapter, records, previousRecords: make(10), diff: null });
  assert(verdict.ok, verdict.reason || '');
  assertEqual(verdict.notes, ['unexpected field(s): c']);
});

test('enough schema drift becomes a failure', () => {
  const extra = { c: '1', d: '1', e: '1', f: '1', g: '1', h: '1', i: '1' };
  const records = make(10).map((record) => ({ key: record.key, fields: { ...record.fields, ...extra } }));
  const verdict = evaluateSnapshot({ adapter, records, previousRecords: make(10), diff: null });
  assert(!verdict.ok);
  assert(verdict.reason.includes('schema drift'), verdict.reason);
});

test('the first snapshot skips the comparison gates', () => {
  const verdict = evaluateSnapshot({ adapter, records: make(10), previousRecords: null, diff: null });
  assert(verdict.ok);
});
