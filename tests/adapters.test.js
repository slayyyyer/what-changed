import { readFileSync } from 'node:fs';
import { suite, test, assert, assertEqual, assertMatch } from './harness.js';
import charlotte311 from '../adapters/charlotte-311.js';
import federalRegister from '../adapters/federal-register.js';
import { evaluateSnapshot } from '../lib/gates.js';
import { diffRecords } from '../lib/diff.js';

suite('adapters');

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const INTERFACE = [
  'id',
  'title',
  'sourceUrl',
  'license',
  'fieldOrder',
  'requiredFields',
  'keyPattern',
  'fetchSnapshot',
  'normalize',
  'significance',
  'describe',
];

test('both adapters implement the declared interface', () => {
  for (const adapter of [charlotte311, federalRegister]) {
    for (const key of INTERFACE) {
      assert(adapter[key] !== undefined, `${adapter.id} is missing ${key}`);
    }
    assert(typeof adapter.fetchSnapshot === 'function');
    assert(typeof adapter.normalize === 'function');
    assertMatch(adapter.sourceUrl, /^https:\/\//);
    assert(Array.isArray(adapter.fieldOrder) && adapter.fieldOrder.length > 0);
  }
});

test('charlotte 311 normalization builds stable keys and ISO dates', () => {
  const records = charlotte311.normalize(fixture('charlotte-311-raw.json'));
  assertEqual(records.length, 2);
  assertEqual(
    records.map((record) => record.key),
    ['request-11153566', 'request-8409834'],
    'records are sorted by key, not by request number',
  );
  const blockage = records.find((record) => record.key === 'request-8409834');
  assertMatch(blockage.fields.received, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assertEqual(blockage.fields.city, 'Charlotte');
  assertEqual(blockage.fields.department, 'Storm Water Services');
  assertEqual(records.find((record) => record.key === 'request-11153566').fields.requestType, 'NON-RECYCLABLE ITEMS');
});

test('charlotte 311 publishes no personal fields', () => {
  const records = charlotte311.normalize(fixture('charlotte-311-raw.json'));
  const serialized = JSON.stringify(records);
  for (const forbidden of ['FULL_ADDRESS', 'NORTHGATE', 'BARDSTOWN', 'LATITUDE', '35.17', 'PID', 'GlobalID', 'BLOCK_NO']) {
    assert(!serialized.includes(forbidden), `snapshot leaks ${forbidden}`);
  }
  for (const record of records) {
    for (const name of Object.keys(record.fields)) {
      assert(charlotte311.fieldOrder.includes(name), `unexpected field ${name}`);
    }
  }
});

test('charlotte 311 snapshot passes its own gates', () => {
  const records = charlotte311.normalize(fixture('charlotte-311-raw.json'));
  const verdict = evaluateSnapshot({
    adapter: { ...charlotte311, limits: { minRecords: 1, maxChangeRatio: 1 } },
    records,
    previousRecords: null,
    diff: null,
  });
  assert(verdict.ok, verdict.reason || '');
});

test('charlotte 311 descriptions are templated sentences, no invented facts', () => {
  const records = charlotte311.normalize(fixture('charlotte-311-raw.json'));
  const diff = diffRecords([], records, charlotte311);
  const text = charlotte311.describe({ ...diff.added[0], kind: 'added', changes: [] });
  assert(text.includes('Blockage') || text.includes('Non-Recyclable'), text);
  assert(!/\d{1,3}\s+(Northgate|Bardstown)/i.test(text), 'street address must not appear');
});

test('federal register normalization keeps the document link and correction target', () => {
  const records = federalRegister.normalize(fixture('federal-register-raw.json').results);
  assertEqual(records.length, 2);
  assertEqual(records[0].key, 'fr-2026-22443');
  const correction = records.find((record) => record.key === 'fr-C1-2026-20310');
  assert(correction, 'correction record is present');
  assertEqual(correction.fields.correctionOf, '2026-20310');
  assertMatch(correction.fields.url, /^https:\/\/www\.federalregister\.gov\/documents\//);
  assertEqual(correction.fields.agency, 'Securities and Exchange Commission');
});

test('federal register links each item to the record itself', () => {
  const records = federalRegister.normalize(fixture('federal-register-raw.json').results);
  const item = { fields: records[0].fields };
  assertEqual(federalRegister.linkFor(item), records[0].fields.url);
});

test('federal register ranks a rule above a notice, and a correction above its original', () => {
  const rule = federalRegister.significance({ kind: 'added', fields: { type: 'Rule' }, changes: [] });
  const notice = federalRegister.significance({ kind: 'added', fields: { type: 'Notice' }, changes: [] });
  const correction = federalRegister.significance({
    kind: 'added',
    fields: { type: 'Notice', correctionOf: '2026-1' },
    changes: [],
  });
  assert(rule.score > notice.score, 'a final rule outranks a notice');
  assert(correction.score > notice.score, 'a correction outranks a plain notice');
  assertEqual(correction.label, 'correction');
});

test('adapter field lists and required fields stay in sync', () => {
  for (const adapter of [charlotte311, federalRegister]) {
    for (const name of adapter.requiredFields) {
      assert(adapter.fieldOrder.includes(name), `${adapter.id}: required field ${name} is not in fieldOrder`);
    }
    for (const name of adapter.ignoreFields || []) {
      assert(adapter.fieldOrder.includes(name), `${adapter.id}: ignored field ${name} is not in fieldOrder`);
    }
  }
});
